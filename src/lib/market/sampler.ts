import { getClient } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import {
  searchAndFetch,
  tradeSiteUrl,
  type ListingStat,
  type TradeListing,
} from "@/lib/trade/client";
import { getCachedPriceMap, tradePriceToExalted } from "@/lib/trade/currency";
import { tradeCategoryForClass } from "./categories";

/**
 * Samples live rare-item listings from the trade site into `market_samples`.
 *
 * A run does several cheap passes across the price spectrum (price-ascending
 * with rising minimum-price floors) instead of sorting descending, which
 * mostly surfaces mirror-tier troll listings. Each pass is one search + a few
 * fetches, all rate-limit budgeted and cached by the trade client.
 */

export interface SampleRunResult {
  league: string;
  itemClass: string;
  inserted: number;
  fetched: number;
  /** Total matching listings reported by the cheapest-pass search. */
  totalListings: number;
  tradeUrl: string | null;
}

/** Min-price floors (in Exalted) for the sampling passes. */
const PASS_FLOORS = [0, 25, 250];
const LISTINGS_PER_PASS = 20;

function buildQuery(opts: {
  itemClass: string;
  baseType?: string;
  minPriceExalted?: number;
  ilvlMin?: number;
}): Record<string, unknown> | null {
  const category = tradeCategoryForClass(opts.itemClass);
  if (!category && !opts.baseType) return null;
  return {
    query: {
      status: { option: "online" },
      ...(opts.baseType ? { type: opts.baseType } : {}),
      stats: [{ type: "and", filters: [] }],
      filters: {
        type_filters: {
          filters: {
            rarity: { option: "rare" },
            ...(category && !opts.baseType
              ? { category: { option: category } }
              : {}),
          },
        },
        ...(opts.ilvlMin
          ? { misc_filters: { filters: { ilvl: { min: opts.ilvlMin } } } }
          : {}),
        ...(opts.minPriceExalted
          ? {
              trade_filters: {
                filters: {
                  price: { option: "exalted", min: opts.minPriceExalted },
                },
              },
            }
          : {}),
      },
    },
    sort: { price: "asc" },
  };
}

function explicitStats(listing: TradeListing): ListingStat[] {
  return listing.explicitStats.filter((s) => s.hash.startsWith("explicit."));
}

async function persistListings(
  league: string,
  itemClass: string,
  listings: TradeListing[],
  priceMap: Map<string, number>,
): Promise<number> {
  await ensureAppTables();
  const client = getClient();
  const now = Date.now();
  const statements = [];
  for (const l of listings) {
    if (!l.price) continue;
    const stats = explicitStats(l);
    if (stats.length === 0) continue;
    const exalted = tradePriceToExalted(l.price.amount, l.price.currency, priceMap);
    if (exalted == null || exalted <= 0) continue;
    statements.push({
      sql: `INSERT OR REPLACE INTO market_samples
        (listing_id, league, item_class, base_type, name, ilvl, rarity,
         price_amount, price_currency, price_exalted, indexed_at, fetched_at, stats, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade')`,
      args: [
        l.id,
        league,
        itemClass,
        l.baseType,
        l.name,
        l.ilvl,
        l.rarity,
        l.price.amount,
        l.price.currency,
        exalted,
        l.indexed,
        now,
        JSON.stringify(stats),
      ],
    });
  }
  if (statements.length === 0) return 0;
  await client.batch(statements, "write");
  return statements.length;
}

/**
 * Runs a sampling pass set for an item class (optionally narrowed to one base
 * type) and persists the listings. Safe to re-run: listings are deduped by id.
 */
export async function sampleMarket(opts: {
  league: string;
  itemClass: string;
  baseType?: string;
  ilvlMin?: number;
}): Promise<SampleRunResult> {
  const priceMap = await getCachedPriceMap(opts.league);
  let inserted = 0;
  let fetched = 0;
  let totalListings = 0;
  let tradeUrl: string | null = null;

  for (const floor of PASS_FLOORS) {
    const query = buildQuery({
      itemClass: opts.itemClass,
      baseType: opts.baseType,
      minPriceExalted: floor || undefined,
      ilvlMin: opts.ilvlMin,
    });
    if (!query) {
      throw new Error(
        `No trade category mapping for item class "${opts.itemClass}" — pass a baseType instead.`,
      );
    }
    try {
      const res = await searchAndFetch(opts.league, query, {
        maxListings: LISTINGS_PER_PASS,
        ttlMs: 20 * 60 * 1000,
      });
      fetched += res.listings.length;
      if (floor === 0) {
        totalListings = res.total;
        tradeUrl = res.tradeUrl;
      }
      inserted += await persistListings(
        opts.league,
        opts.itemClass,
        res.listings,
        priceMap,
      );
    } catch (err) {
      // A failed pass (rate limit, network) shouldn't void the others.
      console.warn(`market sampler: pass (floor ${floor}) failed: ${err}`);
    }
  }

  return {
    league: opts.league,
    itemClass: opts.itemClass,
    inserted,
    fetched,
    totalListings,
    tradeUrl:
      tradeUrl ??
      (totalListings > 0 ? tradeSiteUrl(opts.league, "") : null),
  };
}
