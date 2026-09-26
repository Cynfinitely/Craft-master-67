import os from "node:os";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { workerHeartbeats } from "@/db/schema";

export type DrainerKind = "worker" | "pump";

/** A worker that has not beaten in this long is treated as offline. */
export const WORKER_FRESH_MS = 30_000;

export function newDrainerId(kind: DrainerKind): string {
  return `${kind}-${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function beatDrainer(
  id: string,
  kind: DrainerKind,
  startedAt: number,
  currentJob: string | null,
  info?: Record<string, unknown>,
): Promise<void> {
  await ensureAppTables();
  const now = Date.now();
  const row = {
    id,
    kind,
    startedAt,
    seenAt: now,
    currentJob,
    info: info ? JSON.stringify(info) : null,
  };
  await getDb()
    .insert(workerHeartbeats)
    .values(row)
    .onConflictDoUpdate({
      target: workerHeartbeats.id,
      set: { seenAt: now, currentJob, info: row.info },
    });
}

export async function removeDrainer(id: string): Promise<void> {
  await getDb().delete(workerHeartbeats).where(eq(workerHeartbeats.id, id));
}

export interface LiveDrainer {
  id: string;
  kind: DrainerKind;
  startedAt: number;
  seenAt: number;
  currentJob: string | null;
}

export async function liveDrainers(kind?: DrainerKind, now = Date.now()): Promise<LiveDrainer[]> {
  await ensureAppTables();
  const fresh = gte(workerHeartbeats.seenAt, now - WORKER_FRESH_MS);
  const rows = await getDb()
    .select()
    .from(workerHeartbeats)
    .where(kind ? and(fresh, eq(workerHeartbeats.kind, kind)) : fresh);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as DrainerKind,
    startedAt: r.startedAt,
    seenAt: r.seenAt,
    currentJob: r.currentJob,
  }));
}

export async function hasLiveWorker(): Promise<boolean> {
  try {
    return (await liveDrainers("worker")).length > 0;
  } catch {
    return false;
  }
}
