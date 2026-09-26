import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { jobSchedules, marketJobs, priceCache } from "@/db/schema";
import { listCraftableCategories } from "@/lib/data/queries";
import { enqueueJob } from "@/lib/jobs/queue";

const HOUR = 60 * 60 * 1000;
const COLLECTOR_LEAGUE_KEY = "collector_league";
export const DEFAULT_COLLECTOR_LEAGUE = "Forbidden Rites";

const SCHEDULED_KINDS = new Set([
  "refresh:prices",
  "scan:gems",
  "scan:tablets",
  "scan:tablet",
  "scan:class",
  "scan:quick",
  "sample:class",
  "probe:class",
]);

export const SCHEDULE_DEFAULTS = [
  { id: "refresh:prices", kind: "refresh:prices", intervalMs: 90 * 60 * 1000 },
  { id: "scan:gems", kind: "scan:gems", intervalMs: 12 * HOUR },
  { id: "scan:tablets", kind: "scan:tablets", intervalMs: 12 * HOUR },
  { id: "scan:class", kind: "scan:class", intervalMs: 6 * HOUR },
] as const;

async function craftableClassNames(): Promise<string[]> {
  const categories = await listCraftableCategories();
  return categories.flatMap((c) => c.classes);
}

export async function ensureDefaultSchedules(now = Date.now()): Promise<void> {
  await ensureAppTables();
  const db = getDb();
  const existing = await db.select({ id: jobSchedules.id }).from(jobSchedules);
  const have = new Set(existing.map((r) => r.id));
  for (const spec of SCHEDULE_DEFAULTS) {
    if (have.has(spec.id)) continue;
    await db.insert(jobSchedules).values({
      id: spec.id,
      kind: spec.kind,
      payload: "{}",
      intervalMs: spec.intervalMs,
      nextRunAt: now,
      enabled: 1,
      updatedAt: now,
    });
  }
}

async function hasActiveJob(kind: string): Promise<boolean> {
  const db = getDb();
  const jobs = await db
    .select({ kind: marketJobs.kind, parentId: marketJobs.parentId })
    .from(marketJobs)
    .where(inArray(marketJobs.status, ["pending", "running"]));
  return jobs.some((j) => j.kind === kind && !j.parentId);
}

export async function getCollectorLeague(): Promise<string> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(priceCache)
    .where(eq(priceCache.key, COLLECTOR_LEAGUE_KEY))
    .limit(1);
  if (!rows[0]) {
    await setCollectorLeague(DEFAULT_COLLECTOR_LEAGUE);
    return DEFAULT_COLLECTOR_LEAGUE;
  }
  try {
    const parsed = JSON.parse(rows[0].payload) as { league?: string };
    const league = parsed.league?.trim();
    return league || DEFAULT_COLLECTOR_LEAGUE;
  } catch {
    return DEFAULT_COLLECTOR_LEAGUE;
  }
}

/** Point every pending scheduled job at this league and remember it for the next passes. */
export async function setCollectorLeague(league: string): Promise<void> {
  const next = league.trim();
  if (!next) throw new Error("League is required");
  await ensureAppTables();
  const db = getDb();
  const now = Date.now();
  await db
    .insert(priceCache)
    .values({
      key: COLLECTOR_LEAGUE_KEY,
      payload: JSON.stringify({ league: next }),
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: priceCache.key,
      set: { payload: JSON.stringify({ league: next }), fetchedAt: now },
    });
  await retargetPendingJobs(next, now);
  const active = await db
    .select({ kind: marketJobs.kind })
    .from(marketJobs)
    .where(inArray(marketJobs.status, ["pending", "running"]));
  const activeKinds = new Set(active.map((row) => row.kind));
  for (const spec of SCHEDULE_DEFAULTS) {
    if (activeKinds.has(spec.kind)) continue;
    await db
      .update(jobSchedules)
      .set({ nextRunAt: now, updatedAt: now })
      .where(eq(jobSchedules.id, spec.id));
  }
}

async function retargetPendingJobs(league: string, now: number): Promise<void> {
  const db = getDb();
  const pending = await db
    .select()
    .from(marketJobs)
    .where(eq(marketJobs.status, "pending"));
  for (const row of pending) {
    if (!SCHEDULED_KINDS.has(row.kind)) continue;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (payload.league === league) continue;
    payload.league = league;
    if ("scanStartedAt" in payload) payload.scanStartedAt = now;
    const message = `League set to ${league} — this pass will use that league.`;
    await db
      .update(marketJobs)
      .set({
        payload: JSON.stringify(payload),
        message,
        updatedAt: now,
      })
      .where(eq(marketJobs.id, row.id));
  }
}

export async function tickSchedules(now = Date.now()): Promise<number> {
  await ensureDefaultSchedules(now);
  const db = getDb();
  const league = await getCollectorLeague();
  await retargetPendingJobs(league, now);
  const due = await db.select().from(jobSchedules).where(eq(jobSchedules.enabled, 1));
  let enqueued = 0;

  for (const row of due) {
    if (row.nextRunAt > now) continue;
    if (await hasActiveJob(row.kind)) continue;

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    if (row.kind === "scan:class") {
      const names = await craftableClassNames();
      if (names.length === 0) continue;
      const index = Number(payload.classIndex ?? 0) % names.length;
      const itemClass = names[index]!;
      await enqueueJob({
        kind: "scan:class",
        payload: { league, itemClass, itemLevel: 82 },
      });
      payload = { classIndex: (index + 1) % names.length };
    } else if (row.kind === "refresh:prices") {
      await enqueueJob({ kind: "refresh:prices", payload: { league } });
    } else {
      await enqueueJob({
        kind: row.kind,
        payload: { league, scanStartedAt: now },
      });
    }

    await db
      .update(jobSchedules)
      .set({
        payload: JSON.stringify(payload),
        nextRunAt: now + row.intervalMs,
        updatedAt: now,
      })
      .where(eq(jobSchedules.id, row.id));
    enqueued += 1;
  }
  return enqueued;
}
