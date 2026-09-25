import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { priceCache } from "@/db/schema";
import type { TabletOverviewLine } from "./logic";

/**
 * One poe.ninja economy snapshot for precursor tablets.
 * The site refreshes PoE 2 about hourly and HTTP-caches the body for ~5 minutes.
 * We keep the parsed lines for an hour and send If-None-Match on refresh.
 */

const NINJA = "https://poe.ninja";
const USER_AGENT =
  "poe2-crafting-helper/0.1 (local crafting helper; precursor tablet prices)";
const CACHE_TTL_MS = 60 * 60 * 1000;

const modifierSchema = z
  .object({ text: z.string().optional().default("") })
  .passthrough();

const lineSchema = z
  .object({
    baseType: z.string().optional().default(""),
    primaryValue: z.number().optional().default(0),
    listingCount: z.number().optional().default(0),
    explicitModifiers: z.array(modifierSchema).optional().default([]),
  })
  .passthrough();

const overviewSchema = z.object({
  lines: z.array(lineSchema).default([]),
  core: z
    .object({
      primary: z.string().optional(),
      rates: z.record(z.number()).optional(),
    })
    .optional(),
});

const leagueSchema = z.object({
  id: z.string(),
  name: z.string().optional().default(""),
});

interface CachedOverview {
  etag: string | null;
  lines: TabletOverviewLine[];
  exaltedPerDivine: number;
  fetchedAt: number;
}

export interface PrecursorOverview {
  leagueId: string;
  lines: TabletOverviewLine[];
  /** Ninja's exalted-per-divine rate, used when poe2scout has no divine price. */
  exaltedPerDivine: number;
  fetchedAt: number;
}

function cacheKey(leagueId: string): string {
  return `ninja:precursor:${leagueId}`;
}

async function readCache(key: string): Promise<CachedOverview | null> {
  try {
    await ensureAppTables();
    const rows = await getDb()
      .select()
      .from(priceCache)
      .where(eq(priceCache.key, key))
      .limit(1);
    if (!rows[0]) return null;
    return JSON.parse(rows[0].payload) as CachedOverview;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: CachedOverview): Promise<void> {
  try {
    await ensureAppTables();
    await getDb()
      .insert(priceCache)
      .values({
        key,
        payload: JSON.stringify(data),
        fetchedAt: data.fetchedAt,
      })
      .onConflictDoUpdate({
        target: priceCache.key,
        set: { payload: JSON.stringify(data), fetchedAt: data.fetchedAt },
      });
  } catch {
    /* best-effort */
  }
}

async function ninjaGet(path: string, etag?: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(`${NINJA}${path}`, { headers, cache: "no-store" });
  return res;
}

/** Match a poe2scout league name to a poe.ninja economy league id. */
export async function resolveNinjaLeagueId(leagueName: string): Promise<string> {
  const res = await ninjaGet("/poe2/api/economy/leagues");
  if (!res.ok) {
    throw new Error(`poe.ninja leagues ${res.status}`);
  }
  const leagues = z.array(leagueSchema).parse(await res.json());
  const want = leagueName.trim().toLowerCase();
  const hit = leagues.find(
    (l) => l.id.toLowerCase() === want || l.name.toLowerCase() === want,
  );
  if (!hit) {
    throw new Error(`poe.ninja has no economy league named "${leagueName}".`);
  }
  return hit.id;
}

function toLines(raw: z.infer<typeof overviewSchema>): {
  lines: TabletOverviewLine[];
  exaltedPerDivine: number;
} {
  const lines: TabletOverviewLine[] = raw.lines
    .filter((l) => l.baseType)
    .map((l) => ({
      baseType: l.baseType,
      primaryValue: l.primaryValue,
      listingCount: l.listingCount,
      explicitModifiers: l.explicitModifiers
        .filter((m) => m.text.trim())
        .map((m) => ({ text: m.text })),
    }));
  const exaltedPerDivine = raw.core?.rates?.exalted ?? 0;
  return { lines, exaltedPerDivine };
}

/**
 * Precursor tablet overview for one league. Serves the hour-long cache,
 * revalidates with ETag, and keeps the last body if the live request fails.
 */
export async function fetchPrecursorOverview(leagueName: string): Promise<PrecursorOverview> {
  const leagueId = await resolveNinjaLeagueId(leagueName);
  const key = cacheKey(leagueId);
  const cached = await readCache(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      leagueId,
      lines: cached.lines,
      exaltedPerDivine: cached.exaltedPerDivine,
      fetchedAt: cached.fetchedAt,
    };
  }

  const path = `/poe2/api/economy/stash/current/item/overview?league=${encodeURIComponent(leagueId)}&type=PrecursorTablets`;
  try {
    const res = await ninjaGet(path, cached?.etag);
    if (res.status === 304 && cached) {
      const fresh = { ...cached, fetchedAt: Date.now() };
      await writeCache(key, fresh);
      return {
        leagueId,
        lines: fresh.lines,
        exaltedPerDivine: fresh.exaltedPerDivine,
        fetchedAt: fresh.fetchedAt,
      };
    }
    if (!res.ok) {
      throw new Error(`poe.ninja precursor tablets ${res.status}`);
    }
    const parsed = overviewSchema.parse(await res.json());
    const body = toLines(parsed);
    const stored: CachedOverview = {
      etag: res.headers.get("etag"),
      lines: body.lines,
      exaltedPerDivine: body.exaltedPerDivine,
      fetchedAt: Date.now(),
    };
    await writeCache(key, stored);
    return {
      leagueId,
      lines: stored.lines,
      exaltedPerDivine: stored.exaltedPerDivine,
      fetchedAt: stored.fetchedAt,
    };
  } catch (err) {
    if (cached) {
      return {
        leagueId,
        lines: cached.lines,
        exaltedPerDivine: cached.exaltedPerDivine,
        fetchedAt: cached.fetchedAt,
      };
    }
    throw err;
  }
}
