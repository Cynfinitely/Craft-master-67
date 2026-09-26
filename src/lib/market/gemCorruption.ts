import "server-only";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { gemCorruptionResults } from "@/db/schema";
import { getPrices } from "@/lib/pricing/poe2scout";
import {
  searchAndFetchForGem,
  TradeApiError,
  TradeTimeoutError,
  withTimeoutStrict,
  type TradeListing,
} from "@/lib/trade/client";
import { getTradeCooldownMs } from "@/lib/trade/rateLimiter";
import { tradePriceToExalted } from "@/lib/trade/currency";
import { buildTradeQuery } from "@/lib/trade/query";
import { loadActiveSkillGems } from "@/lib/market/skillGems";
import type { ProgressReporter } from "@/lib/progress";

/**
 * Level-21 / 20%-quality corrupted gem floor scanner.
 *
 * For each active skill gem in the catalog, queries the PoE2 trade API for
 * corrupted 21/20 listings, takes the cheapest 5–10 priced results, and stores
 * the floor (minimum) and median for ranking.
 *
 * Designed for the durable `scan:gems` worker job — processes small batches
 * and resumes via DB rows stamped with `scanStartedAt`.
 */

const TARGET_GEM_LEVEL = 21;
const TARGET_QUALITY = 20;
/** Cheapest listings sampled per gem to derive a robust floor (was 10). */
const LISTING_SAMPLE_MAX = 20;
/** A listing priced below this fraction of the cheap-cluster median is treated
 * as a scam/mispriced lowball and dropped, so it can't set the floor. */
const OUTLIER_FRAC = 0.25;
/** Real-currency listings needed before a floor is treated as "liquid". Below
 * this the gem is flagged thin (a single whale listing is not a market price). */
export const LIQUID_MIN_LISTINGS = 3;
/** Trade-search cache TTL for gem floor + discovery — short so each scan
 * reflects the live market instead of a half-hour-old listing. */
const GEM_FLOOR_TTL_MS = 5 * 60 * 1000;
const GEM_PRICE_TIMEOUT_MS = 90_000;
const DEFAULT_BATCH_SIZE = 3;
const GEM_START_FLOOR_MS = 4000;
/**
 * If the shared trade cooldown is longer than this, the batch releases its job
 * claim and reschedules instead of blocking — so the UI shows an honest
 * "retrying in Xs" message rather than freezing on the previous step.
 */
const GEM_MAX_INLINE_WAIT_MS = 15_000;
/** How many of the most expensive 21/20 listings to scan during discovery. */
const DISCOVERY_LISTINGS = 100;
const DISCOVERY_TIMEOUT_MS = 90_000;

/** Status written to candidate rows before their floor has been priced. */
const PENDING_STATUS = "pending" as const;

export type Gem2120Status = "pending" | "priced" | "no_listings" | "error";

export interface Gem2120Row {
  gemType: string;
  floorPriceExalted: number | null;
  medianPriceExalted: number | null;
  listingCount: number;
  sampleCount: number;
  status: Gem2120Status;
  errorMessage?: string | null;
  tradeUrl: string;
  fetchedAt: number;
}

export interface Gem2120BatchResult {
  league: string;
  scanStartedAt: number;
  total: number;
  /** Gems with a successful row for this scan run (priced or no_listings). */
  priced: number;
  done: boolean;
  stoppedForRateLimit: boolean;
  batchProcessed: number;
  /** Suggested pause before retry when stoppedForRateLimit is true. */
  rateLimitRetryMs?: number;
}

export interface Gem2120BatchInput {
  league: string;
  scanStartedAt: number;
  batchSize?: number;
  /** Re-price only these gems (skips discovery and keeps other rows). */
  gemTypes?: string[];
  onProgress?: ProgressReporter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Builds an apiId -> exalted price map from live poe2scout data, with the
 * Divine Orb forced to the league's authoritative `divinePrice` so listing
 * conversion and the table's divine display use the exact same ratio (a
 * divine-priced listing round-trips to the same divine value it was listed at).
 */
function buildExaltedPriceMap(priceData: {
  items: { apiId: string; priceExalted: number }[];
  divinePrice: number;
}): Map<string, number> {
  const map = new Map<string, number>(
    priceData.items.map((i) => [i.apiId, i.priceExalted]),
  );
  if (priceData.divinePrice > 0) map.set("divine", priceData.divinePrice);
  map.set("exalted", 1);
  return map;
}

function listingExalted(
  listing: TradeListing,
  priceMap: Map<string, number>,
): number | null {
  if (!listing.price) return null;
  return tradePriceToExalted(
    listing.price.amount,
    listing.price.currency,
    priceMap,
  );
}

/**
 * Derives a robust, liquid floor from a gem's listings.
 *
 * - Every listing is valued in exalted-equivalent; listings in currencies we
 *   can't convert (e.g. waystones) are skipped, never used as a price.
 * - `listingCount` is the number of real-currency (convertible) listings seen.
 * - Scam/mispriced lowballs far below the cheap-cluster median are dropped so
 *   one bad listing can't define the floor.
 * - `floor` is the cheapest surviving listing (the relatable buy-now price).
 */
function floorFromListings(
  listings: TradeListing[],
  priceMap: Map<string, number>,
): {
  floor: number | null;
  median: number | null;
  sampleCount: number;
  listingCount: number;
} {
  const prices = listings
    .map((l) => listingExalted(l, priceMap))
    .filter((n): n is number => n != null && n > 0)
    .sort((a, b) => a - b);

  const listingCount = prices.length;
  if (listingCount === 0) {
    return { floor: null, median: null, sampleCount: 0, listingCount: 0 };
  }

  const cluster = prices.slice(0, LISTING_SAMPLE_MAX);
  const clusterMedian = median(cluster) ?? cluster[0];
  const threshold = clusterMedian * OUTLIER_FRAC;
  const survivors = cluster.filter((p) => p >= threshold);
  const kept = survivors.length > 0 ? survivors : cluster;

  return {
    floor: kept[0],
    median: median(kept),
    sampleCount: kept.length,
    listingCount,
  };
}

async function upsertGemRow(
  league: string,
  row: Gem2120Row,
): Promise<void> {
  await ensureAppTables();
  await getDb()
    .insert(gemCorruptionResults)
    .values({
      id: `${league}|${row.gemType}`,
      league,
      gemType: row.gemType,
      floorPriceExalted: row.floorPriceExalted,
      medianPriceExalted: row.medianPriceExalted,
      listingCount: row.listingCount,
      sampleCount: row.sampleCount,
      status: row.status,
      errorMessage: row.errorMessage ?? null,
      tradeUrl: row.tradeUrl,
      fetchedAt: row.fetchedAt,
      plusOneChance: 0.125,
      useOmen: 0,
    })
    .onConflictDoUpdate({
      target: gemCorruptionResults.id,
      set: {
        floorPriceExalted: row.floorPriceExalted,
        medianPriceExalted: row.medianPriceExalted,
        listingCount: row.listingCount,
        sampleCount: row.sampleCount,
        status: row.status,
        errorMessage: row.errorMessage ?? null,
        tradeUrl: row.tradeUrl,
        fetchedAt: row.fetchedAt,
      },
    });
}

interface ScanRow {
  gemType: string;
  status: string;
}

/** All candidate rows recorded for this scan run (any status). */
async function getScanRows(
  league: string,
  scanStartedAt: number,
): Promise<ScanRow[]> {
  await ensureAppTables();
  const rows = await getDb()
    .select({
      gemType: gemCorruptionResults.gemType,
      status: gemCorruptionResults.status,
    })
    .from(gemCorruptionResults)
    .where(
      and(
        eq(gemCorruptionResults.league, league),
        gte(gemCorruptionResults.fetchedAt, scanStartedAt),
      ),
    );
  return rows.map((r) => ({ gemType: r.gemType, status: r.status ?? "" }));
}

/**
 * Discovery phase — find the handful of skill gems that actually carry value
 * at 21/20. One broad market search (corrupted, gem_level>=21, quality>=20,
 * sorted by price descending) surfaces the expensive listings; cheap/worthless
 * gems never appear near the top, so they're correctly ignored.
 */
async function discoverCandidateGems(
  league: string,
  priceMap: Map<string, number>,
  report: ProgressReporter,
): Promise<string[]> {
  report("Discovering the most valuable 21/20 gems on the market…");
  const result = await withTimeoutStrict(
    searchAndFetchForGem(
      league,
      buildTradeQuery({
        status: "online",
        gemLevelMin: TARGET_GEM_LEVEL,
        gemLevelMax: TARGET_GEM_LEVEL,
        qualityMin: TARGET_QUALITY,
        corrupted: true,
        sort: { price: "desc" },
      }),
      { maxListings: DISCOVERY_LISTINGS, ttlMs: GEM_FLOOR_TTL_MS },
    ),
    DISCOVERY_TIMEOUT_MS,
  );

  const catalog = await loadActiveSkillGems();
  const catalogSet = new Set(catalog.map((g) => g.type));

  // Tally each gem's liquidity (how many real-currency listings it has in the
  // sample) and its peak exalted value, so liquid + valuable gems rank first
  // and lone whale listings don't dominate the candidate list.
  const stats = new Map<string, { count: number; maxValue: number }>();
  for (const listing of result.listings) {
    const base = listing.baseType;
    if (!base || !catalogSet.has(base)) continue; // skip supports / non-skill
    const value = listingExalted(listing, priceMap);
    if (value == null || value <= 0) continue; // ignore un-convertible currencies
    const prev = stats.get(base) ?? { count: 0, maxValue: 0 };
    prev.count += 1;
    if (value > prev.maxValue) prev.maxValue = value;
    stats.set(base, prev);
  }

  return [...stats.entries()]
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return b[1].maxValue - a[1].maxValue;
    })
    .map(([base]) => base);
}

/** Seed discovered gems as pending rows so the scan can resume / show progress. */
async function seedCandidates(
  league: string,
  gemTypes: string[],
  scanStartedAt: number,
): Promise<void> {
  for (const gemType of gemTypes) {
    await upsertGemRow(league, {
      gemType,
      floorPriceExalted: null,
      medianPriceExalted: null,
      listingCount: 0,
      sampleCount: 0,
      status: PENDING_STATUS,
      tradeUrl: "",
      fetchedAt: scanStartedAt,
    });
  }
}

function floorResultMessage(
  gemType: string,
  row: Gem2120Row,
  divinePriceExalted: number,
): string {
  if (row.status === "priced" && row.floorPriceExalted != null) {
    if (divinePriceExalted > 0) {
      const div = (row.floorPriceExalted / divinePriceExalted).toFixed(1);
      return `${gemType} — floor ${div} div (priced)`;
    }
    return `${gemType} — floor ${row.floorPriceExalted.toFixed(1)} ex (priced)`;
  }
  if (row.status === "no_listings") return `${gemType} — no listings`;
  if (row.status === "error") {
    const detail = row.errorMessage?.trim();
    return detail ? `${gemType} — ${detail}` : `${gemType} — error`;
  }
  return `${gemType} — error`;
}

function formatGemError(err: unknown): string {
  if (err instanceof TradeApiError) {
    if (err.status === 429) {
      return "PoE2 trade API rate limited (429) — worker will retry";
    }
    return err.message;
  }
  if (err instanceof TradeTimeoutError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown trade API error";
}

function isPermanentTradeError(err: unknown): boolean {
  return (
    err instanceof TradeApiError &&
    err.status != null &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 429
  );
}

async function priceGem2120(
  league: string,
  gemType: string,
  priceMap: Map<string, number>,
): Promise<Gem2120Row> {
  const fetchedAt = Date.now();
  try {
    const result = await withTimeoutStrict(
      searchAndFetchForGem(
        league,
        buildTradeQuery({
          status: "online",
          type: gemType,
          gemLevelMin: TARGET_GEM_LEVEL,
          gemLevelMax: TARGET_GEM_LEVEL,
          qualityMin: TARGET_QUALITY,
          corrupted: true,
          sort: { price: "asc" },
        }),
        { maxListings: LISTING_SAMPLE_MAX, ttlMs: GEM_FLOOR_TTL_MS },
      ),
      GEM_PRICE_TIMEOUT_MS,
    );

    const { floor, median: med, sampleCount, listingCount } =
      floorFromListings(result.listings, priceMap);

    if (floor == null || listingCount === 0) {
      return {
        gemType,
        floorPriceExalted: null,
        medianPriceExalted: null,
        listingCount: 0,
        sampleCount: 0,
        status: "no_listings",
        tradeUrl: result.tradeUrl,
        fetchedAt,
      };
    }

    return {
      gemType,
      floorPriceExalted: floor,
      medianPriceExalted: med,
      // Real-currency listings observed — drives the liquid/thin signal.
      listingCount,
      sampleCount,
      status: "priced",
      tradeUrl: result.tradeUrl,
      fetchedAt,
    };
  } catch (err) {
    if (err instanceof TradeApiError && err.status === 429) {
      throw err;
    }
    if (err instanceof TradeTimeoutError) {
      throw err;
    }
    if (isPermanentTradeError(err)) {
      const errorMessage = formatGemError(err);
      return {
        gemType,
        floorPriceExalted: null,
        medianPriceExalted: null,
        listingCount: 0,
        sampleCount: 0,
        status: "error",
        errorMessage,
        tradeUrl: "",
        fetchedAt,
      };
    }
    throw err;
  }
}

/**
 * Prices the next batch of gems not yet recorded for this scan run.
 * Called repeatedly by the worker until `done` is true.
 */
export async function runGem2120Batch(
  input: Gem2120BatchInput,
): Promise<Gem2120BatchResult> {
  const { league, scanStartedAt, onProgress } = input;
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const report: ProgressReporter = onProgress ?? (() => {});

  report("Loading currency prices…");
  const priceData = await getPrices(league);
  const priceMap = buildExaltedPriceMap(priceData);
  const divinePriceExalted = priceData.divinePrice;

  // Cooldown guard — never hold a job claim through a long rate-limit window.
  // Release it so the UI shows "retrying in Xs" and the pump resumes later.
  const initialCooldownMs = await getTradeCooldownMs();
  if (initialCooldownMs > GEM_MAX_INLINE_WAIT_MS) {
    const existing = await getScanRows(league, scanStartedAt);
    const completeExisting = existing.filter(
      (r) => r.status === "priced" || r.status === "no_listings",
    ).length;
    const retrySec = Math.round(initialCooldownMs / 1000);
    report(
      `Rate limit cooldown ${retrySec}s — pausing, resumes automatically.`,
      existing.length
        ? { current: completeExisting, total: existing.length }
        : undefined,
    );
    return {
      league,
      scanStartedAt,
      total: existing.length,
      priced: completeExisting,
      done: false,
      stoppedForRateLimit: true,
      batchProcessed: 0,
      rateLimitRetryMs: initialCooldownMs,
    };
  }

  // Scoped re-price: no discovery and no wipe, just these gems.
  const scope = input.gemTypes?.length ? new Set(input.gemTypes) : null;
  const inScope = (r: ScanRow) => !scope || scope.has(r.gemType);
  let rows = (await getScanRows(league, scanStartedAt)).filter(inScope);
  if (scope && rows.length === 0) {
    report(`Re-pricing ${scope.size} gem${scope.size === 1 ? "" : "s"}…`, { current: 0, total: scope.size });
    await seedCandidates(league, [...scope], scanStartedAt);
    rows = (await getScanRows(league, scanStartedAt)).filter(inScope);
  }

  // Phase 1 — discovery (runs once per scan, when no candidate rows exist yet).
  if (rows.length === 0) {
    await clearGem2120Results(league);
    let candidates: string[];
    try {
      candidates = await discoverCandidateGems(league, priceMap, report);
    } catch (err) {
      if (err instanceof TradeApiError && err.status === 429) {
        const retryMs = err.retryAfterMs ?? 60_000;
        const retrySec = Math.round(retryMs / 1000);
        report(`Rate limited during discovery — retrying in ${retrySec}s.`);
        return {
          league,
          scanStartedAt,
          total: 0,
          priced: 0,
          done: false,
          stoppedForRateLimit: true,
          batchProcessed: 0,
          rateLimitRetryMs: retryMs,
        };
      }
      throw err;
    }

    if (candidates.length === 0) {
      report("Discovery found no priced 21/20 gems on the market right now.");
      return {
        league,
        scanStartedAt,
        total: 0,
        priced: 0,
        done: true,
        stoppedForRateLimit: false,
        batchProcessed: 0,
      };
    }

    report(
      `Found ${candidates.length} high-value gems — pricing their floors…`,
      { current: 0, total: candidates.length },
    );
    await seedCandidates(league, candidates, scanStartedAt);
    rows = await getScanRows(league, scanStartedAt);
  }

  // Phase 2 — floor-price the pending candidates.
  const total = rows.length;
  const completeCount = rows.filter(
    (r) => r.status === "priced" || r.status === "no_listings",
  ).length;
  const pending = rows.filter((r) => r.status === PENDING_STATUS);
  const batch = pending.slice(0, batchSize);

  if (batch.length === 0) {
    report(`Done — ${completeCount}/${total} gems priced.`);
    return {
      league,
      scanStartedAt,
      total,
      priced: completeCount,
      done: true,
      stoppedForRateLimit: false,
      batchProcessed: 0,
    };
  }

  let stoppedForRateLimit = false;
  let rateLimitRetryMs: number | undefined;
  let processed = 0;
  let lastGemStartAt = 0;

  for (const cand of batch) {
    const cooldownMs = await getTradeCooldownMs();
    if (cooldownMs > GEM_MAX_INLINE_WAIT_MS) {
      // Long backoff — stop the batch and let the job reschedule (honest UI).
      stoppedForRateLimit = true;
      rateLimitRetryMs = cooldownMs;
      const retrySec = Math.round(cooldownMs / 1000);
      report(
        `Rate limit cooldown ${retrySec}s — pausing, resumes automatically.`,
        { current: completeCount + processed, total },
      );
      break;
    }
    if (cooldownMs > 0) {
      report(
        `Waiting ${Math.ceil(cooldownMs / 1000)}s for the rate-limit window…`,
        { current: completeCount + processed, total },
      );
      await sleep(cooldownMs);
    }
    if (lastGemStartAt > 0) {
      const sinceLast = Date.now() - lastGemStartAt;
      if (sinceLast < GEM_START_FLOOR_MS) {
        await sleep(GEM_START_FLOOR_MS - sinceLast);
      }
    }
    lastGemStartAt = Date.now();

    const doneSoFar = completeCount + processed;
    report(`Fetching trade prices for ${cand.gemType} (21/20)…`, {
      current: doneSoFar + 1,
      total,
    });

    try {
      const row = await priceGem2120(league, cand.gemType, priceMap);
      await upsertGemRow(league, row);
      processed += 1;
      report(floorResultMessage(cand.gemType, row, divinePriceExalted), {
        current: completeCount + processed,
        total,
      });
    } catch (err) {
      // Transient failures (429 / timeout) leave the row pending for retry.
      if (err instanceof TradeApiError && err.status === 429) {
        stoppedForRateLimit = true;
        rateLimitRetryMs = err.retryAfterMs ?? 60_000;
        const retrySec = Math.round(rateLimitRetryMs / 1000);
        report(
          `Rate limited — retrying in ${retrySec}s (${completeCount + processed}/${total} priced)`,
        );
        break;
      }
      const detail = formatGemError(err);
      report(`${cand.gemType} — ${detail}`);
      break;
    }
  }

  const priced = completeCount + processed;
  const remainingAfter = pending.length - processed;
  const done = remainingAfter <= 0 && !stoppedForRateLimit;

  if (done) {
    report(`Done — ${priced}/${total} gems priced.`);
  } else if (stoppedForRateLimit) {
    const retrySec = Math.round((rateLimitRetryMs ?? 60_000) / 1000);
    report(
      `Rate limited — saved ${priced}/${total} gems. Retrying in ${retrySec}s.`,
    );
  } else {
    report(`Priced ${priced}/${total} gems — continuing…`);
  }

  return {
    league,
    scanStartedAt,
    total,
    priced,
    done,
    stoppedForRateLimit,
    batchProcessed: processed,
    rateLimitRetryMs,
  };
}

/** Clear league rows before a fresh full scan (optional, called at job start). */
export async function clearGem2120Results(league: string): Promise<void> {
  try {
    await ensureAppTables();
    await getDb()
      .delete(gemCorruptionResults)
      .where(eq(gemCorruptionResults.league, league));
  } catch {
    /* best-effort */
  }
}
