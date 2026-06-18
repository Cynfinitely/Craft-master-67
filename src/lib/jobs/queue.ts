import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { marketJobs, type MarketJobRow } from "@/db/schema";
import type { ProgressEvent, ProgressJob } from "@/lib/progress";

export interface EnqueueJobOpts {
  id?: string;
  kind: string;
  payload: Record<string, unknown>;
  runAt?: number;
}

const STALE_RUNNING_MS = 5 * 60 * 1000;

function parseLog(raw: string): ProgressEvent[] {
  try {
    const parsed = JSON.parse(raw) as ProgressEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToProgressJob(row: MarketJobRow): ProgressJob {
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
  };
}

export async function enqueueJob(opts: EnqueueJobOpts): Promise<string> {
  await ensureAppTables();
  const db = getDb();
  const now = Date.now();

  if (opts.kind === "scan:gems") {
    const league = String(opts.payload.league ?? "");
    if (league) {
      const existing = await findActiveGemScanJob(league);
      if (existing) return existing.id;
    }
  }

  const id = opts.id ?? `job-${now}-${Math.random().toString(36).slice(2, 9)}`;
  const initialMessage =
    opts.kind === "scan:gems"
      ? "Starting scan — discovering valuable 21/20 gems…"
      : "Queued";
  await db.insert(marketJobs).values({
    id,
    kind: opts.kind,
    payload: JSON.stringify(opts.payload),
    status: "pending",
    message: initialMessage,
    log: JSON.stringify([{ at: now, text: initialMessage }]),
    current: null,
    total: null,
    runAt: opts.runAt ?? now,
    startedAt: null,
    finishedAt: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Active scan:gems job for a league (pending or running), if any. */
export async function getActiveGemScanJob(
  league: string,
): Promise<MarketJobRow | null> {
  return findActiveGemScanJob(league);
}

async function findActiveGemScanJob(league: string): Promise<MarketJobRow | null> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(marketJobs)
    .where(
      and(
        eq(marketJobs.kind, "scan:gems"),
        inArray(marketJobs.status, ["pending", "running"]),
      ),
    );
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { league?: string };
      if (payload.league === league) return row;
    } catch {
      /* skip malformed payload */
    }
  }
  return null;
}

async function reclaimStaleRunningJobs(): Promise<void> {
  await ensureAppTables();
  const db = getDb();
  const now = Date.now();
  const cutoff = now - STALE_RUNNING_MS;
  const stale = await db
    .select()
    .from(marketJobs)
    .where(
      and(eq(marketJobs.status, "running"), lte(marketJobs.updatedAt, cutoff)),
    );
  for (const row of stale) {
    const log = parseLog(row.log);
    const message = "Recovered stale job — resuming…";
    log.push({ at: now, text: message });
    await db
      .update(marketJobs)
      .set({
        status: "pending",
        runAt: now,
        message,
        log: JSON.stringify(log),
        updatedAt: now,
      })
      .where(eq(marketJobs.id, row.id));
  }
}

/**
 * Number of jobs still in flight (pending or running), regardless of `runAt`.
 * Used by the in-process pump to decide whether to keep polling for rescheduled
 * work (e.g. the +8s between-batch reschedules or a rate-limit backoff).
 */
export async function countUnfinishedJobs(): Promise<number> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select({ id: marketJobs.id })
    .from(marketJobs)
    .where(inArray(marketJobs.status, ["pending", "running"]));
  return rows.length;
}

export async function claimNextJob(): Promise<MarketJobRow | null> {
  await ensureAppTables();
  await reclaimStaleRunningJobs();
  const db = getDb();
  const now = Date.now();
  const rows = await db
    .select()
    .from(marketJobs)
    .where(and(eq(marketJobs.status, "pending"), lte(marketJobs.runAt, now)))
    .orderBy(asc(marketJobs.runAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db
    .update(marketJobs)
    .set({
      status: "running",
      startedAt: now,
      updatedAt: now,
      message: "Running…",
    })
    .where(eq(marketJobs.id, row.id));
  return { ...row, status: "running", startedAt: now, updatedAt: now };
}

export async function updateJobProgress(
  id: string,
  text: string,
  opts?: { current?: number; total?: number },
): Promise<void> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(marketJobs)
    .where(eq(marketJobs.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.status !== "running") return;
  const log = parseLog(row.log);
  log.push({ at: Date.now(), text });
  const trimmed = log.length > 60 ? log.slice(log.length - 60) : log;
  await db
    .update(marketJobs)
    .set({
      message: text,
      log: JSON.stringify(trimmed),
      current: opts?.current ?? row.current,
      total: opts?.total ?? row.total,
      updatedAt: Date.now(),
    })
    .where(eq(marketJobs.id, id));
}

export async function completeJob(id: string, message?: string): Promise<void> {
  await ensureAppTables();
  const db = getDb();
  const now = Date.now();
  const rows = await db
    .select()
    .from(marketJobs)
    .where(eq(marketJobs.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const log = parseLog(row.log);
  if (message) log.push({ at: now, text: message });
  await db
    .update(marketJobs)
    .set({
      status: "done",
      message: message ?? row.message,
      log: JSON.stringify(log),
      finishedAt: now,
      updatedAt: now,
      current: row.total ?? row.current,
    })
    .where(eq(marketJobs.id, id));
}

export async function failDbJob(id: string, error: string): Promise<void> {
  await ensureAppTables();
  const db = getDb();
  const now = Date.now();
  const rows = await db
    .select()
    .from(marketJobs)
    .where(eq(marketJobs.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const log = parseLog(row.log);
  log.push({ at: now, text: error });
  await db
    .update(marketJobs)
    .set({
      status: "error",
      message: error,
      error,
      log: JSON.stringify(log),
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(marketJobs.id, id));
}

export async function rescheduleJob(
  id: string,
  runAt: number,
  message: string,
): Promise<void> {
  await ensureAppTables();
  const db = getDb();
  const now = Date.now();
  const rows = await db
    .select()
    .from(marketJobs)
    .where(eq(marketJobs.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  const log = parseLog(row.log);
  log.push({ at: now, text: message });
  await db
    .update(marketJobs)
    .set({
      status: "pending",
      runAt,
      message,
      log: JSON.stringify(log),
      updatedAt: now,
    })
    .where(eq(marketJobs.id, id));
}

export async function getDbJob(id: string): Promise<ProgressJob | null> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(marketJobs)
    .where(eq(marketJobs.id, id))
    .limit(1);
  return rows[0] ? rowToProgressJob(rows[0]) : null;
}

export function jobReporter(id: string) {
  return (text: string, opts?: { current?: number; total?: number }) => {
    void updateJobProgress(id, text, opts);
  };
}

export function parseJobPayload<T>(row: MarketJobRow): T {
  return JSON.parse(row.payload) as T;
}
