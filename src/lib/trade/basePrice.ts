import { searchAndFetch } from "./client";
import { tradePriceToExalted } from "./currency";
import { buildTradeQuery } from "./query";

/**
 * Live base-item pricing via the trade API: what does a Normal/Magic base
 * (optionally with specific stats already on it) actually cost right now?
 */

export interface BasePriceQuote {
  /** Median of the cheapest convertible listings, in Exalted Orbs. */
  priceExalted: number;
  /** How many priced listings backed the quote. */
  sampleCount: number;
  /** Total matching listings online. */
  totalListings: number;
  /** Pre-filled search on the official trade site. */
  tradeUrl: string;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface BasePriceOpts {
  league: string;
  baseType: string;
  rarity?: "normal" | "magic" | "rare" | "nonunique";
  ilvlMin?: number;
  /** Trade stat ids the listing must already have (AND filter). */
  statIds?: string[];
  priceMap: Map<string, number>;
  ttlMs?: number;
}

function buildQuery(opts: BasePriceOpts, status: "online" | "any") {
  return buildTradeQuery({
    status,
    type: opts.baseType,
    rarity: opts.rarity ?? "normal",
    ilvlMin: opts.ilvlMin,
    statIds: opts.statIds,
  });
}

async function quoteForStatus(
  opts: BasePriceOpts,
  status: "online" | "any",
): Promise<BasePriceQuote | null> {
  const res = await searchAndFetch(opts.league, buildQuery(opts, status), {
    maxListings: 10,
    ttlMs: opts.ttlMs ?? 30 * 60 * 1000,
  });
  const prices: number[] = [];
  for (const l of res.listings) {
    if (!l.price) continue;
    const ex = tradePriceToExalted(l.price.amount, l.price.currency, opts.priceMap);
    if (ex != null && ex >= 0) prices.push(ex);
  }
  if (prices.length === 0) return null;
  prices.sort((a, b) => a - b);
  const cheapest = prices.slice(0, 5);
  return {
    priceExalted: median(cheapest),
    sampleCount: prices.length,
    totalListings: res.total,
    tradeUrl: res.tradeUrl,
  };
}

/**
 * Queries the cheapest listings for a base type and returns a robust price
 * quote (median of the cheapest few, which dampens price-fixed bait
 * listings). Tries online sellers first, then any-status (white bases are
 * mostly listed by offline sellers). Returns null when nothing convertible
 * is listed at all.
 */
export async function getBasePrice(
  opts: BasePriceOpts,
): Promise<BasePriceQuote | null> {
  const online = await quoteForStatus(opts, "online");
  if (online) return online;
  return quoteForStatus(opts, "any");
}
