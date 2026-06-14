import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { marketSamples, type MarketSampleRow } from "@/db/schema";
import type { ListingStat } from "@/lib/trade/client";
import { tradeStatText } from "@/lib/trade/modMap";
import { listManualSales } from "./manual";

/**
 * Aggregates sampled trade listings into "which explicit-mod combinations
 * sell best" statistics, and prices a target mod set from the sample pool.
 */

export interface ComboStat {
  /** Sorted stat-ids joined with "+", unique per combination. */
  key: string;
  statIds: string[];
  /** Display texts of the stats (trade catalog wording). */
  labels: string[];
  size: number;
  count: number;
  medianExalted: number;
  p25Exalted: number;
  p75Exalted: number;
  maxExalted: number;
  /** A couple of representative listings (base type + price). */
  examples: { baseType: string; priceExalted: number }[];
}

export interface SampleSummary {
  sampleCount: number;
  baseTypes: number;
  newestFetchedAt: number | null;
  medianExalted: number | null;
}

interface ParsedSample {
  listingId: string;
  baseType: string;
  ilvl: number | null;
  priceExalted: number;
  statIds: string[];
  /** Highest modifier level seen per stat id (tier bracket of the roll). */
  statLevels: Map<string, number>;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function parseSamples(rows: MarketSampleRow[]): ParsedSample[] {
  const out: ParsedSample[] = [];
  for (const r of rows) {
    if (r.priceExalted == null || r.priceExalted <= 0) continue;
    let stats: ListingStat[];
    try {
      stats = JSON.parse(r.stats) as ListingStat[];
    } catch {
      continue;
    }
    const ids = [...new Set(stats.map((s) => s.hash))].sort();
    if (ids.length === 0) continue;
    const statLevels = new Map<string, number>();
    for (const s of stats) {
      if (s.level == null) continue;
      statLevels.set(s.hash, Math.max(statLevels.get(s.hash) ?? 0, s.level));
    }
    out.push({
      listingId: r.listingId,
      baseType: r.baseType,
      ilvl: r.ilvl,
      priceExalted: r.priceExalted,
      statIds: ids,
      statLevels,
    });
  }
  return out;
}

async function loadSamples(opts: {
  league: string;
  itemClass?: string | null;
  baseType?: string | null;
}): Promise<ParsedSample[]> {
  await ensureAppTables();
  const db = getDb();
  const conditions = [eq(marketSamples.league, opts.league)];
  if (opts.itemClass) conditions.push(eq(marketSamples.itemClass, opts.itemClass));
  if (opts.baseType) conditions.push(eq(marketSamples.baseType, opts.baseType));
  const rows = await db
    .select()
    .from(marketSamples)
    .where(and(...conditions));
  return parseSamples(rows);
}

function* combinations(ids: string[], size: number): Generator<string[]> {
  if (size > ids.length) return;
  const idx = Array.from({ length: size }, (_, i) => i);
  while (true) {
    yield idx.map((i) => ids[i]);
    let i = size - 1;
    while (i >= 0 && idx[i] === ids.length - size + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * Top-value explicit combinations of the requested sizes, ranked by median
 * listing price. Combos with fewer than `minCount` samples are dropped (one
 * overpriced listing isn't a market signal).
 */
export async function getComboStats(opts: {
  league: string;
  itemClass?: string | null;
  baseType?: string | null;
  sizes?: number[];
  minCount?: number;
  limitPerSize?: number;
}): Promise<Map<number, ComboStat[]>> {
  const sizes = opts.sizes ?? [1, 2, 3];
  const minCount = opts.minCount ?? 3;
  const limitPerSize = opts.limitPerSize ?? 25;
  const samples = await loadSamples(opts);

  const agg = new Map<
    string,
    { statIds: string[]; prices: number[]; examples: ParsedSample[] }
  >();
  for (const s of samples) {
    for (const size of sizes) {
      // Cap the per-item stat count to keep combination counts sane.
      if (s.statIds.length > 12) continue;
      for (const combo of combinations(s.statIds, size)) {
        const key = combo.join("+");
        let entry = agg.get(key);
        if (!entry) {
          entry = { statIds: combo, prices: [], examples: [] };
          agg.set(key, entry);
        }
        entry.prices.push(s.priceExalted);
        if (entry.examples.length < 3) entry.examples.push(s);
      }
    }
  }

  const bySize = new Map<number, ComboStat[]>();
  for (const size of sizes) bySize.set(size, []);
  for (const [key, entry] of agg) {
    if (entry.prices.length < minCount) continue;
    const sorted = [...entry.prices].sort((a, b) => a - b);
    const labels = await Promise.all(entry.statIds.map((id) => tradeStatText(id)));
    const stat: ComboStat = {
      key,
      statIds: entry.statIds,
      labels,
      size: entry.statIds.length,
      count: entry.prices.length,
      medianExalted: quantile(sorted, 0.5),
      p25Exalted: quantile(sorted, 0.25),
      p75Exalted: quantile(sorted, 0.75),
      maxExalted: sorted[sorted.length - 1],
      examples: entry.examples.map((e) => ({
        baseType: e.baseType,
        priceExalted: e.priceExalted,
      })),
    };
    bySize.get(stat.size)?.push(stat);
  }
  for (const list of bySize.values()) {
    list.sort((a, b) => b.medianExalted - a.medianExalted);
    list.length = Math.min(list.length, limitPerSize);
  }
  return bySize;
}

/** Quick header stats about the sample pool. */
export async function getSampleSummary(opts: {
  league: string;
  itemClass?: string | null;
}): Promise<SampleSummary> {
  await ensureAppTables();
  const db = getDb();
  const conditions = [eq(marketSamples.league, opts.league)];
  if (opts.itemClass) conditions.push(eq(marketSamples.itemClass, opts.itemClass));
  const rows = await db
    .select({
      priceExalted: marketSamples.priceExalted,
      baseType: marketSamples.baseType,
      fetchedAt: marketSamples.fetchedAt,
    })
    .from(marketSamples)
    .where(and(...conditions));
  const prices = rows
    .map((r) => r.priceExalted)
    .filter((p): p is number => p != null && p > 0)
    .sort((a, b) => a - b);
  return {
    sampleCount: rows.length,
    baseTypes: new Set(rows.map((r) => r.baseType)).size,
    newestFetchedAt: rows.length
      ? Math.max(...rows.map((r) => r.fetchedAt))
      : null,
    medianExalted: prices.length ? quantile(prices, 0.5) : null,
  };
}

export interface SaleEstimate {
  priceExalted: number;
  sampleCount: number;
  source: "probe" | "trade" | "manual" | "mixed";
  /** Measured demand (items/day) when the backing probe has snapshot data. */
  sellThroughPerDay?: number | null;
}

export interface VelocityAdjustment {
  /** Sale price after the supply/velocity haircut. */
  adjustedExalted: number;
  /** Haircut multiplier applied (1 = none). */
  haircut: number;
  /** Rough days to move one item: current supply / daily new listings. */
  timeToSellDays: number | null;
}

/**
 * Haircuts an ask-derived sale price by how slow the market is. Asks are
 * upper bounds; the deeper the queue ahead of you (supply vs daily flow),
 * the more you must undercut to actually realize the sale.
 *
 * - supply/velocity unknown: mild 10% trust haircut (sample-derived data).
 * - <= 1 day of inventory: full price.
 * - Each extra day of inventory shaves ~6%, floored at 55%.
 *
 * Daily flow preference: measured sell-through (listings that actually
 * disappeared between probes) > new-listings-per-day proxy > a guessed
 * 0.5/day.
 */
export function velocityAdjustedSale(
  saleExalted: number,
  supply: number | null,
  velocity: number | null,
  sellThroughPerDay?: number | null,
): VelocityAdjustment {
  if (supply == null || supply <= 0) {
    return {
      adjustedExalted: saleExalted * 0.9,
      haircut: 0.9,
      timeToSellDays: supply === 0 ? null : null,
    };
  }
  const flow =
    sellThroughPerDay != null && sellThroughPerDay > 0
      ? sellThroughPerDay
      : velocity != null && velocity > 0
        ? velocity
        : 0.5;
  const days = supply / flow;
  const haircut = Math.max(0.55, Math.min(1, 1 - 0.06 * (days - 1)));
  return {
    adjustedExalted: saleExalted * haircut,
    haircut,
    timeToSellDays: Math.round(days * 10) / 10,
  };
}

/**
 * Estimates the sale price of an item carrying all the target mods.
 *
 * Resolution order:
 *  1. A fresh targeted combo probe (exact stat-filtered trade search — the
 *     most precise signal available).
 *  2. Random market samples: a listing matches when every target group has
 *     at least one of its trade stat ids present — and, when a tier floor is
 *     given, rolled at a tier of that modifier level or better (T1 life and
 *     T5 life are NOT the same market).
 *  3. Manual sale records (group-id subset match).
 */
export async function estimateSaleValue(opts: {
  league: string;
  itemClass?: string | null;
  baseType?: string | null;
  groups: string[];
  statIdsPerGroup: Map<string, string[]>;
  /** Tier floor per group: required modifier level of the rolled tier. */
  minLevelPerGroup?: Map<string, number>;
  minCount?: number;
}): Promise<SaleEstimate | null> {
  const minCount = opts.minCount ?? 2;

  // 1) Exact probe for this very combo (no API call — reads the local store).
  if (opts.itemClass && opts.groups.length > 0) {
    try {
      const { getProbeForGroups } = await import("./probes");
      const probe = await getProbeForGroups({
        league: opts.league,
        itemClass: opts.itemClass,
        groups: opts.groups,
        statIdsPerGroup: opts.statIdsPerGroup,
      });
      if (probe && probe.medianAskExalted != null && probe.listingCount > 0) {
        return {
          priceExalted: probe.medianAskExalted,
          sampleCount: probe.listingCount,
          source: "probe",
          sellThroughPerDay: probe.sellThroughPerDay,
        };
      }
    } catch {
      /* probe store unavailable — fall through to samples */
    }
  }
  const prices: number[] = [];
  let tradeMatches = 0;
  let manualMatches = 0;

  const perGroup = opts.groups.map((g) => ({
    ids: opts.statIdsPerGroup.get(g) ?? [],
    minLevel: opts.minLevelPerGroup?.get(g) ?? 0,
  }));
  const allMapped = perGroup.every((g) => g.ids.length > 0);

  if (allMapped && opts.groups.length > 0) {
    // Prefer class-wide matches; fall back to base-specific when provided.
    const samples = await loadSamples({
      league: opts.league,
      itemClass: opts.itemClass,
      baseType: opts.baseType,
    });
    for (const s of samples) {
      const idSet = new Set(s.statIds);
      const matches = perGroup.every((g) =>
        g.ids.some((id) => {
          if (!idSet.has(id)) return false;
          if (g.minLevel <= 0) return true;
          // Tier-aware: the listing's roll must be at the floor tier or
          // better. Listings without level info pass (lenient — old data).
          const level = s.statLevels.get(id);
          return level == null || level >= g.minLevel;
        }),
      );
      if (matches) {
        prices.push(s.priceExalted);
        tradeMatches++;
      }
    }
  }

  // Manual sales: match by group ids (subset).
  try {
    const manual = await listManualSales(opts.league);
    for (const sale of manual) {
      if (opts.itemClass && sale.itemClass && sale.itemClass !== opts.itemClass)
        continue;
      const saleGroups = new Set(sale.groups);
      if (opts.groups.length > 0 && opts.groups.every((g) => saleGroups.has(g))) {
        prices.push(sale.priceExalted);
        manualMatches++;
      }
    }
  } catch {
    /* manual sales unavailable */
  }

  if (prices.length < minCount) return null;
  prices.sort((a, b) => a - b);
  return {
    priceExalted: quantile(prices, 0.5),
    sampleCount: prices.length,
    source:
      tradeMatches > 0 && manualMatches > 0
        ? "mixed"
        : manualMatches > 0
          ? "manual"
          : "trade",
  };
}
