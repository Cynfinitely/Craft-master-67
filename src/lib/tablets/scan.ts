import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tabletComboResults, type TabletComboResultRow } from "@/db/schema";
import { getPrices } from "@/lib/pricing/poe2scout";
import type { ProgressReporter } from "@/lib/progress";
import { normalizeStat } from "@/lib/data/format";
import { tradePriceToExalted } from "@/lib/trade/currency";
import {
  searchAndFetchForGem,
  tradeSearch,
  tradeSiteUrl,
  TradeOwnerError,
  TradeTimeoutError,
  withTimeoutStrict,
  type TradeListing,
} from "@/lib/trade/client";
import { isTradeOwner } from "@/lib/trade/context";
import { buildTradeQuery } from "@/lib/trade/query";
import { getTradeRateLimiter } from "@/lib/trade/rateLimiter";
import { getTradeStats } from "@/lib/trade/stats";
import { loadTabletCatalog } from "./catalog";
import { fetchPrecursorOverview } from "./ninja";
import {
  comboStatusCounts,
  CONFIRM_BUDGET_PER_RUN,
  extractFourModCombo,
  floorAndMedian,
  groupTabletOverview,
  isRateLimitError,
  MIN_CONFIRMED_LISTINGS,
  nextConfirm,
  orderConfirmQueue,
  resolveListingMods,
  SAMPLE_FRESH_MS,
  sampleBandsExalted,
  scopeCatalog,
  TABLET_SAMPLE_LISTINGS,
  tradeExplicitId,
  type ComboMod,
  type ComboStatusCounts,
  type TabletAffix,
  type TabletCatalogEntry,
} from "./logic";

/**
 * Prices 2-prefix + 2-suffix tablet combinations with a small, fixed number
 * of trade searches per refresh. Each batch runs one search step:
 *   1. Sample: one cheapest-first search per price band per tablet (100c+,
 *      30-100c, 10-30c; up to 30 listings each), grouped into candidate
 *      combinations. Reread after 1 hour.
 *   2. Confirm: one search per candidate, best score first, at most
 *      CONFIRM_BUDGET_PER_RUN per refresh. A floor is kept only when at
 *      least 3 listings exist; results stay valid for 6 hours.
 * Rows persist between refreshes, so the next refresh continues the queue.
 */

const SEARCH_TTL_MS = 30 * 60 * 1000;
const FLOOR_LISTINGS = 10;
const FALLBACK_DIVINE_EXALTED = 200;
const SEARCH_TIMEOUT_MS = 180_000;
const MAX_INLINE_WAIT_MS = 15_000;
const SAMPLE_MARKER = "__sample__";
/** Instant Buyout listings only, so prices are ones you can actually buy at. */
const TABLET_TRADE_STATUS = "securable";

export interface TabletScanBatchResult {
  league: string;
  scanStartedAt: number;
  total: number;
  priced: number;
  done: boolean;
  stoppedForRateLimit: boolean;
  batchProcessed: number;
  rateLimitRetryMs?: number;
  fetchedAt: number;
  counts: ComboStatusCounts;
  /** Candidates still queued for a confirm search. */
  remaining: number;
  /** The run stopped because it used its confirm budget. */
  budgetSpent: boolean;
  /** Wait before the next search is allowed. */
  nextWaitMs: number;
}

export interface TabletScanBatchInput {
  league: string;
  scanStartedAt: number;
  /** Tablet base names to scan; all tablets when omitted. */
  tablets?: string[];
  /** Confirm searches allowed for this scope per refresh. */
  confirmBudget?: number;
  onProgress?: ProgressReporter;
}

interface ComboPayload {
  prefixes: ComboMod[];
  suffixes: ComboMod[];
}

function rowId(league: string, tablet: string, comboKey: string): string {
  return `${league}|${tablet}|${comboKey}`;
}

async function leagueRows(league: string, tablets?: Set<string> | null) {
  await ensureAppTables();
  const rows = await getDb()
    .select()
    .from(tabletComboResults)
    .where(eq(tabletComboResults.league, league));
  return tablets ? rows.filter((r) => tablets.has(r.tablet)) : rows;
}

export { scopeCatalog };

/** Last time each tablet's listings were sampled (for the scope chips). */
export async function tabletSampleAges(league: string): Promise<Record<string, number>> {
  const rows = await leagueRows(league);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.tablet] = Math.max(out[r.tablet] ?? 0, r.fetchedAt);
  return out;
}

function priceMapFrom(items: { apiId: string; priceExalted: number }[], divine: number) {
  const priceMap = new Map(items.map((i) => [i.apiId, i.priceExalted]));
  if (divine > 0) priceMap.set("divine", divine);
  return priceMap;
}

/** A scan step needs a search and its fetches, so it waits for both. */
async function tradeWaitMs(): Promise<number> {
  const limiter = getTradeRateLimiter();
  return Math.max(await limiter.waitMs("search"), await limiter.waitMs("fetch"));
}

/** Confirm searches this refresh has already spent. */
function confirmsSpent(rows: TabletComboResultRow[], scanStartedAt: number): number {
  return rows.filter(
    (r) =>
      r.comboKey !== SAMPLE_MARKER &&
      r.tradeUrl != null &&
      (r.status === "priced" || r.status === "thin") &&
      r.fetchedAt >= scanStartedAt,
  ).length;
}

export async function runTabletScanBatch(
  input: TabletScanBatchInput,
): Promise<TabletScanBatchResult> {
  const { league, scanStartedAt, onProgress } = input;
  const report: ProgressReporter = onProgress ?? (() => {});
  const now = Date.now();
  const budget = input.confirmBudget ?? CONFIRM_BUDGET_PER_RUN;

  const fullCatalog = await loadTabletCatalog();
  if (fullCatalog.length === 0) {
    throw new Error(
      "No tablet mods in the local database. Run npm run data:setup and restart.",
    );
  }
  const catalog = scopeCatalog(fullCatalog, input.tablets);
  const scope = input.tablets?.length ? new Set(catalog.map((t) => t.name)) : null;
  const scopeLabel = scope ? catalog.map((t) => t.name).join(", ") : "all tablets";

  const priceData = await getPrices(league).catch(() => null);
  const divine = priceData?.divinePrice ?? 0;
  let rows = await leagueRows(league, scope);

  if (rows.length === 0) {
    report(`Fetching precursor tablet prices for ${scopeLabel}…`);
    const overview = await fetchPrecursorOverview(league);
    const exaltedPerDivine = divine > 0 ? divine : overview.exaltedPerDivine;
    const grouped =
      exaltedPerDivine > 0
        ? groupTabletOverview(overview.lines, catalog, exaltedPerDivine)
        : [];
    if (grouped.length > 0) {
      await saveOverviewCombos(league, scanStartedAt, grouped, overview.fetchedAt, scope);
      report(`Done — ${grouped.length} tablet combinations priced.`);
      rows = await leagueRows(league, scope);
      return summarize(league, scanStartedAt, rows, now, { done: true, batchProcessed: 1 });
    }
    report("Economy snapshot has no mod combinations — reading trade listings…");
  }

  const limiter = getTradeRateLimiter();
  const cooldownMs = await tradeWaitMs();
  if (cooldownMs > MAX_INLINE_WAIT_MS) {
    report(`Trade limit reached — continuing in ${formatWait(cooldownMs)}.`);
    return summarize(league, scanStartedAt, rows, now, {
      stoppedForRateLimit: true,
      rateLimitRetryMs: cooldownMs,
    });
  }

  const priceMap = priceMapFrom(
    priceData?.items ?? [],
    divine > 0 ? divine : FALLBACK_DIVINE_EXALTED,
  );
  const markers = new Map(
    rows.filter((r) => r.comboKey === SAMPLE_MARKER).map((r) => [r.tablet, r]),
  );
  const staleTablets = catalog.filter((t) => {
    const marker = markers.get(t.name);
    return !marker || now - marker.fetchedAt >= SAMPLE_FRESH_MS;
  });

  try {
    if (staleTablets.length > 0) {
      const tablet = staleTablets[0];
      const index = catalog.length - staleTablets.length;
      report(`Reading ${tablet.name} listings (${index + 1}/${catalog.length})…`, {
        current: index,
        total: catalog.length,
      });
      await sampleTablet(league, scanStartedAt, tablet, priceMap);
      rows = await leagueRows(league, scope);
      return summarize(league, scanStartedAt, rows, Date.now(), { batchProcessed: 1 });
    }

    const combos = rows.filter((r) => r.comboKey !== SAMPLE_MARKER);
    const spent = confirmsSpent(rows, scanStartedAt);
    const { row, queued, budgetSpent } = nextConfirm(combos, now, spent, budget);
    if (!row) {
      return summarize(league, scanStartedAt, rows, now, { done: true, budgetSpent });
    }

    const counts = comboStatusCounts(combos);
    report(
      `Checking ${row.tablet} (${spent + 1}/${budget} this run · ${counts.confirmed} confirmed · ${queued} waiting)…`,
      { current: spent, total: budget },
    );
    await confirmCombo(row, priceMap);
    rows = await leagueRows(league, scope);
    return summarize(league, scanStartedAt, rows, Date.now(), { batchProcessed: 1 });
  } catch (err) {
    if (err instanceof TradeTimeoutError || isRateLimitError(err)) {
      const retryMs =
        err instanceof TradeTimeoutError
          ? 15_000
          : Math.max((err as { retryAfterMs?: number }).retryAfterMs ?? 0, await tradeWaitMs(), 15_000);
      report(`Trade limit reached — continuing in ${formatWait(retryMs)}.`);
      return summarize(league, scanStartedAt, rows, Date.now(), {
        stoppedForRateLimit: true,
        rateLimitRetryMs: retryMs,
      });
    }
    throw err;
  }
}

export function formatWait(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.ceil(sec / 60)} min`;
}

async function summarize(
  league: string,
  scanStartedAt: number,
  rows: TabletComboResultRow[],
  now: number,
  opts: {
    done?: boolean;
    stoppedForRateLimit?: boolean;
    rateLimitRetryMs?: number;
    budgetSpent?: boolean;
    batchProcessed?: number;
  },
): Promise<TabletScanBatchResult> {
  const combos = rows.filter((r) => r.comboKey !== SAMPLE_MARKER);
  const counts = comboStatusCounts(combos);
  const remaining = orderConfirmQueue(combos, now).length;
  return {
    league,
    scanStartedAt,
    total: combos.length,
    priced: counts.confirmed,
    done: opts.done ?? false,
    stoppedForRateLimit: opts.stoppedForRateLimit ?? false,
    batchProcessed: opts.batchProcessed ?? 0,
    rateLimitRetryMs: opts.rateLimitRetryMs,
    fetchedAt: now,
    counts,
    remaining,
    budgetSpent: opts.budgetSpent ?? false,
    nextWaitMs: opts.rateLimitRetryMs ?? (await tradeWaitMs()),
  };
}

async function confirmCombo(
  row: TabletComboResultRow,
  priceMap: Map<string, number>,
): Promise<void> {
  const mods = [...parseMods(row.mods).prefixes, ...parseMods(row.mods).suffixes];
  const stats = await getTradeStats();
  const statIds = statIdsForMods(mods, new Map(stats.map((s) => [s.id, s.text])));
  if (statIds.length < 2) {
    await getDb()
      .update(tabletComboResults)
      .set({ status: "thin", listingCount: 0, errorMessage: "Could not match these mods on trade.", fetchedAt: Date.now() })
      .where(eq(tabletComboResults.id, row.id));
    return;
  }

  const result = await withTimeoutStrict(
    searchAndFetchForGem(
      row.league,
      buildTradeQuery({
        status: TABLET_TRADE_STATUS,
        type: row.tablet,
        rarity: "rare",
        statIds,
        sort: { price: "asc" },
      }),
      { maxListings: FLOOR_LISTINGS, ttlMs: SEARCH_TTL_MS, maxWaitMs: MAX_INLINE_WAIT_MS },
    ),
    SEARCH_TIMEOUT_MS,
  );
  const prices = result.listings
    .map((listing) => listingExalted(listing, priceMap))
    .filter((n): n is number => n != null && n > 0);
  const { floor, median } = floorAndMedian(prices);
  const count = result.total;
  const confirmed = count >= MIN_CONFIRMED_LISTINGS && floor != null;
  await getDb()
    .update(tabletComboResults)
    .set({
      floorPriceExalted: floor,
      medianPriceExalted: median,
      listingCount: count,
      status: confirmed ? "priced" : "thin",
      tradeUrl: result.tradeUrl,
      statIds: JSON.stringify(statIds),
      errorMessage: confirmed ? null : "Fewer than 3 listings, so the price is not shown.",
      fetchedAt: Date.now(),
    })
    .where(eq(tabletComboResults.id, row.id));
}

async function saveOverviewCombos(
  league: string,
  scanStartedAt: number,
  grouped: ReturnType<typeof groupTabletOverview>,
  fetchedAt: number,
  scope: Set<string> | null,
) {
  const db = getDb();
  if (scope) {
    for (const tablet of scope) {
      await db
        .delete(tabletComboResults)
        .where(and(eq(tabletComboResults.league, league), eq(tabletComboResults.tablet, tablet)));
    }
  } else {
    await db.delete(tabletComboResults).where(eq(tabletComboResults.league, league));
  }
  for (const combo of grouped) {
    if (scope && !scope.has(combo.tablet)) continue;
    await db.insert(tabletComboResults).values({
      id: rowId(league, combo.tablet, combo.key),
      league,
      tablet: combo.tablet,
      comboKey: combo.key,
      mods: JSON.stringify({ prefixes: combo.prefixes, suffixes: combo.suffixes }),
      sampledMinExalted: combo.floorExalted,
      sampledMaxExalted: combo.medianExalted,
      floorPriceExalted: combo.floorExalted,
      medianPriceExalted: combo.medianExalted,
      listingCount: combo.listingCount,
      sampleCount: combo.sampleCount,
      status: "priced",
      tradeUrl: null,
      statIds: "[]",
      errorMessage: null,
      fetchedAt,
      scanStartedAt,
    });
  }
}

async function sampleTablet(
  league: string,
  scanStartedAt: number,
  tablet: TabletCatalogEntry,
  priceMap: Map<string, number>,
): Promise<void> {
  const stats = await getTradeStats();
  const statText = new Map(stats.map((s) => [s.id, s.text]));
  const affixes: TabletAffix[] = [...tablet.prefixes, ...tablet.suffixes];
  const chaos = tradePriceToExalted(1, "chaos", priceMap) ?? 1;
  const bands = sampleBandsExalted(chaos);
  // Bands already read come back from the search cache when a retry repeats them.
  const results = [];
  for (const band of bands) {
    results.push(
      await withTimeoutStrict(
        searchAndFetchForGem(
          league,
          buildTradeQuery({
            status: TABLET_TRADE_STATUS,
            type: tablet.name,
            rarity: "rare",
            minPriceEquivalent: band.min,
            maxPriceEquivalent: band.max,
            sort: { price: "asc" },
          }),
          { maxListings: TABLET_SAMPLE_LISTINGS, ttlMs: SEARCH_TTL_MS, maxWaitMs: MAX_INLINE_WAIT_MS },
        ),
        SEARCH_TIMEOUT_MS,
      ),
    );
  }
  const listings = results.flatMap((r) => r.listings);
  const total = results.reduce((sum, r) => sum + r.total, 0);

  interface Bucket {
    mods: ComboPayload;
    statIds: string[];
    prices: number[];
  }
  const buckets = new Map<string, Bucket>();
  for (const listing of listings) {
    const price = listingExalted(listing, priceMap);
    if (price == null || price <= 0) continue;
    const resolved = resolveListingMods({
      stats: listing.explicitStats,
      lines: listing.explicitModLines ?? [],
      affixes,
      statText,
    });
    const combo = extractFourModCombo(resolved.mods);
    if (!combo) continue;
    const prev = buckets.get(combo.key);
    if (!prev) {
      buckets.set(combo.key, {
        mods: { prefixes: combo.prefixes, suffixes: combo.suffixes },
        statIds: resolved.statIds,
        prices: [price],
      });
    } else {
      prev.prices.push(price);
    }
  }

  const now = Date.now();
  const db = getDb();
  for (const [key, bucket] of buckets) {
    const { floor, median } = floorAndMedian(bucket.prices);
    await db
      .insert(tabletComboResults)
      .values({
        id: rowId(league, tablet.name, key),
        league,
        tablet: tablet.name,
        comboKey: key,
        mods: JSON.stringify(bucket.mods),
        sampledMinExalted: floor,
        sampledMaxExalted: median,
        floorPriceExalted: null,
        medianPriceExalted: null,
        listingCount: bucket.prices.length,
        sampleCount: bucket.prices.length,
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
          sampledMinExalted: floor,
          sampledMaxExalted: median,
          sampleCount: bucket.prices.length,
          statIds: JSON.stringify(bucket.statIds),
        },
      });
  }

  // Unchecked candidates from an older sample would crowd out this one's.
  const old = await leagueRows(league, new Set([tablet.name]));
  for (const row of old) {
    if (row.status === "pending_floor" && !buckets.has(row.comboKey)) {
      await db.delete(tabletComboResults).where(eq(tabletComboResults.id, row.id));
    }
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
      listingCount: total,
      sampleCount: listings.length,
      status: "sampled",
      tradeUrl: results[0]?.tradeUrl ?? null,
      statIds: "[]",
      errorMessage: null,
      fetchedAt: now,
      scanStartedAt,
    })
    .onConflictDoUpdate({
      target: tabletComboResults.id,
      set: {
        status: "sampled",
        listingCount: total,
        sampleCount: listings.length,
        fetchedAt: now,
        scanStartedAt,
      },
    });
}

function listingExalted(listing: TradeListing, priceMap: Map<string, number>): number | null {
  if (!listing.price) return null;
  return tradePriceToExalted(listing.price.amount, listing.price.currency, priceMap);
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

function statIdsForMods(mods: ComboMod[], statText: Map<string, string>): string[] {
  const hashByNorm = new Map<string, string>();
  for (const [id, text] of statText) {
    const norm = normalizeStat(text);
    if (!norm || hashByNorm.has(norm)) continue;
    hashByNorm.set(norm, tradeExplicitId(id));
  }
  const ids = new Set<string>();
  for (const mod of mods) {
    const id = hashByNorm.get(normalizeStat(mod.text || mod.label));
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * One cached trade search for a saved combination. Returns the official
 * trade-site URL and stores it on the row.
 */
export async function openTabletTrade(rowIdValue: string): Promise<string> {
  await ensureAppTables();
  const rows = await getDb()
    .select()
    .from(tabletComboResults)
    .where(eq(tabletComboResults.id, rowIdValue))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("That tablet combination is no longer saved.");
  if (row.tradeUrl) return row.tradeUrl;
  if (!isTradeOwner()) throw new TradeOwnerError();

  const mods = [...parseMods(row.mods).prefixes, ...parseMods(row.mods).suffixes];
  const stats = await getTradeStats();
  const statIds = statIdsForMods(
    mods,
    new Map(stats.map((s) => [s.id, s.text])),
  );
  const result = await tradeSearch(
    row.league,
    buildTradeQuery({
      status: TABLET_TRADE_STATUS,
      type: row.tablet,
      rarity: "rare",
      statIds,
      sort: { price: "asc" },
    }),
    { ttlMs: SEARCH_TTL_MS, maxWaitMs: MAX_INLINE_WAIT_MS },
  );
  const url = tradeSiteUrl(row.league, result.id);
  await getDb()
    .update(tabletComboResults)
    .set({ tradeUrl: url, statIds: JSON.stringify(statIds) })
    .where(eq(tabletComboResults.id, row.id));
  return url;
}

export function readComboMods(row: TabletComboResultRow): ComboPayload {
  return parseMods(row.mods);
}
