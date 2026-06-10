import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { priceCache } from "@/db/schema";

/**
 * Converts trade-listing prices (e.g. "1 aug", "2 divine") into Exalted Orbs.
 *
 * Trade currency tags differ from poe2scout apiIds, so we map the common ones
 * and keep conservative static fallbacks for when live prices are missing.
 */

/** trade currency tag -> poe2scout apiId */
const TRADE_TO_SCOUT: Record<string, string> = {
  exalted: "exalted",
  divine: "divine",
  chaos: "chaos",
  alch: "alch",
  annul: "annul",
  regal: "regal",
  vaal: "vaal",
  aug: "augmentation",
  transmute: "transmutation",
  mirror: "mirror",
  "exalted-orb": "exalted",
  "chance-shard": "chance-shard",
  gcp: "gemcutters-prism",
  fracturing: "fracturing-orb",
};

/** Static fallback prices in Exalted Orbs (conservative). */
const STATIC_EXALTED: Record<string, number> = {
  exalted: 1,
  divine: 200,
  chaos: 0.5,
  alch: 0.25,
  annul: 2,
  regal: 0.3,
  vaal: 1.5,
  aug: 0.05,
  transmute: 0.02,
  mirror: 100000,
};

/**
 * Price map (poe2scout apiId -> exalted) read from the local `price_cache`
 * table only — no network. Works in scripts as well as the web app (the app
 * keeps the cache warm via `getPrices`).
 */
export async function getCachedPriceMap(league?: string): Promise<Map<string, number>> {
  try {
    const db = getDb();
    const rows = league
      ? await db
          .select()
          .from(priceCache)
          .where(eq(priceCache.key, `prices:${league}`))
          .limit(1)
      : await db.select().from(priceCache);
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.key.startsWith("prices:")) continue;
      try {
        const data = JSON.parse(row.payload) as {
          items?: { apiId: string; priceExalted: number }[];
        };
        for (const i of data.items ?? []) {
          if (!map.has(i.apiId)) map.set(i.apiId, i.priceExalted);
        }
      } catch {
        /* skip malformed cache rows */
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Converts a trade price to Exalted Orbs, or null when the currency is
 * unknown (so callers can skip mispriced/exotic listings).
 */
export function tradePriceToExalted(
  amount: number,
  currency: string,
  priceMap: Map<string, number>,
): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const tag = currency.toLowerCase();
  const scoutId = TRADE_TO_SCOUT[tag];
  if (scoutId) {
    const live = priceMap.get(scoutId);
    if (live && live > 0) return amount * live;
  }
  const fallback = STATIC_EXALTED[tag];
  if (fallback != null) return amount * fallback;
  // Last resort: maybe the trade tag IS a poe2scout apiId (essences, omens...).
  const direct = priceMap.get(tag);
  if (direct && direct > 0) return amount * direct;
  return null;
}
