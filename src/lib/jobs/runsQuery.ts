import "server-only";
import { and, desc, inArray, isNull, notInArray } from "drizzle-orm";
import { getDb, isRemoteDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { jobEvents, jobSchedules, marketJobs, type MarketJobRow } from "@/db/schema";
import { ensureDefaultSchedules, getCollectorLeague } from "@/lib/jobs/schedules";
import { liveDrainers } from "@/lib/jobs/workers";
import { getLeagues } from "@/lib/pricing/poe2scout";
import { LANE_HEADROOM, readSavedBudget } from "@/lib/trade/rateLimiter";
import { buildStageRail, type RailEvent } from "@/lib/jobs/stages";
import type { RunCard, RunUnit, RunsBoardData, ScheduleCard } from "@/lib/jobs/runsTypes";

export type { RunCard, RunsBoardData, ScheduleCard };

const ACTIVE = ["pending", "running"];
const RECENT_FINISHED = 25;

function parsePayload(payload: string): Record<string, unknown> {
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function unitLabel(row: MarketJobRow): string {
  const p = parsePayload(row.payload);
  return String(p.tablet ?? p.itemClass ?? p.gemType ?? row.kind);
}

/** Finish estimate from the average duration of finished units. */
export function estimateEta(units: Pick<MarketJobRow, "status" | "startedAt" | "finishedAt">[], now: number): number | null {
  const finished = units.filter((u) => u.status === "done" && u.startedAt && u.finishedAt);
  const left = units.filter((u) => u.status === "pending" || u.status === "running").length;
  if (finished.length === 0 || left === 0) return null;
  const avg =
    finished.reduce((sum, u) => sum + (u.finishedAt! - u.startedAt!), 0) / finished.length;
  return now + Math.round(avg * left);
}

function toCard(
  row: MarketJobRow,
  events: RailEvent[],
  children: MarketJobRow[],
  nextRunAt: number | null,
  now: number,
): RunCard {
  const units: RunUnit[] = children.map((c) => ({
    id: c.id,
    label: unitLabel(c),
    status: c.status,
    message: c.message,
    runAt: c.runAt,
    current: c.current,
    total: c.total,
  }));
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    message: row.message,
    league: String(parsePayload(row.payload).league ?? "").trim(),
    runAt: row.runAt,
    current: row.current,
    total: row.total,
    updatedAt: row.updatedAt,
    lane: row.lane,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    events,
    units,
    etaAt: children.length ? estimateEta(children, now) : null,
    stages: buildStageRail(
      {
        kind: row.kind,
        status: row.status,
        message: row.message,
        runAt: row.runAt,
        current: row.current,
        total: row.total,
      },
      events,
      nextRunAt,
      now,
    ),
  };
}

export async function loadRunsBoard(now = Date.now()): Promise<RunsBoardData> {
  await ensureAppTables();
  await ensureDefaultSchedules(now);
  const db = getDb();

  const [active, recent] = await Promise.all([
    db
      .select()
      .from(marketJobs)
      .where(and(isNull(marketJobs.parentId), inArray(marketJobs.status, ACTIVE)))
      .orderBy(desc(marketJobs.priority), marketJobs.runAt),
    db
      .select()
      .from(marketJobs)
      .where(and(isNull(marketJobs.parentId), notInArray(marketJobs.status, ACTIVE)))
      .orderBy(desc(marketJobs.updatedAt))
      .limit(RECENT_FINISHED),
  ]);
  const jobs = [...active, ...recent];
  const ids = jobs.map((j) => j.id);
  const [children, eventRows] = ids.length
    ? await Promise.all([
        db.select().from(marketJobs).where(inArray(marketJobs.parentId, ids)),
        db.select().from(jobEvents).where(inArray(jobEvents.jobId, ids)).orderBy(jobEvents.at),
      ])
    : [[], []];

  const childrenOf = new Map<string, MarketJobRow[]>();
  for (const c of children) {
    const list = childrenOf.get(c.parentId!) ?? [];
    list.push(c);
    childrenOf.set(c.parentId!, list);
  }
  const byJob = new Map<string, RailEvent[]>();
  for (const event of eventRows) {
    const list = byJob.get(event.jobId) ?? [];
    list.push({ at: event.at, stage: event.stage, text: event.text });
    byJob.set(event.jobId, list.length > 80 ? list.slice(-80) : list);
  }

  const schedules = await db.select().from(jobSchedules);
  const nextByKind = new Map(schedules.map((s) => [s.kind, s.nextRunAt]));
  const card = (job: MarketJobRow) =>
    toCard(
      job,
      byJob.get(job.id) ?? [],
      (childrenOf.get(job.id) ?? []).sort((a, b) => unitLabel(a).localeCompare(unitLabel(b))),
      nextByKind.get(job.kind) ?? null,
      now,
    );
  const activeCards = active.map(card);
  const activeKinds = new Set(active.map((j) => j.kind));

  const [budget, workers, collectorLeague] = await Promise.all([
    readSavedBudget("background"),
    liveDrainers(undefined, now).catch(() => []),
    getCollectorLeague(),
  ]);

  const blockedUntil = Math.max(0, ...(budget?.usage.map((p) => p.blockedUntil) ?? []));
  const summary =
    blockedUntil > now
      ? "Trade API paused by a penalty or Retry-After."
      : budget
        ? "Trade budget is healthy."
        : "No trade requests recorded yet.";

  let known: string[] = [];
  try {
    known = (await getLeagues()).map((l) => l.value);
  } catch {
    known = [];
  }
  const leagueOptions = [...new Set([collectorLeague, "Forbidden Rites", "Runes of Aldur", "Standard", ...known])];

  return {
    now,
    interactive: activeCards.filter((c) => c.lane === "interactive"),
    running: activeCards.filter((c) => c.lane !== "interactive" && c.status === "running"),
    waiting: activeCards.filter((c) => c.lane !== "interactive" && c.status === "pending"),
    past: recent.map(card),
    upcoming: schedules
      .filter((s) => s.enabled && !activeKinds.has(s.kind))
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        nextRunAt: s.nextRunAt,
        intervalMs: s.intervalMs,
        enabled: s.enabled === 1,
      })),
    rate: { nextAllowedAt: blockedUntil, summary },
    budget: budget
      ? {
          policies: budget.usage,
          savedAt: budget.savedAt,
          observed: budget.observed,
          headroom: LANE_HEADROOM,
        }
      : null,
    workers: workers.map((w) => ({ id: w.id, kind: w.kind, seenAt: w.seenAt, currentJob: w.currentJob })),
    remote: isRemoteDb(),
    collectorLeague,
    leagueOptions,
  };
}
