import { searchAndFetch, TradeOwnerError } from "./client";
import { tradePriceToExalted } from "./currency";
import { buildTradeQuery } from "./query";

/**
 * Live base-item pricing via the trade API: what does a Normal/Magic base
 * (optionally with specific stats already on it) actually cost right now?
 *
 * Web requests only read cached quotes; a miss (or a stale hit) queues a
 * `quote:base` job so the worker fetches it and the next page load has it.
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
  /** The listings are older than the cache lifetime. */
  stale?: boolean;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface BaseQuoteRequest {
  league: string;
  baseType: string;
  rarity?: "normal" | "magic" | "rare" | "nonunique";
  ilvlMin?: number;
  /** Trade stat ids the listing must already have (AND filter). */
  statIds?: string[];
  ttlMs?: number;
}

interface BasePriceOpts extends BaseQuoteRequest {
  priceMap: Map<string, number>;
}

function buildQuery(opts: BaseQuoteRequest, status: "online" | "any") {
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
    ...(res.stale ? { stale: true } : {}),
  };
}

async function queueQuote(opts: BasePriceOpts): Promise<boolean> {
  try {
    const { enqueueJob } = await import("@/lib/jobs/queue");
    const payload: BaseQuoteRequest = {
      league: opts.league,
      baseType: opts.baseType,
      rarity: opts.rarity,
      ilvlMin: opts.ilvlMin,
      statIds: opts.statIds,
    };
    await enqueueJob({
      kind: "quote:base",
      payload: payload as unknown as Record<string, unknown>,
      lane: "interactive",
      priority: 5,
      maxAttempts: 2,
      dedupeKey: `quote:base:${JSON.stringify(payload)}`,
      message: `Queued base price for ${opts.baseType}`,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Queries the cheapest listings for a base type and returns a robust price
 * quote (median of the cheapest few, which dampens price-fixed bait
 * listings). Tries online sellers first, then any-status (white bases are
 * mostly listed by offline sellers). `queued` is true when a live refresh was
 * handed to the worker instead.
 */
export async function getBasePriceResult(
  opts: BasePriceOpts,
): Promise<{ quote: BasePriceQuote | null; queued: boolean }> {
  try {
    const quote = (await quoteForStatus(opts, "online")) ?? (await quoteForStatus(opts, "any"));
    const queued = quote?.stale ? await queueQuote(opts) : false;
    return { quote, queued };
  } catch (err) {
    if (err instanceof TradeOwnerError) return { quote: null, queued: await queueQuote(opts) };
    throw err;
  }
}

export async function getBasePrice(opts: BasePriceOpts): Promise<BasePriceQuote | null> {
  return (await getBasePriceResult(opts)).quote;
}
