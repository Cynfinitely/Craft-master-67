import { and, asc, eq, lte } from "drizzle-orm";
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
  const id = opts.id ?? `job-${now}-${Math.random().toString(36).slice(2, 9)}`;
  await db.insert(marketJobs).values({
    id,
    kind: opts.kind,
    payload: JSON.stringify(opts.payload),
    status: "pending",
    message: "Queued",
    log: JSON.stringify([{ at: now, text: "Queued" }]),
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

export async function claimNextJob(): Promise<MarketJobRow | null> {
  await ensureAppTables();
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
