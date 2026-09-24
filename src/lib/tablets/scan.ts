import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tabletComboResults, type TabletComboResultRow } from "@/db/schema";
import { getPrices } from "@/lib/pricing/poe2scout";
import type { ProgressReporter } from "@/lib/progress";
import { tradePriceToExalted } from "@/lib/trade/currency";
import {
  searchAndFetchForGem,
  TradeApiError,
  TradeTimeoutError,
  withTimeoutStrict,
  type TradeListing,
} from "@/lib/trade/client";
import { buildTradeQuery } from "@/lib/trade/query";
import { getTradeCooldownMs } from "@/lib/trade/rateLimiter";
import { getTradeStats } from "@/lib/trade/stats";
import { loadTabletCatalog } from "./catalog";
import {
  extractFourModCombo,
  floorAndMedian,
  isRateLimitError,
  resolveListingMods,
  runRateLimitedBatch,
  type ComboMod,
  type TabletAffix,
  type TabletCatalogEntry,
} from "./logic";

/**
 * Samples the most expensive rare tablets, keeps real 2-prefix + 2-suffix
 * combinations, then re-queries the strongest ones for a floor price.
 * One tablet sample or a few floor checks per batch, then the job reschedules.
 */

const SAMPLE_LISTINGS = 40;
/** Listings above this are almost always price-fixers, not real sales. */
const MAX_PRICE_DIVINE = 10;
const FALLBACK_DIVINE_EXALTED = 200;
const FLOOR_LISTINGS = 10;
const TOP_COMBOS_PER_TABLET = 25;
const FLOOR_BATCH = 3;
const SEARCH_TTL_MS = 5 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 180_000;
const MAX_INLINE_WAIT_MS = 15_000;
const SAMPLE_MARKER = "__sample__";

export interface TabletScanBatchResult {
  league: string;
  scanStartedAt: number;
  total: number;
  priced: number;
  done: boolean;
  stoppedForRateLimit: boolean;
  batchProcessed: number;
  rateLimitRetryMs?: number;
}

export interface TabletScanBatchInput {
  league: string;
  scanStartedAt: number;
  /** How many strongest 2+2 combos per tablet get a floor search. */
  maxCombosPerTablet?: number;
  onProgress?: ProgressReporter;
}

interface ComboPayload {
  prefixes: ComboMod[];
  suffixes: ComboMod[];
}

function rowId(league: string, tablet: string, comboKey: string): string {
  return `${league}|${tablet}|${comboKey}`;
}

function parseMods(raw: string): ComboPayload {
  try {
    const parsed = JSON.parse(raw) as ComboPayload;
    return {
      prefixes: parsed.prefixes ?? [],
      suffixes: parsed.suffixes ?? [],
    };
  } catch {
    return { prefixes: [], suffixes: [] };
  }
}

function listingExalted(
  listing: TradeListing,
  priceMap: Map<string, number>,
): number | null {
  if (!listing.price) return null;
  return tradePriceToExalted(listing.price.amount, listing.price.currency, priceMap);
}

async function rowsForScan(
  league: string,
  scanStartedAt: number,
): Promise<TabletComboResultRow[]> {
  await ensureAppTables();
  return getDb()
    .select()
    .from(tabletComboResults)
    .where(
      and(
        eq(tabletComboResults.league, league),
        gte(tabletComboResults.scanStartedAt, scanStartedAt),
      ),
    );
}

export async function runTabletScanBatch(
  input: TabletScanBatchInput,
): Promise<TabletScanBatchResult> {
  const { league, scanStartedAt, onProgress } = input;
  const report: ProgressReporter = onProgress ?? (() => {});

  const cooldownMs = await getTradeCooldownMs();
  if (cooldownMs > MAX_INLINE_WAIT_MS) {
    const existing = await rowsForScan(league, scanStartedAt);
    const priced = existing.filter((r) => r.status === "priced").length;
    report(`Rate limit cooldown ${Math.round(cooldownMs / 1000)}s — pausing.`);
    return {
      league,
      scanStartedAt,
      total: existing.filter((r) => r.comboKey !== SAMPLE_MARKER).length,
      priced,
      done: false,
      stoppedForRateLimit: true,
      batchProcessed: 0,
      rateLimitRetryMs: cooldownMs,
    };
  }

  const catalog = await loadTabletCatalog();
  if (catalog.length === 0) {
    throw new Error(
      "No tablet mods in the local database. Run npm run data:setup and restart.",
    );
  }

  const existing = await rowsForScan(league, scanStartedAt);
  const sampled = new Set(
    existing.filter((r) => r.comboKey === SAMPLE_MARKER).map((r) => r.tablet),
  );
  const nextTablet = catalog.find((t) => !sampled.has(t.name));

  if (nextTablet) {
    report(`Sampling expensive ${nextTablet.name} listings…`, {
      current: sampled.size,
      total: catalog.length,
    });
    try {
      await sampleTablet(
        league,
        scanStartedAt,
        nextTablet,
        input.maxCombosPerTablet ?? TOP_COMBOS_PER_TABLET,
      );
    } catch (err) {
      if (isRateLimitError(err) || err instanceof TradeTimeoutError) {
        const retryMs =
          err instanceof TradeTimeoutError ? 15_000 : (err.retryAfterMs ?? 60_000);
        report(`Pausing ${nextTablet.name} — ${err instanceof Error ? err.message : "retry"}`);
        return {
          league,
          scanStartedAt,
          total: catalog.length,
          priced: 0,
          done: false,
          stoppedForRateLimit: true,
          batchProcessed: 0,
          rateLimitRetryMs: retryMs,
        };
      }
      throw err;
    }
    const doneSampling = sampled.size + 1 >= catalog.length;
    report(
      doneSampling
        ? `Sampled all ${catalog.length} tablets — pricing the best combinations…`
        : `Sampled ${nextTablet.name} (${sampled.size + 1}/${catalog.length}).`,
      { current: sampled.size + 1, total: catalog.length },
    );
    return {
      league,
      scanStartedAt,
      total: catalog.length,
      priced: 0,
      done: false,
      stoppedForRateLimit: false,
      batchProcessed: 1,
    };
  }

  const pending = existing
    .filter((r) => r.status === "pending_floor" && r.comboKey !== SAMPLE_MARKER)
    .sort((a, b) => (b.sampledMaxExalted ?? 0) - (a.sampledMaxExalted ?? 0))
    .slice(0, FLOOR_BATCH);

  const comboRows = existing.filter((r) => r.comboKey !== SAMPLE_MARKER);
  const pricedSoFar = comboRows.filter(
    (r) => r.status === "priced" || r.status === "no_listings",
  ).length;

  if (pending.length === 0) {
    report(`Done — ${pricedSoFar} tablet combinations priced.`);
    return {
      league,
      scanStartedAt,
      total: comboRows.length,
      priced: pricedSoFar,
      done: true,
      stoppedForRateLimit: false,
      batchProcessed: 0,
    };
  }

  const priceData = await getPrices(league).catch(() => null);
  const priceMap = new Map<string, number>(
    (priceData?.items ?? []).map((i) => [i.apiId, i.priceExalted]),
  );
  if (priceData && priceData.divinePrice > 0) priceMap.set("divine", priceData.divinePrice);

  const batch = await runRateLimitedBatch({
    tasks: pending,
    maxInlineWaitMs: MAX_INLINE_WAIT_MS,
    getCooldownMs: getTradeCooldownMs,
    search: async (row) => {
      report(`Pricing ${row.tablet} combination…`, {
        current: pricedSoFar,
        total: comboRows.length,
      });
      await priceCombo(league, row, priceMap);
    },
  });

  if (batch.stoppedForRateLimit) {
    const retrySec = Math.round((batch.rateLimitRetryMs ?? 60_000) / 1000);
    report(`Rate limited — retrying in ${retrySec}s.`);
  }

  const after = await rowsForScan(league, scanStartedAt);
  const afterCombos = after.filter((r) => r.comboKey !== SAMPLE_MARKER);
  const priced = afterCombos.filter(
    (r) => r.status === "priced" || r.status === "no_listings",
  ).length;
  const stillPending = afterCombos.some((r) => r.status === "pending_floor");
  const done = !stillPending && !batch.stoppedForRateLimit;
  if (done) report(`Done — ${priced} tablet combinations priced.`);

  return {
    league,
    scanStartedAt,
    total: afterCombos.length,
    priced,
    done,
    stoppedForRateLimit: batch.stoppedForRateLimit,
    batchProcessed: batch.processed,
    rateLimitRetryMs: batch.rateLimitRetryMs,
  };
}

async function sampleTablet(
  league: string,
  scanStartedAt: number,
  tablet: TabletCatalogEntry,
  maxCombos: number,
): Promise<void> {
  const priceData = await getPrices(league).catch(() => null);
  const priceMap = new Map<string, number>(
    (priceData?.items ?? []).map((i) => [i.apiId, i.priceExalted]),
  );
  if (priceData && priceData.divinePrice > 0) priceMap.set("divine", priceData.divinePrice);

  const stats = await getTradeStats();
  const statText = new Map(stats.map((s) => [s.id, s.text]));
  const affixes: TabletAffix[] = [...tablet.prefixes, ...tablet.suffixes];

  const result = await withTimeoutStrict(
    searchAndFetchForGem(
      league,
      buildTradeQuery({
        status: "online",
        type: tablet.name,
        rarity: "rare",
        maxPriceEquivalent: maxPriceExalted(priceMap),
        sort: { price: "desc" },
      }),
      { maxListings: SAMPLE_LISTINGS, ttlMs: SEARCH_TTL_MS },
    ),
    SEARCH_TIMEOUT_MS,
  );

  interface Bucket {
    mods: ComboPayload;
    statIds: string[];
    min: number;
    max: number;
    count: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const listing of result.listings) {
    const price = listingExalted(listing, priceMap);
    if (price == null) continue;
    const resolved = resolveListingMods({
      stats: listing.explicitStats,
      lines: listing.explicitModLines ?? [],
      affixes,
      statText,
    });
    const combo = extractFourModCombo(resolved.mods);
    if (!combo) continue;
    const statIds = resolved.statIds;
    const prev = buckets.get(combo.key);
    if (!prev) {
      buckets.set(combo.key, {
        mods: { prefixes: combo.prefixes, suffixes: combo.suffixes },
        statIds,
        min: price,
        max: price,
        count: 1,
      });
    } else {
      prev.count += 1;
      prev.min = Math.min(prev.min, price);
      if (price >= prev.max) {
        prev.max = price;
        prev.statIds = statIds;
        prev.mods = { prefixes: combo.prefixes, suffixes: combo.suffixes };
      }
    }
  }

  const top = [...buckets.entries()]
    .sort((a, b) => b[1].max - a[1].max)
    .slice(0, maxCombos);

  const now = Date.now();
  const db = getDb();
  for (const [key, bucket] of top) {
    await db
      .insert(tabletComboResults)
      .values({
        id: rowId(league, tablet.name, key),
        league,
        tablet: tablet.name,
        comboKey: key,
        mods: JSON.stringify(bucket.mods),
        sampledMinExalted: bucket.min,
        sampledMaxExalted: bucket.max,
        floorPriceExalted: null,
        medianPriceExalted: null,
        listingCount: null,
        sampleCount: bucket.count,
        status: "pending_floor",
        tradeUrl: null,
        statIds: JSON.stringify(bucket.statIds),
        errorMessage: null,
        fetchedAt: now,
        scanStartedAt,
      })
      .onConflictDoUpdate({
        target: tabletComboResults.id,
        set: {
          mods: JSON.stringify(bucket.mods),
          sampledMinExalted: bucket.min,
          sampledMaxExalted: bucket.max,
          sampleCount: bucket.count,
          status: "pending_floor",
          statIds: JSON.stringify(bucket.statIds),
          floorPriceExalted: null,
          medianPriceExalted: null,
          fetchedAt: now,
          scanStartedAt,
        },
      });
  }

  await db
    .insert(tabletComboResults)
    .values({
      id: rowId(league, tablet.name, SAMPLE_MARKER),
      league,
      tablet: tablet.name,
      comboKey: SAMPLE_MARKER,
      mods: "[]",
      sampledMinExalted: null,
      sampledMaxExalted: null,
      floorPriceExalted: null,
      medianPriceExalted: null,
      listingCount: result.total,
      sampleCount: result.listings.length,
      status: "sampled",
      tradeUrl: result.tradeUrl,
      statIds: "[]",
      errorMessage: null,
      fetchedAt: now,
      scanStartedAt,
    })
    .onConflictDoUpdate({
      target: tabletComboResults.id,
      set: {
        status: "sampled",
        listingCount: result.total,
        sampleCount: result.listings.length,
        tradeUrl: result.tradeUrl,
        fetchedAt: now,
        scanStartedAt,
      },
    });
}

async function priceCombo(
  league: string,
  row: TabletComboResultRow,
  priceMap: Map<string, number>,
): Promise<void> {
  const statIds = (() => {
    try {
      const parsed = JSON.parse(row.statIds) as string[];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  })();
  const now = Date.now();
  try {
    const result = await withTimeoutStrict(
      searchAndFetchForGem(
        league,
        buildTradeQuery({
          status: "online",
          type: row.tablet,
          rarity: "rare",
          statIds,
          maxPriceEquivalent: maxPriceExalted(priceMap),
          sort: { price: "asc" },
        }),
        { maxListings: FLOOR_LISTINGS, ttlMs: SEARCH_TTL_MS },
      ),
      SEARCH_TIMEOUT_MS,
    );
    const prices = result.listings
      .map((l) => listingExalted(l, priceMap))
      .filter((n): n is number => n != null);
    const { floor, median } = floorAndMedian(prices);
    const status = floor == null ? "no_listings" : "priced";
    await getDb()
      .update(tabletComboResults)
      .set({
        floorPriceExalted: floor,
        medianPriceExalted: median,
        listingCount: result.total,
        status,
        tradeUrl: result.tradeUrl,
        errorMessage: null,
        fetchedAt: now,
      })
      .where(eq(tabletComboResults.id, row.id));
  } catch (err) {
    if (isRateLimitError(err) || (err instanceof TradeApiError && err.status === 429)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Trade search failed";
    await getDb()
      .update(tabletComboResults)
      .set({
        status: "error",
        errorMessage: message,
        fetchedAt: now,
      })
      .where(eq(tabletComboResults.id, row.id));
  }
}

function maxPriceExalted(priceMap: Map<string, number>): number {
  const divine = priceMap.get("divine") ?? FALLBACK_DIVINE_EXALTED;
  return Math.round(divine * MAX_PRICE_DIVINE);
}

export function readComboMods(row: TabletComboResultRow): ComboPayload {
  return parseMods(row.mods);
}

export { SAMPLE_MARKER };
