import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getClient, getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { jobEvents, marketJobs, type MarketJobRow } from "@/db/schema";
import { inferStage } from "@/lib/jobs/stages";
import type { ProgressEvent, ProgressJob } from "@/lib/progress";

/**
 * Durable job queue on the `market_jobs` table.
 *
 * - Claims are one atomic `UPDATE … RETURNING`, so two drainers can never run
 *   the same job.
 * - A claim is a lease: the runner heartbeats it, and an expired lease is
 *   returned to the queue (a crashed worker never leaves a job stuck).
 * - Interactive jobs (a user is waiting) are claimed before background ones.
 * - `dedupe_key` has a unique index over pending/running rows, so enqueueing
 *   the same scan twice returns the job that is already queued.
 * - Rate-limit waits reschedule without spending an attempt; real failures
 *   retry with backoff until `max_attempts`.
 */

export type JobLane = "interactive" | "background";
export type JobStatus = "pending" | "running" | "done" | "error" | "cancelled";

export interface EnqueueJobOpts {
  id?: string;
  kind: string;
  payload: Record<string, unknown>;
  runAt?: number;
  lane?: JobLane;
  priority?: number;
  /** `null` disables dedupe; omitted uses the kind's default key. */
  dedupeKey?: string | null;
  parentId?: string | null;
  maxAttempts?: number;
  message?: string;
}

export const LEASE_MS = 90_000;
export const HEARTBEAT_MS = 30_000;
const LEGACY_STALE_MS = 5 * 60 * 1000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60 * 1000;
const MAX_LOG_LINES = 60;

const ACTIVE: JobStatus[] = ["pending", "running"];

function parseLog(raw: string): ProgressEvent[] {
  try {
    const parsed = JSON.parse(raw) as ProgressEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseResult(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function pushLog(raw: string, text: string, at = Date.now()): string {
  const log = parseLog(raw);
  log.push({ at, text });
  return JSON.stringify(log.length > MAX_LOG_LINES ? log.slice(-MAX_LOG_LINES) : log);
}

export function rowToProgressJob(row: MarketJobRow): ProgressJob {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status as ProgressJob["status"],
    message: row.message,
    log: parseLog(row.log),
    current: row.current,
    total: row.total,
    startedAt: row.startedAt ?? row.createdAt,
    updatedAt: row.updatedAt,
    runAt: row.runAt,
    result: parseResult(row.result),
  };
}

/** Default dedupe key: one active job per kind + league + scope. */
export function defaultDedupeKey(
  kind: string,
  payload: Record<string, unknown>,
): string | null {
  const league = typeof payload.league === "string" ? payload.league : "";
  if (!league) return null;
  const scope = typeof payload.scopeKey === "string" && payload.scopeKey ? `:${payload.scopeKey}` : "";
  switch (kind) {
    case "scan:gems":
    case "scan:tablets":
    case "refresh:prices":
      return `${kind}:${league}${scope}`;
    case "scan:tablet":
      return `${kind}:${league}:${String(payload.tablet ?? "")}`;
    case "scan:class":
    case "scan:quick":
    case "sample:class":
    case "probe:class":
      return payload.itemClass ? `${kind}:${league}:${String(payload.itemClass)}` : null;
    default:
      return null;
  }
}

function initialMessage(kind: string): string {
  switch (kind) {
    case "scan:gems":
      return "Queued gem scan…";
    case "scan:tablets":
      return "Queued tablet scan…";
    case "scan:tablet":
      return "Queued tablet…";
    case "refresh:prices":
      return "Queued price refresh…";
    default:
      return "Queued";
  }
}

async function findActiveByDedupe(key: string): Promise<MarketJobRow | null> {
  const rows = await getDb()
    .select()
    .from(marketJobs)
    .where(and(eq(marketJobs.dedupeKey, key), inArray(marketJobs.status, ACTIVE)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Queues a job and returns its id. When an active job already has the same
 * dedupe key, that job's id is returned instead (and it is promoted to the
 * interactive lane / higher priority if this request asked for that).
 */
export async function enqueueJob(opts: EnqueueJobOpts, retries = 2): Promise<string> {
  await ensureAppTables();
  const now = Date.now();
  const lane: JobLane = opts.lane ?? "background";
  const priority = opts.priority ?? (lane === "interactive" ? 10 : 0);
  const dedupeKey =
    opts.dedupeKey === undefined ? defaultDedupeKey(opts.kind, opts.payload) : opts.dedupeKey;
  const id = opts.id ?? `job-${now}-${Math.random().toString(36).slice(2, 9)}`;
  const message = opts.message ?? initialMessage(opts.kind);

  const res = await getClient().execute({
    sql: `INSERT INTO market_jobs
      (id, kind, payload, status, message, log, run_at, created_at, updated_at,
       priority, lane, dedupe_key, parent_id, attempts, max_attempts)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT DO NOTHING`,
    args: [
      id,
      opts.kind,
      JSON.stringify(opts.payload),
      message,
      JSON.stringify([{ at: now, text: message }]),
      opts.runAt ?? now,
      now,
      now,
      priority,
      lane,
      dedupeKey,
      opts.parentId ?? null,
      opts.maxAttempts ?? 5,
    ],
  });

  if (res.rowsAffected === 0 && dedupeKey) {
    const existing = await findActiveByDedupe(dedupeKey);
    if (existing) {
      const promote = lane === "interactive" && existing.lane !== "interactive";
      if (promote || priority > existing.priority) {
        await getDb()
          .update(marketJobs)
          .set({
            lane: promote ? "interactive" : existing.lane,
            priority: Math.max(priority, existing.priority),
            runAt: existing.status === "pending" && promote ? Math.min(existing.runAt, now) : existing.runAt,
            updatedAt: now,
          })
          .where(eq(marketJobs.id, existing.id));
      }
      return existing.id;
    }
    // The conflicting job finished between the insert and the lookup.
    if (retries > 0) return enqueueJob(opts, retries - 1);
  }
  if (res.rowsAffected === 0) return id;

  await appendJobEvent(id, opts.kind, message);
  return id;
}

async function appendJobEvent(
  jobId: string,
  kind: string,
  text: string,
  opts?: { stage?: string; current?: number | null; total?: number | null },
): Promise<void> {
  await getDb().insert(jobEvents).values({
    jobId,
    at: Date.now(),
    stage: opts?.stage || inferStage(kind, text),
    text,
    current: opts?.current ?? null,
    total: opts?.total ?? null,
  });
}

/** Active (pending or running) top-level job of a kind for a league. */
export async function findActiveJob(
  kind: string,
  league: string,
): Promise<MarketJobRow | null> {
  await ensureAppTables();
  const rows = await getDb()
    .select()
    .from(marketJobs)
    .where(and(eq(marketJobs.kind, kind), inArray(marketJobs.status, ACTIVE)));
  for (const row of rows) {
    if (row.parentId) continue;
    try {
      const payload = JSON.parse(row.payload) as { league?: string };
      if (payload.league === league) return row;
    } catch {
      /* skip malformed payload */
    }
  }
  return null;
}

export async function getActiveGemScanJob(league: string): Promise<MarketJobRow | null> {
  return findActiveJob("scan:gems", league);
}

export async function getActiveTabletScanJob(league: string): Promise<MarketJobRow | null> {
  return findActiveJob("scan:tablets", league);
}

/**
 * Returns running jobs whose lease ran out to the queue. A lost lease counts as
 * an attempt, so a job that keeps crashing its worker eventually fails.
 */
export async function reclaimExpiredLeases(now = Date.now()): Promise<number> {
  await ensureAppTables();
  const client = getClient();
  const message = "Worker stopped mid-run — requeued.";
  const expired = await client.execute({
    sql: `UPDATE market_jobs
      SET status = CASE WHEN attempts + 1 >= max_attempts THEN 'error' ELSE 'pending' END,
          error = CASE WHEN attempts + 1 >= max_attempts THEN ? ELSE error END,
          finished_at = CASE WHEN attempts + 1 >= max_attempts THEN ? ELSE finished_at END,
          attempts = attempts + 1,
          run_at = ?,
          message = ?,
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = ?
      WHERE status = 'running'
        AND ((lease_expires_at IS NOT NULL AND lease_expires_at < ?)
          OR (lease_expires_at IS NULL AND updated_at < ?))`,
    args: [message, now, now, message, now, now, now - LEGACY_STALE_MS],
  });
  return expired.rowsAffected;
}

/** Jobs still in flight (pending or running), regardless of `runAt`. */
export async function countUnfinishedJobs(): Promise<number> {
  await ensureAppTables();
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(marketJobs)
    .where(inArray(marketJobs.status, ACTIVE));
  return Number(rows[0]?.n ?? 0);
}

/** Earliest `runAt` among pending jobs, or null when nothing is queued. */
export async function nextPendingRunAt(): Promise<number | null> {
  await ensureAppTables();
  const rows = await getDb()
    .select({ at: sql<number | null>`min(${marketJobs.runAt})` })
    .from(marketJobs)
    .where(eq(marketJobs.status, "pending"));
  const at = rows[0]?.at;
  return at == null ? null : Number(at);
}

export interface ClaimOpts {
  owner: string;
  now?: number;
  leaseMs?: number;
  lanes?: JobLane[];
  /** Kinds this drainer can run; others stay queued for another process. */
  kinds?: string[];
}

/** Atomically claims the next due job: interactive first, then priority, then age. */
export async function claimNextJob(opts: ClaimOpts): Promise<MarketJobRow | null> {
  await ensureAppTables();
  const now = opts.now ?? Date.now();
  await reclaimExpiredLeases(now);

  const filters: string[] = ["status = 'pending'", "run_at <= ?"];
  const args: (string | number)[] = [now];
  if (opts.lanes?.length) {
    filters.push(`lane IN (${opts.lanes.map(() => "?").join(",")})`);
    args.push(...opts.lanes);
  }
  if (opts.kinds?.length) {
    filters.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
    args.push(...opts.kinds);
  }

  const res = await getClient().execute({
    sql: `UPDATE market_jobs
      SET status = 'running',
          started_at = COALESCE(started_at, ?),
          lease_owner = ?,
          lease_expires_at = ?,
          updated_at = ?
      WHERE id = (
        SELECT id FROM market_jobs
        WHERE ${filters.join(" AND ")}
        ORDER BY (lane = 'interactive') DESC, priority DESC, run_at ASC
        LIMIT 1
      ) AND status = 'pending'
      RETURNING id`,
    args: [now, opts.owner, now + (opts.leaseMs ?? LEASE_MS), now, ...args],
  });
  const id = res.rows[0]?.id;
  if (id == null) return null;
  const rows = await getDb().select().from(marketJobs).where(eq(marketJobs.id, String(id))).limit(1);
  return rows[0] ?? null;
}

/** Extends a lease. False means the job was cancelled or taken over. */
export async function heartbeatJob(
  id: string,
  owner: string,
  leaseMs = LEASE_MS,
): Promise<boolean> {
  const now = Date.now();
  const res = await getClient().execute({
    sql: `UPDATE market_jobs SET lease_expires_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?`,
    args: [now + leaseMs, id, owner],
  });
  return res.rowsAffected > 0;
}

async function getRow(id: string): Promise<MarketJobRow | null> {
  await ensureAppTables();
  const rows = await getDb().select().from(marketJobs).where(eq(marketJobs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateJobProgress(
  id: string,
  text: string,
  opts?: { current?: number; total?: number; stage?: string },
): Promise<void> {
  const row = await getRow(id);
  if (!row || row.status !== "running") return;
  const current = opts?.current ?? row.current;
  const total = opts?.total ?? row.total;
  await getDb()
    .update(marketJobs)
    .set({ message: text, log: pushLog(row.log, text), current, total, updatedAt: Date.now() })
    .where(and(eq(marketJobs.id, id), eq(marketJobs.status, "running")));
  await appendJobEvent(id, row.kind, text, { stage: opts?.stage, current, total });
}

function releaseLease() {
  return { leaseOwner: null, leaseExpiresAt: null };
}

export async function completeJob(
  id: string,
  message?: string,
  result?: unknown,
): Promise<void> {
  const row = await getRow(id);
  if (!row || row.status !== "running") return;
  const now = Date.now();
  await getDb()
    .update(marketJobs)
    .set({
      status: "done",
      message: message ?? row.message,
      log: message ? pushLog(row.log, message, now) : row.log,
      finishedAt: now,
      updatedAt: now,
      current: row.total ?? row.current,
      result: result === undefined ? row.result : JSON.stringify(result),
      ...releaseLease(),
    })
    .where(and(eq(marketJobs.id, id), eq(marketJobs.status, "running")));
  if (message) await appendJobEvent(id, row.kind, message, { stage: "done" });
}

export async function failDbJob(id: string, error: string): Promise<void> {
  const row = await getRow(id);
  if (!row || (row.status !== "running" && row.status !== "pending")) return;
  const now = Date.now();
  await getDb()
    .update(marketJobs)
    .set({
      status: "error",
      message: error,
      error,
      log: pushLog(row.log, error, now),
      finishedAt: now,
      updatedAt: now,
      ...releaseLease(),
    })
    .where(and(eq(marketJobs.id, id), inArray(marketJobs.status, ACTIVE)));
  await appendJobEvent(id, row.kind, error, { stage: "done" });
}

/** Puts a running job back in the queue for `runAt` without spending an attempt. */
export async function rescheduleJob(
  id: string,
  runAt: number,
  message: string,
  patch?: { result?: unknown; current?: number; total?: number },
): Promise<void> {
  const row = await getRow(id);
  if (!row || row.status !== "running") return;
  const now = Date.now();
  await getDb()
    .update(marketJobs)
    .set({
      status: "pending",
      runAt,
      message,
      log: pushLog(row.log, message, now),
      updatedAt: now,
      ...(patch?.result !== undefined ? { result: JSON.stringify(patch.result) } : {}),
      ...(patch?.current != null ? { current: patch.current } : {}),
      ...(patch?.total != null ? { total: patch.total } : {}),
      ...releaseLease(),
    })
    .where(and(eq(marketJobs.id, id), eq(marketJobs.status, "running")));
  await appendJobEvent(id, row.kind, message);
}

export function retryDelayMs(attempts: number, random = Math.random): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts));
  return Math.round(base * (0.8 + random() * 0.4));
}

/** A failed attempt: retry later with backoff, or fail once attempts run out. */
export async function retryOrFailJob(id: string, error: string): Promise<"retry" | "failed"> {
  const row = await getRow(id);
  if (!row || row.status !== "running") return "failed";
  const attempts = row.attempts + 1;
  if (attempts >= row.maxAttempts) {
    await failDbJob(id, `${error} (gave up after ${attempts} attempts)`);
    return "failed";
  }
  const delay = retryDelayMs(row.attempts);
  const now = Date.now();
  const message = `${error} — retry ${attempts}/${row.maxAttempts - 1} in ${Math.round(delay / 1000)}s`;
  await getDb()
    .update(marketJobs)
    .set({
      status: "pending",
      attempts,
      runAt: now + delay,
      message,
      error,
      log: pushLog(row.log, message, now),
      updatedAt: now,
      ...releaseLease(),
    })
    .where(and(eq(marketJobs.id, id), eq(marketJobs.status, "running")));
  await appendJobEvent(id, row.kind, message);
  return "retry";
}

/** Cancels a pending or running job and every active child unit. */
export async function cancelJob(id: string, reason = "Cancelled"): Promise<boolean> {
  await ensureAppTables();
  const now = Date.now();
  const res = await getClient().execute({
    sql: `UPDATE market_jobs
      SET status = 'cancelled', message = ?, finished_at = ?, updated_at = ?,
          lease_owner = NULL, lease_expires_at = NULL
      WHERE (id = ? OR parent_id = ?) AND status IN ('pending','running')`,
    args: [reason, now, now, id, id],
  });
  if (res.rowsAffected > 0) {
    const row = await getRow(id);
    if (row) await appendJobEvent(id, row.kind, reason, { stage: "done" });
  }
  return res.rowsAffected > 0;
}

/**
 * Re-runs a finished (error, cancelled or done) job in place. If an equivalent
 * job is already active, returns that one instead.
 */
export async function requeueJob(id: string): Promise<string | null> {
  const row = await getRow(id);
  if (!row) return null;
  if (row.status === "pending" || row.status === "running") return row.id;
  const now = Date.now();
  const message = "Requeued";
  try {
    await getDb()
      .update(marketJobs)
      .set({
        status: "pending",
        attempts: 0,
        runAt: now,
        error: null,
        finishedAt: null,
        result: null,
        current: null,
        message,
        log: pushLog(row.log, message, now),
        updatedAt: now,
        ...releaseLease(),
      })
      .where(eq(marketJobs.id, id));
  } catch {
    if (row.dedupeKey) {
      const existing = await findActiveByDedupe(row.dedupeKey);
      if (existing) return existing.id;
    }
    return null;
  }
  // The parent fans out fresh units; stale ones would double up on the Runs board.
  await getDb()
    .delete(marketJobs)
    .where(and(eq(marketJobs.parentId, id), notInArray(marketJobs.status, ["pending", "running"])));
  await appendJobEvent(id, row.kind, message);
  return id;
}

export async function getDbJob(id: string): Promise<ProgressJob | null> {
  const row = await getRow(id);
  return row ? rowToProgressJob(row) : null;
}

export async function getJobRows(ids: string[]): Promise<MarketJobRow[]> {
  if (ids.length === 0) return [];
  await ensureAppTables();
  return getDb().select().from(marketJobs).where(inArray(marketJobs.id, ids));
}

export interface ChildSummary {
  total: number;
  pending: number;
  running: number;
  done: number;
  error: number;
  cancelled: number;
}

export function summarizeChildren(rows: Pick<MarketJobRow, "status">[]): ChildSummary {
  const out: ChildSummary = { total: rows.length, pending: 0, running: 0, done: 0, error: 0, cancelled: 0 };
  for (const row of rows) {
    const key = row.status as keyof ChildSummary;
    if (key in out && key !== "total") out[key] += 1;
  }
  return out;
}

export function jobReporter(id: string) {
  return (text: string, opts?: { current?: number; total?: number; stage?: string }) => {
    void updateJobProgress(id, text, opts).catch(() => {});
  };
}

export function parseJobPayload<T>(row: MarketJobRow): T {
  return JSON.parse(row.payload) as T;
}
