import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tradeCache } from "@/db/schema";

/**
 * Rate-limit-aware client for the (unofficial) Path of Exile 2 trade API —
 * the same endpoints the official trade site uses:
 *
 *   POST /api/trade2/search/poe2/{league}   -> { id, total, result: hashes[] }
 *   GET  /api/trade2/fetch/{h1,...}?query=  -> { result: listings[] }  (<=10/call)
 *   GET  /api/trade2/data/stats             -> searchable stat catalog
 *
 * All requests run through a single sequential queue with minimum spacing,
 * back off via the X-Rate-Limit headers / Retry-After, and every response is
 * cached in SQLite (`trade_cache`) so repeated page loads don't re-hit GGG.
 */

const TRADE_BASE = "https://www.pathofexile.com/api/trade2";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_FETCH_IDS = 10;
const MAX_429_ATTEMPTS = 6;
const GEM_INTERNAL_GAP_MS = 2800;

export class TradeApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TradeApiError";
  }
}

import {
  getTradeRateLimiter,
  parseRetryAfterMs,
  rateHeaderWaitMs,
} from "@/lib/trade/rateLimiter";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ----------------------------- request queue ----------------------------- */

async function executeRequest(
  path: string,
  init: RequestInit,
  opts?: { failFast429?: boolean },
): Promise<unknown> {
  let lastRetryAfterMs = 12_000;
  const maxAttempts = opts?.failFast429 ? 1 : MAX_429_ATTEMPTS;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${TRADE_BASE}${path}`, {
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });

    const extraWait = rateHeaderWaitMs(res);
    if (extraWait > 0) {
      const limiter = getTradeRateLimiter();
      await limiter.persistNextAllowedAt(Date.now() + extraWait);
    }

    if (res.status === 429) {
      lastRetryAfterMs = parseRetryAfterMs(res);
      const limiter = getTradeRateLimiter();
      await limiter.persistNextAllowedAt(Date.now() + lastRetryAfterMs);
      if (opts?.failFast429) {
        const policy = res.headers.get("x-rate-limit-policy") ?? "unknown";
        const state = res.headers.get("x-rate-limit-ip-state") ?? "";
        throw new TradeApiError(
          `trade2 rate-limited (${policy} ${state}, retry ${Math.round(lastRetryAfterMs / 1000)}s)`,
          429,
          lastRetryAfterMs,
        );
      }
      await sleep(lastRetryAfterMs);
      continue;
    }
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = body?.error?.message ? `: ${body.error.message}` : "";
      } catch {
        /* non-JSON error body */
      }
      throw new TradeApiError(`trade2 ${res.status} for ${path}${detail}`, res.status);
    }
    return res.json();
  }
  throw new TradeApiError(
    `trade2 rate-limited for ${path} (gave up)`,
    429,
    lastRetryAfterMs,
  );
}

/** Serializes all trade requests through the shared rate limiter. */
function enqueue(path: string, init: RequestInit): Promise<unknown> {
  return getTradeRateLimiter().schedule(() => executeRequest(path, init));
}

/* ----------------------------- sqlite cache ----------------------------- */

interface CacheEntry {
  payload: unknown;
  fetchedAt: number;
}

async function readCache(key: string): Promise<CacheEntry | null> {
  try {
    await ensureAppTables();
    const rows = await getDb()
      .select()
      .from(tradeCache)
      .where(eq(tradeCache.key, key))
      .limit(1);
    if (!rows[0]) return null;
    return { payload: JSON.parse(rows[0].payload), fetchedAt: rows[0].fetchedAt };
  } catch {
    return null;
  }
}

async function writeCache(key: string, payload: unknown): Promise<void> {
  try {
    await ensureAppTables();
    const row = { key, payload: JSON.stringify(payload), fetchedAt: Date.now() };
    await getDb()
      .insert(tradeCache)
      .values(row)
      .onConflictDoUpdate({
        target: tradeCache.key,
        set: { payload: row.payload, fetchedAt: row.fetchedAt },
      });
  } catch {
    /* cache writes are best-effort */
  }
}

function hashKey(value: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

/**
 * Cached trade request: serves from `trade_cache` while fresh, refreshes via
 * the rate-limited queue otherwise, and falls back to a stale cache entry if
 * the live request fails.
 */
async function cachedRequest(opts: {
  key: string;
  ttlMs: number;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}): Promise<unknown> {
  const cached = await readCache(opts.key);
  if (cached && Date.now() - cached.fetchedAt < opts.ttlMs) return cached.payload;
  try {
    const fresh = await enqueue(opts.path, {
      method: opts.method ?? "GET",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    await writeCache(opts.key, fresh);
    return fresh;
  } catch (err) {
    if (cached) return cached.payload; // stale beats nothing
    throw err;
  }
}

/* ----------------------------- public API ----------------------------- */

export interface TradeSearchResult {
  id: string;
  total: number;
  result: string[];
}

export interface ListingPrice {
  amount: number;
  currency: string;
}

export interface ListingStat {
  /** Trade stat hash, e.g. "explicit.stat_3299347043". */
  hash: string;
  /** Mod name from the listing ("Stout", "of the Drake", ...). */
  name: string | null;
  /** Trade tier label like "P4" / "S1". */
  tier: string | null;
  /** Modifier level. */
  level: number | null;
  /** Rolled magnitude bounds for this stat on this listing. */
  min: number | null;
  max: number | null;
}

export interface TradeListing {
  id: string;
  indexed: string | null;
  price: ListingPrice | null;
  name: string | null;
  baseType: string;
  rarity: string | null;
  ilvl: number | null;
  explicitStats: ListingStat[];
  /** Raw explicit mod lines, used when the trade payload omits stat hashes. */
  explicitModLines: string[];
}

interface RawListing {
  id?: string;
  listing?: {
    indexed?: string;
    price?: { amount?: number; currency?: string } | null;
  };
  item?: {
    name?: string;
    baseType?: string;
    typeLine?: string;
    rarity?: string;
    ilvl?: number;
    explicitMods?: unknown[];
    extended?: {
      mods?: {
        explicit?: {
          name?: string;
          tier?: string;
          level?: number;
          magnitudes?: { hash?: string; min?: string | number; max?: string | number }[] | null;
        }[];
      };
    };
  };
}

function explicitLines(raw: unknown[] | undefined, stats: ListingStat[]): string[] {
  const lines: string[] = [];
  for (const entry of raw ?? []) {
    if (typeof entry === "string") {
      if (entry.trim()) lines.push(entry);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { description?: unknown; hash?: unknown };
    const description = typeof row.description === "string" ? row.description : "";
    const hash = typeof row.hash === "string" ? row.hash : "";
    if (description) lines.push(description);
    if (hash && !stats.some((s) => s.hash === hash)) {
      stats.push({
        hash,
        name: null,
        tier: null,
        level: null,
        min: null,
        max: null,
      });
    }
  }
  return lines;
}

function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseListing(raw: RawListing): TradeListing | null {
  const item = raw.item;
  if (!raw.id || !item?.baseType) return null;
  const stats: ListingStat[] = [];
  for (const mod of item.extended?.mods?.explicit ?? []) {
    const mags = (mod.magnitudes ?? []).filter((mag) => mag?.hash);
    if (mags.length === 0) {
      stats.push({
        hash: "",
        name: mod.name ?? null,
        tier: mod.tier ?? null,
        level: mod.level ?? null,
        min: null,
        max: null,
      });
      continue;
    }
    for (const mag of mags) {
      stats.push({
        hash: mag.hash ?? "",
        name: mod.name ?? null,
        tier: mod.tier ?? null,
        level: mod.level ?? null,
        min: toNum(mag.min),
        max: toNum(mag.max),
      });
    }
  }
  const price = raw.listing?.price;
  return {
    id: raw.id,
    indexed: raw.listing?.indexed ?? null,
    price:
      price && typeof price.amount === "number" && price.currency
        ? { amount: price.amount, currency: price.currency }
        : null,
    name: item.name || null,
    baseType: item.baseType,
    rarity: item.rarity ?? null,
    ilvl: item.ilvl ?? null,
    explicitStats: stats,
    explicitModLines: explicitLines(item.explicitMods, stats),
  };
}

/** Runs a trade search; the raw `query` object follows the trade-site schema. */
export async function tradeSearch(
  league: string,
  query: Record<string, unknown>,
  opts: { ttlMs?: number } = {},
): Promise<TradeSearchResult> {
  const raw = (await cachedRequest({
    key: `search:${league}:${hashKey(query)}`,
    ttlMs: opts.ttlMs ?? 30 * 60 * 1000,
    path: `/search/poe2/${encodeURIComponent(league)}`,
    method: "POST",
    body: query,
  })) as { id?: string; total?: number; result?: string[] };
  if (!raw?.id || !Array.isArray(raw.result)) {
    throw new TradeApiError("trade2 search returned an unexpected shape");
  }
  return { id: raw.id, total: raw.total ?? raw.result.length, result: raw.result };
}

/** Fetches listing details for result hashes (chunked at the API's max of 10). */
export async function tradeFetchListings(
  hashes: string[],
  queryId: string,
): Promise<TradeListing[]> {
  const out: TradeListing[] = [];
  for (let i = 0; i < hashes.length; i += MAX_FETCH_IDS) {
    const chunk = hashes.slice(i, i + MAX_FETCH_IDS);
    const raw = (await cachedRequest({
      key: `fetch:${hashKey(chunk)}`,
      ttlMs: 30 * 60 * 1000,
      path: `/fetch/${chunk.join(",")}?query=${encodeURIComponent(queryId)}`,
    })) as { result?: (RawListing | null)[] };
    for (const r of raw?.result ?? []) {
      if (!r) continue;
      const parsed = parseListing(r);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

export interface SearchAndFetchResult {
  queryId: string;
  total: number;
  listings: TradeListing[];
  /** Browser URL of this search on the official trade site. */
  tradeUrl: string;
}

/**
 * Search + fetch in one cached unit: runs the search, fetches up to
 * `maxListings` listings, and caches the combined result so a page reload
 * costs zero trade requests.
 */
export async function searchAndFetch(
  league: string,
  query: Record<string, unknown>,
  opts: { maxListings?: number; ttlMs?: number } = {},
): Promise<SearchAndFetchResult> {
  const maxListings = Math.min(100, opts.maxListings ?? 20);
  const ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
  const key = `saf:${league}:${maxListings}:${hashKey(query)}`;

  const cached = await readCache(key);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return cached.payload as SearchAndFetchResult;
  }
  try {
    const search = await tradeSearch(league, query, { ttlMs });
    const listings = await tradeFetchListings(
      search.result.slice(0, maxListings),
      search.id,
    );
    const result: SearchAndFetchResult = {
      queryId: search.id,
      total: search.total,
      listings,
      tradeUrl: tradeSiteUrl(league, search.id),
    };
    await writeCache(key, result);
    return result;
  } catch (err) {
    if (cached) return cached.payload as SearchAndFetchResult;
    throw err;
  }
}

/**
 * Gem-scan path: one rate-limited slot for search + internal gap + fetch.
 * Avoids nested enqueue bursts that trip GGG's IP window.
 */
export async function searchAndFetchForGem(
  league: string,
  query: Record<string, unknown>,
  opts: { maxListings?: number; ttlMs?: number } = {},
): Promise<SearchAndFetchResult> {
  const maxListings = Math.min(100, opts.maxListings ?? 20);
  const ttlMs = opts.ttlMs ?? 30 * 60 * 1000;
  const key = `saf:${league}:${maxListings}:${hashKey(query)}`;

  const cached = await readCache(key);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return cached.payload as SearchAndFetchResult;
  }

  const runLive = async (): Promise<SearchAndFetchResult> => {
    const searchPath = `/search/poe2/${encodeURIComponent(league)}`;
    const rawSearch = (await executeRequest(
      searchPath,
      {
        method: "POST",
        body: JSON.stringify(query),
      },
      { failFast429: true },
    )) as { id?: string; total?: number; result?: string[] };
    if (!rawSearch?.id || !Array.isArray(rawSearch.result)) {
      throw new TradeApiError("trade2 search returned an unexpected shape");
    }

    await sleep(GEM_INTERNAL_GAP_MS);

    const hashes = rawSearch.result.slice(0, maxListings);
    const listings: TradeListing[] = [];
    for (let i = 0; i < hashes.length; i += MAX_FETCH_IDS) {
      if (i > 0) await sleep(GEM_INTERNAL_GAP_MS);
      const chunk = hashes.slice(i, i + MAX_FETCH_IDS);
      const rawFetch = (await executeRequest(
        `/fetch/${chunk.join(",")}?query=${encodeURIComponent(rawSearch.id)}`,
        { method: "GET" },
        { failFast429: true },
      )) as { result?: (RawListing | null)[] };
      for (const r of rawFetch?.result ?? []) {
        if (!r) continue;
        const parsed = parseListing(r);
        if (parsed) listings.push(parsed);
      }
    }

    return {
      queryId: rawSearch.id,
      total: rawSearch.total ?? rawSearch.result.length,
      listings,
      tradeUrl: tradeSiteUrl(league, rawSearch.id),
    };
  };

  try {
    const result = await getTradeRateLimiter().schedule(runLive);
    await writeCache(key, result);
    return result;
  } catch (err) {
    if (cached) return cached.payload as SearchAndFetchResult;
    throw err;
  }
}

export interface TradeStatEntry {
  id: string;
  text: string;
  type: string;
}

/** Full searchable stat catalog (cached for 24h; it changes per patch). */
export async function fetchTradeStatCatalog(): Promise<TradeStatEntry[]> {
  const raw = (await cachedRequest({
    key: "data:stats",
    ttlMs: 24 * 60 * 60 * 1000,
    path: "/data/stats",
  })) as {
    result?: { id: string; entries?: { id?: string; text?: string; type?: string }[] }[];
  };
  const out: TradeStatEntry[] = [];
  for (const section of raw?.result ?? []) {
    for (const e of section.entries ?? []) {
      if (!e.id || !e.text || !e.type) continue;
      out.push({ id: e.id, text: e.text, type: e.type });
    }
  }
  return out;
}

export interface GemCatalogEntry {
  /** Exact gem base type used as the trade query `type` (e.g. "Fireball"). */
  type: string;
  /** Display text (usually identical to `type`). */
  text: string;
}

/**
 * The "gem" section of `/api/trade2/data/items` — every tradeable gem base
 * type (skill, support, spirit, meta, Vaal). Entries carry no active/support
 * flag, so callers that only want corruptable skill gems should drive
 * discovery off an actual `gem_level >= 21` market search (supports have no
 * level) and use this catalog only to validate/normalize names. Cached 24h.
 */
export async function fetchGemItemCatalog(): Promise<GemCatalogEntry[]> {
  const raw = (await cachedRequest({
    key: "data:items:gems",
    ttlMs: 24 * 60 * 60 * 1000,
    path: "/data/items",
  })) as {
    result?: { id?: string; entries?: { type?: string; text?: string }[] }[];
  };
  const section = raw?.result?.find((s) => s.id === "gem");
  const out: GemCatalogEntry[] = [];
  for (const e of section?.entries ?? []) {
    if (!e.type) continue;
    out.push({ type: e.type, text: e.text ?? e.type });
  }
  return out;
}

/** Browser URL of a search on the official PoE2 trade site. */
export function tradeSiteUrl(league: string, queryId: string): string {
  return `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league)}/${queryId}`;
}

/** Resolves a promise with a timeout, returning `null` instead of hanging. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p.catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class TradeTimeoutError extends Error {
  constructor(ms: number) {
    super(`trade request timed out after ${ms}ms`);
    this.name = "TradeTimeoutError";
  }
}

/** Like `withTimeout`, but re-throws errors (including 429) and throws on timeout. */
export async function withTimeoutStrict<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TradeTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
