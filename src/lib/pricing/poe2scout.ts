import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { priceCache } from "@/db/schema";

/**
 * Price data client for Path of Exile 2.
 *
 * Source: poe2scout.com (open-source, MIT) — a PoE2-native market tracker
 * built on the in-game Currency Exchange. We use it instead of poe.ninja
 * because poe.ninja's PoE2 economy API is not reliably reachable server-side,
 * whereas poe2scout exposes a clean, documented JSON API.
 *
 * All prices are expressed in Exalted Orbs (the PoE2 base currency). The
 * Divine Orb price for the league lets us also show Divine-equivalent values.
 */

const BASE_URL = "https://poe2scout.com/api/poe2";
const USER_AGENT =
  "poe2-crafting-helper/0.1 (local-first dev tool; contact: set-your-email@example.com)";
const CACHE_TTL_MS = 60 * 60 * 1000; // poe2scout updates ~hourly
// All material categories poe2scout tracks, so essences/omens/fragments/etc.
// are all priced (used by the Materials page and the crafting solver).
const CATEGORIES = [
  "currency",
  "fragments",
  "runes",
  "essences",
  "ultimatum",
  "expedition",
  "ritual",
  "vaultkeys",
  "breach",
  "abyss",
  "uncutgems",
  "lineagesupportgems",
  "delirium",
  "incursion",
  "idol",
  "vaal",
] as const;

export interface PoeLeague {
  value: string;
  shortName: string;
  isCurrent: boolean;
  divinePrice: number; // in Exalted Orbs
  baseCurrencyText: string;
}

export interface PricedItem {
  apiId: string;
  name: string;
  category: string;
  iconUrl: string | null;
  priceExalted: number;
  description: string | null;
}

export interface PriceData {
  league: string;
  divinePrice: number;
  items: PricedItem[];
  fetchedAt: number;
  stale: boolean;
}

const leagueSchema = z.object({
  Value: z.string(),
  ShortName: z.string().optional().default(""),
  IsCurrent: z.boolean().optional().default(false),
  DivinePrice: z.number().optional().default(0),
  BaseCurrencyText: z.string().optional().default("Exalted Orb"),
});

const currencyItemSchema = z
  .object({
    ApiId: z.string(),
    Text: z.string(),
    CategoryApiId: z.string().optional(),
    IconUrl: z.string().nullable().optional(),
    CurrentPrice: z.number().nullable().optional(),
    ItemMetadata: z
      .object({ description: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const byCategorySchema = z.object({
  CurrentPage: z.number().optional(),
  Pages: z.number().optional(),
  Items: z.array(currencyItemSchema).default([]),
});

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    // Next.js fetch cache: revalidate hourly as a secondary layer.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`poe2scout ${res.status} for ${url}`);
  }
  return res.json();
}

export async function getLeagues(): Promise<PoeLeague[]> {
  const raw = await fetchJson(`${BASE_URL}/Leagues`);
  const arr = z.array(leagueSchema).parse(raw);
  return arr.map((l) => ({
    value: l.Value,
    shortName: l.ShortName,
    isCurrent: l.IsCurrent,
    divinePrice: l.DivinePrice,
    baseCurrencyText: l.BaseCurrencyText,
  }));
}

export async function getCurrentLeagueName(): Promise<string> {
  const leagues = await getLeagues();
  // Prefer the current softcore (non-HC) temp league.
  const sc = leagues.find((l) => l.isCurrent && !l.value.startsWith("HC"));
  if (sc) return sc.value;
  const anyCurrent = leagues.find((l) => l.isCurrent);
  return anyCurrent?.value ?? "Standard";
}

async function fetchCategory(
  league: string,
  category: string,
): Promise<PricedItem[]> {
  const out: PricedItem[] = [];
  const base = `${BASE_URL}/Leagues/${encodeURIComponent(
    league,
  )}/Currencies/ByCategory?Category=${encodeURIComponent(category)}&PerPage=200`;

  let page = 1;
  let pages = 1;
  do {
    const raw = await fetchJson(`${base}&Page=${page}`);
    const parsed = byCategorySchema.parse(raw);
    pages = parsed.Pages ?? 1;
    for (const i of parsed.Items) {
      if (!i.CurrentPrice || i.CurrentPrice <= 0) continue;
      out.push({
        apiId: i.ApiId,
        name: i.Text,
        category: i.CategoryApiId ?? category,
        iconUrl: i.IconUrl ?? null,
        priceExalted: i.CurrentPrice,
        description: i.ItemMetadata?.description ?? null,
      });
    }
    page += 1;
  } while (page <= pages);

  return out;
}

async function readCache(key: string): Promise<PriceData | null> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(priceCache)
      .where(eq(priceCache.key, key))
      .limit(1);
    if (!rows[0]) return null;
    return JSON.parse(rows[0].payload) as PriceData;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: PriceData): Promise<void> {
  try {
    const db = getDb();
    await db
      .insert(priceCache)
      .values({ key, payload: JSON.stringify(data), fetchedAt: data.fetchedAt })
      .onConflictDoUpdate({
        target: priceCache.key,
        set: { payload: JSON.stringify(data), fetchedAt: data.fetchedAt },
      });
  } catch {
    // Cache writes are best-effort.
  }
}

async function fetchFreshPrices(league: string): Promise<PriceData> {
  const leagues = await getLeagues();
  const divinePrice = leagues.find((l) => l.value === league)?.divinePrice ?? 0;

  const perCategory = await Promise.all(
    CATEGORIES.map((c) =>
      fetchCategory(league, c).catch((err) => {
        console.warn(`poe2scout: skipping category ${c}: ${err}`);
        return [] as PricedItem[];
      }),
    ),
  );
  const items = perCategory.flat();

  // Exalted Orb is the base unit.
  if (!items.some((i) => i.name === "Exalted Orb")) {
    items.unshift({
      apiId: "exalted",
      name: "Exalted Orb",
      category: "currency",
      iconUrl: null,
      priceExalted: 1,
      description: "The base currency unit for pricing.",
    });
  }
  items.sort((a, b) => b.priceExalted - a.priceExalted);

  const data: PriceData = {
    league,
    divinePrice,
    items,
    fetchedAt: Date.now(),
    stale: false,
  };
  await writeCache(`prices:${league}`, data);
  return data;
}

// One in-flight refresh per league, shared by blocking and background callers.
const inflight = new Map<string, Promise<PriceData>>();

function refreshPrices(league: string): Promise<PriceData> {
  let p = inflight.get(league);
  if (!p) {
    p = fetchFreshPrices(league).finally(() => inflight.delete(league));
    inflight.set(league, p);
  }
  return p;
}

/**
 * Returns priced currency/material data for a league, cached for an hour with
 * stale-while-revalidate: an expired cache entry is served immediately while
 * a background refresh updates it for the next reader. Only a cold cache
 * blocks on the network; on failure the last snapshot is returned (marked
 * stale).
 */
export async function getPrices(leagueName?: string): Promise<PriceData> {
  const league = leagueName ?? (await getCurrentLeagueName());
  const cacheKey = `prices:${league}`;

  const cached = await readCache(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached, stale: false };
  }

  if (cached) {
    // Serve stale instantly; refresh in the background (errors are logged
    // and the stale snapshot simply stays in place).
    refreshPrices(league).catch((err) =>
      console.warn(`poe2scout: background refresh failed: ${err}`),
    );
    return { ...cached, stale: true };
  }

  // Cold cache: block on the first fetch.
  return refreshPrices(league);
}

/**
 * Map of apiId -> price in Exalted Orbs for the given league. Used to join live
 * prices to materials (by apiId) and to estimate crafting costs in the solver.
 * Returns an empty map on failure rather than throwing.
 */
export async function getPriceByApiId(
  leagueName?: string,
): Promise<Map<string, number>> {
  try {
    const data = await getPrices(leagueName);
    const map = new Map<string, number>();
    for (const i of data.items) map.set(i.apiId, i.priceExalted);
    return map;
  } catch {
    return new Map();
  }
}
