import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tradeRateState } from "@/db/schema";

/**
 * Trade site pacing. The site enforces separate budgets per policy (search,
 * fetch, …), each with several windows such as `5:10:60,15:60:300,30:300:1800`
 * (hits:seconds:penalty). We record our own requests per policy and wait until
 * every window is under 70% of its limit, so a long scan never crosses one.
 * Server state headers and penalties override our local count.
 */

const STATE_KEY = "default";
const HEADROOM = 0.7;
/** Caps a bogus header; the longest real penalty we have seen is 30 minutes. */
const MAX_COOLDOWN_MS = 60 * 60 * 1000;
/** Header-less first requests use the tightest windows reported for each policy. */
const DEFAULT_RULES: Record<string, Window[]> = {
  search: [
    { max: 5, periodSec: 10, penaltySec: 60 },
    { max: 15, periodSec: 60, penaltySec: 300 },
    { max: 30, periodSec: 300, penaltySec: 1800 },
  ],
  fetch: [
    { max: 12, periodSec: 4, penaltySec: 10 },
    { max: 16, periodSec: 12, penaltySec: 300 },
  ],
  data: [{ max: 5, periodSec: 10, penaltySec: 60 }],
};
/**
 * Searches also 429 (Retry-After 600) at about 15 in two minutes while every
 * published window still has room, so searches keep a minimum gap. Each
 * unexplained 429 doubles it.
 */
const MIN_GAP_MS: Record<string, number> = { search: 12_000, fetch: 3_000 };
/**
 * Windows enforced on top of the headers. Unauthenticated searches were
 * locked out at 13 and 16 searches per 5 minutes although the header says 30.
 */
const EXTRA_WINDOWS: Record<string, Window[]> = {
  search: [{ max: 15, periodSec: 300, penaltySec: 600 }],
};
/** Every lockout so far hit a request sent within a second of the previous one. */
const ANY_GAP_MS = 3_500;
/**
 * GGG restricts clients that send too many 4xx responses in a short time;
 * after this many non-429 errors in the window, every request pauses.
 */
const INVALID_LIMIT = 3;
const INVALID_WINDOW_MS = 10 * 60 * 1000;
const MAX_GAP_MS = 60_000;

export type TradePolicy = "search" | "fetch" | "data";

export interface Window {
  max: number;
  periodSec: number;
  penaltySec: number;
}

/** Hit count the server reported for one window at time `at`. */
interface ServerCount {
  periodSec: number;
  current: number;
  at: number;
}

interface PolicyState {
  windows: Window[];
  hits: number[];
  counts?: ServerCount[];
  blockedUntil: number;
  minGapMs?: number;
  /** Raw headers from the last response, for the job log. */
  observed?: string;
}

export interface PacerSnapshot {
  policies: Record<string, PolicyState>;
  /** Pause for every policy, set by a 429 or too many other 4xx responses. */
  blockedUntil?: number;
  /** Times of recent non-429 4xx responses. */
  invalid?: number[];
}

export interface RateLimitHeaderSource {
  get(name: string): string | null;
}

function parseTriples(raw: string | null): number[][] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim().split(":").map(Number))
    .filter((t) => t.length >= 3 && t.every((n) => Number.isFinite(n)));
}

/** Pure pacing state; persistence and sleeping live in the limiter below. */
export class TradePacer {
  private policies: Record<string, PolicyState>;
  private blockedUntil: number;
  private invalid: number[];

  constructor(snapshot?: PacerSnapshot) {
    this.policies = {};
    this.blockedUntil = snapshot?.blockedUntil ?? 0;
    this.invalid = [...(snapshot?.invalid ?? [])];
    for (const [key, value] of Object.entries(snapshot?.policies ?? {})) {
      this.policies[key] = {
        windows: value.windows?.length ? value.windows : DEFAULT_RULES[key] ?? [],
        hits: [...(value.hits ?? [])],
        counts: [...(value.counts ?? [])],
        blockedUntil: value.blockedUntil ?? 0,
        minGapMs: value.minGapMs,
        observed: value.observed,
      };
    }
  }

  private state(policy: string): PolicyState {
    let s = this.policies[policy];
    if (!s) {
      s = { windows: [...(DEFAULT_RULES[policy] ?? DEFAULT_RULES.search)], hits: [], blockedUntil: 0 };
      this.policies[policy] = s;
    }
    return s;
  }

  private prune(s: PolicyState, now: number) {
    const longest = Math.max(0, ...s.windows.map((w) => w.periodSec)) * 1000;
    s.hits = s.hits.filter((t) => now - t < longest).sort((a, b) => a - b);
  }

  /** Milliseconds until one more request on `policy` keeps every window under 70%. */
  waitMs(policy: string, now = Date.now()): number {
    const s = this.state(policy);
    this.prune(s, now);
    let wait = Math.max(0, s.blockedUntil - now, this.blockedUntil - now);
    const gap = s.minGapMs ?? MIN_GAP_MS[policy] ?? 0;
    const last = s.hits[s.hits.length - 1];
    if (gap > 0 && last != null) wait = Math.max(wait, last + gap - now);
    const lastAny = Math.max(
      Number.NEGATIVE_INFINITY,
      ...Object.values(this.policies).map((p) => p.hits[p.hits.length - 1] ?? Number.NEGATIVE_INFINITY),
    );
    if (Number.isFinite(lastAny)) wait = Math.max(wait, lastAny + ANY_GAP_MS - now);
    for (const w of [...s.windows, ...(EXTRA_WINDOWS[policy] ?? [])]) {
      const periodMs = w.periodSec * 1000;
      const allowed = Math.max(1, Math.floor(w.max * HEADROOM));
      const inWindow = s.hits.filter((t) => now - t < periodMs);
      if (inWindow.length >= allowed) {
        const release = inWindow[inWindow.length - allowed];
        wait = Math.max(wait, release + periodMs - now);
      }
      // The server's count covers requests we did not record (other tabs,
      // earlier processes). Its hits expire no later than `at + period`.
      const server = s.counts?.find((c) => c.periodSec === w.periodSec);
      if (server && now - server.at < periodMs) {
        const since = s.hits.filter((t) => t > server.at).length;
        if (server.current + since >= allowed) {
          wait = Math.max(wait, server.at + periodMs - now);
        }
      }
    }
    return Math.min(wait, MAX_COOLDOWN_MS);
  }

  record(policy: string, now = Date.now()) {
    const s = this.state(policy);
    s.hits.push(now);
    this.prune(s, now);
  }

  /**
   * Learns the real windows and the server's hit counts from a response, and
   * applies any penalty or Retry-After. A 429 also widens the minimum gap.
   */
  observe(policy: string, headers: RateLimitHeaderSource, now = Date.now(), status = 200) {
    const s = this.state(policy);
    if (status === 429) {
      const gap = s.minGapMs ?? MIN_GAP_MS[policy] ?? 0;
      s.minGapMs = Math.min(MAX_GAP_MS, Math.max(2_000, gap * 2));
    } else if (status >= 400 && status < 500) {
      this.invalid = [...this.invalid.filter((t) => now - t < INVALID_WINDOW_MS), now];
      if (this.invalid.length >= INVALID_LIMIT) {
        this.blockedUntil = Math.max(this.blockedUntil, now + INVALID_WINDOW_MS);
      }
    }
    const named = (headers.get("x-rate-limit-rules") ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    const rules = named.length ? named : headers.get("x-rate-limit-ip") ? ["Ip"] : [];
    const windows: Window[] = [];
    const counts = new Map<number, ServerCount>();
    const observed: string[] = [];
    for (const rule of rules) {
      const key = rule.toLowerCase();
      const limits = parseTriples(headers.get(`x-rate-limit-${key}`));
      const states = parseTriples(headers.get(`x-rate-limit-${key}-state`));
      if (limits.length) {
        observed.push(
          `${rule} ${headers.get(`x-rate-limit-${key}`)} (state ${headers.get(`x-rate-limit-${key}-state`) ?? "?"})`,
        );
      }
      limits.forEach(([max, periodSec, penaltySec], i) => {
        windows.push({ max, periodSec, penaltySec });
        const st = states[i];
        if (!st) return;
        const [current, , timeout] = st;
        if (timeout > 0) s.blockedUntil = Math.max(s.blockedUntil, now + timeout * 1000);
        const prev = counts.get(periodSec);
        if (!prev || current > prev.current) counts.set(periodSec, { periodSec, current, at: now });
      });
    }
    if (windows.length) {
      s.windows = windows;
      s.counts = [...counts.values()];
      s.observed = observed.join(" · ");
    }
    const retryAfter = Number(headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      s.blockedUntil = Math.max(s.blockedUntil, now + (retryAfter + 1) * 1000);
    }
    if (status === 429) {
      // A 429 on one policy still counts toward the shared invalid-request
      // threshold, so every trade request pauses until it clears.
      const fallback = now + (MIN_GAP_MS[policy] ?? 60_000);
      this.blockedUntil = Math.max(this.blockedUntil, s.blockedUntil, fallback);
    }
    this.prune(s, now);
  }

  merge(other: PacerSnapshot) {
    this.blockedUntil = Math.max(this.blockedUntil, other.blockedUntil ?? 0);
    this.invalid = [...new Set([...this.invalid, ...(other.invalid ?? [])])];
    for (const [policy, value] of Object.entries(other.policies ?? {})) {
      const s = this.state(policy);
      if (value.windows?.length) s.windows = value.windows;
      s.blockedUntil = Math.max(s.blockedUntil, value.blockedUntil ?? 0);
      s.hits = [...new Set([...s.hits, ...(value.hits ?? [])])];
      for (const c of value.counts ?? []) {
        const mine = s.counts?.find((m) => m.periodSec === c.periodSec);
        if (!mine) s.counts = [...(s.counts ?? []), c];
        else if (c.at > mine.at) Object.assign(mine, c);
      }
      if (value.observed) s.observed = value.observed;
      if (value.minGapMs != null) s.minGapMs = Math.max(s.minGapMs ?? 0, value.minGapMs);
    }
  }

  observedHeaders(policy: string): string | undefined {
    return this.policies[policy]?.observed;
  }

  snapshot(): PacerSnapshot {
    return {
      policies: JSON.parse(JSON.stringify(this.policies)),
      blockedUntil: this.blockedUntil,
      invalid: [...this.invalid],
    };
  }
}

/** A trade request that would have to wait longer than the caller allows. */
export class TradeWaitError extends Error {
  readonly status = 429;
  constructor(
    public readonly retryAfterMs: number,
    public readonly policy: string,
  ) {
    super(`trade2 rate-limited (${policy} paced, retry ${Math.round(retryAfterMs / 1000)}s)`);
    this.name = "TradeWaitError";
  }
}

export interface TradeRateLimiter {
  /** Serializes callers so one request sequence runs at a time. */
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  /** Waits for room on `policy`, then records the request. */
  acquire(policy: TradePolicy, opts?: { maxWaitMs?: number }): Promise<void>;
  observe(policy: TradePolicy, headers: RateLimitHeaderSource, status?: number): Promise<void>;
  waitMs(policy: TradePolicy): Promise<number>;
  observedHeaders(policy: TradePolicy): string | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createTradeRateLimiter(opts?: {
  persist?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): TradeRateLimiter {
  const persist = opts?.persist !== false;
  const now = opts?.now ?? (() => Date.now());
  const doSleep = opts?.sleep ?? sleep;
  const pacer = new TradePacer();
  let queueTail: Promise<unknown> = Promise.resolve();

  async function reload(): Promise<void> {
    if (!persist) return;
    try {
      await ensureAppTables();
      const rows = await getDb()
        .select()
        .from(tradeRateState)
        .where(eq(tradeRateState.key, STATE_KEY))
        .limit(1);
      const row = rows[0];
      if (!row) return;
      if (row.payload) pacer.merge(JSON.parse(row.payload) as PacerSnapshot);
      const blocked = Math.min(row.nextAllowedAt, now() + MAX_COOLDOWN_MS);
      pacer.merge({ policies: { search: { windows: [], hits: [], blockedUntil: blocked } } });
    } catch {
      /* persistence is best-effort */
    }
  }

  async function save(): Promise<void> {
    if (!persist) return;
    try {
      await ensureAppTables();
      const at = now();
      const payload = JSON.stringify(pacer.snapshot());
      const nextAllowedAt = at + pacer.waitMs("search", at);
      await getDb()
        .insert(tradeRateState)
        .values({ key: STATE_KEY, nextAllowedAt, payload, updatedAt: at })
        .onConflictDoUpdate({
          target: tradeRateState.key,
          set: { nextAllowedAt, payload, updatedAt: at },
        });
    } catch {
      /* best-effort */
    }
  }

  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      const p = queueTail.then(fn, fn);
      queueTail = p.catch(() => {});
      return p as Promise<T>;
    },
    async acquire(policy, acquireOpts) {
      await reload();
      const wait = pacer.waitMs(policy, now());
      const maxWait = acquireOpts?.maxWaitMs ?? Number.POSITIVE_INFINITY;
      if (wait > maxWait) throw new TradeWaitError(wait, policy);
      if (wait > 0) await doSleep(wait);
      pacer.record(policy, now());
      await save();
    },
    async observe(policy, headers, status) {
      pacer.observe(policy, headers, now(), status);
      await save();
    },
    async waitMs(policy) {
      await reload();
      return pacer.waitMs(policy, now());
    },
    observedHeaders(policy) {
      return pacer.observedHeaders(policy);
    },
  };
}

const globalForLimiter = globalThis as unknown as { __tradeRateLimiter?: TradeRateLimiter | null };

export function getTradeRateLimiter(): TradeRateLimiter {
  if (!globalForLimiter.__tradeRateLimiter) {
    globalForLimiter.__tradeRateLimiter = createTradeRateLimiter({ persist: true });
  }
  return globalForLimiter.__tradeRateLimiter;
}

export function setTradeRateLimiter(limiter: TradeRateLimiter | null): void {
  globalForLimiter.__tradeRateLimiter = limiter;
}

/** Time until the next trade search is allowed, without blocking. */
export async function getTradeCooldownMs(): Promise<number> {
  return getTradeRateLimiter().waitMs("search");
}

export async function waitForTradeCooldown(): Promise<void> {
  const waitMs = await getTradeCooldownMs();
  if (waitMs > 0) await sleep(waitMs);
}

/** Wait implied by one response's headers alone (tests and diagnostics). */
export function rateLimitWaitMs(headers: RateLimitHeaderSource): number {
  const pacer = new TradePacer({ policies: {} });
  const at = 0;
  pacer.observe("probe", headers, at);
  return pacer.waitMs("probe", at);
}

/** Parse Retry-After header into milliseconds (default 12s). */
export function parseRetryAfterMs(res: Response, defaultSec = 12): number {
  const retryAfter = Number(res.headers.get("retry-after") ?? String(defaultSec));
  const sec = Number.isFinite(retryAfter) ? retryAfter + 1 : defaultSec + 1;
  return sec * 1000;
}
