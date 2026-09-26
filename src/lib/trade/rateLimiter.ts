import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tradeRateState } from "@/db/schema";
import { currentTradeLane, type TradeLane } from "@/lib/trade/context";

/**
 * Trade site budget. The site enforces separate policies (search, fetch, …),
 * each with rules (`Ip`, `Account` when logged in) and several windows such as
 * `5:10:60,15:60:300,30:300:1800` (hits:seconds:penalty). Headers describe the
 * live limits and the server's own counts; we record our requests too and wait
 * until every window is under its lane's share, so a long scan never trips one.
 *
 * The budget lives in memory in the one process that owns trade (the worker),
 * and a snapshot is saved every few seconds so restarts and the Runs page see it.
 */

const STATE_KEY = "default";
/** Share of every window each lane may use. Background leaves room for users. */
export const LANE_HEADROOM: Record<TradeLane, number> = { interactive: 0.7, background: 0.5 };
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
  search: [{ max: 15, periodSec: 300, penaltySec: 600, rule: "Extra" }],
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
const SAVE_EVERY_MS = 10_000;

export type TradePolicy = "search" | "fetch" | "data";

export interface Window {
  max: number;
  periodSec: number;
  penaltySec: number;
  /** Header rule the window came from (`Ip`, `Account`, …). */
  rule?: string;
}

/** Hit count the server reported for one window at time `at`. */
interface ServerCount {
  periodSec: number;
  current: number;
  at: number;
  rule?: string;
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

/** Requests one unit of work will send, e.g. one search and three fetches. */
export interface TradeCost {
  search?: number;
  fetch?: number;
}

export interface WindowUsage {
  rule: string;
  periodSec: number;
  max: number;
  allowed: number;
  used: number;
}

export interface PolicyUsage {
  policy: string;
  windows: WindowUsage[];
  blockedUntil: number;
  waitMs: number;
}

function parseTriples(raw: string | null): number[][] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim().split(":").map(Number))
    .filter((t) => t.length >= 3 && t.every((n) => Number.isFinite(n)));
}

function sameWindow(c: { rule?: string; periodSec: number }, w: { rule?: string; periodSec: number }) {
  return c.periodSec === w.periodSec && (c.rule ?? "") === (w.rule ?? "");
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
    const longest = Math.max(0, ...s.windows.map((w) => w.periodSec), 300) * 1000;
    s.hits = s.hits.filter((t) => now - t < longest).sort((a, b) => a - b);
  }

  private allWindows(policy: string, s: PolicyState): Window[] {
    return [...s.windows, ...(EXTRA_WINDOWS[policy] ?? [])];
  }

  /** Hits in a window: our own records, or the server's count plus what we sent since. */
  private used(s: PolicyState, w: Window, now: number): { used: number; releaseAt: number | null } {
    const periodMs = w.periodSec * 1000;
    const inWindow = s.hits.filter((t) => now - t < periodMs);
    let used = inWindow.length;
    let releaseAt: number | null = inWindow[0] != null ? inWindow[0] + periodMs : null;
    const server = s.counts?.find((c) => sameWindow(c, w));
    if (server && now - server.at < periodMs) {
      const serverUsed = server.current + s.hits.filter((t) => t > server.at).length;
      if (serverUsed > used) {
        used = serverUsed;
        releaseAt = server.at + periodMs;
      }
    }
    return { used, releaseAt };
  }

  /** Milliseconds until one more request on `policy` keeps every window under the lane's share. */
  waitMs(policy: string, now = Date.now(), lane: TradeLane = "interactive"): number {
    const s = this.state(policy);
    this.prune(s, now);
    const headroom = LANE_HEADROOM[lane];
    let wait = Math.max(0, s.blockedUntil - now, this.blockedUntil - now);
    const gap = s.minGapMs ?? MIN_GAP_MS[policy] ?? 0;
    const last = s.hits[s.hits.length - 1];
    if (gap > 0 && last != null) wait = Math.max(wait, last + gap - now);
    const lastAny = Math.max(
      Number.NEGATIVE_INFINITY,
      ...Object.values(this.policies).map((p) => p.hits[p.hits.length - 1] ?? Number.NEGATIVE_INFINITY),
    );
    if (Number.isFinite(lastAny)) wait = Math.max(wait, lastAny + ANY_GAP_MS - now);
    for (const w of this.allWindows(policy, s)) {
      const periodMs = w.periodSec * 1000;
      const allowed = Math.max(1, Math.floor(w.max * headroom));
      const inWindow = s.hits.filter((t) => now - t < periodMs);
      if (inWindow.length >= allowed) {
        const release = inWindow[inWindow.length - allowed];
        wait = Math.max(wait, release + periodMs - now);
      }
      // The server's count covers requests we did not record (other tabs,
      // earlier processes). Its hits expire no later than `at + period`.
      const server = s.counts?.find((c) => sameWindow(c, w));
      if (server && now - server.at < periodMs) {
        const since = s.hits.filter((t) => t > server.at).length;
        if (server.current + since >= allowed) {
          wait = Math.max(wait, server.at + periodMs - now);
        }
      }
    }
    return Math.min(wait, MAX_COOLDOWN_MS);
  }

  /**
   * Milliseconds until a whole unit of work could start and run without
   * stopping: simulates its searches then fetches against a copy of the state.
   * Returns the wait before the first request.
   */
  costWaitMs(cost: TradeCost, now = Date.now(), lane: TradeLane = "interactive"): {
    startInMs: number;
    durationMs: number;
  } {
    const sim = new TradePacer(this.snapshot());
    const steps: string[] = [
      ...Array<string>(Math.max(0, cost.search ?? 0)).fill("search"),
      ...Array<string>(Math.max(0, cost.fetch ?? 0)).fill("fetch"),
    ];
    let t = now;
    let first: number | null = null;
    for (const policy of steps) {
      t += sim.waitMs(policy, t, lane);
      if (first == null) first = t;
      sim.record(policy, t);
    }
    const start = first ?? now;
    return { startInMs: start - now, durationMs: t - start };
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
    const counts: ServerCount[] = [];
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
        windows.push({ max, periodSec, penaltySec, rule });
        const st = states.find((x) => x[1] === periodSec) ?? states[i];
        if (!st) return;
        const [current, , timeout] = st;
        if (timeout > 0) s.blockedUntil = Math.max(s.blockedUntil, now + timeout * 1000);
        counts.push({ periodSec, current, at: now, rule });
      });
    }
    if (windows.length) {
      s.windows = windows;
      s.counts = counts;
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
      s.hits = [...new Set([...s.hits, ...(value.hits ?? [])])].sort((a, b) => a - b);
      for (const c of value.counts ?? []) {
        const mine = s.counts?.find((m) => sameWindow(m, c));
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

  /** Per-window usage for the Runs page meters. */
  usage(now = Date.now(), lane: TradeLane = "interactive"): PolicyUsage[] {
    const out: PolicyUsage[] = [];
    for (const policy of ["search", "fetch"]) {
      const s = this.state(policy);
      this.prune(s, now);
      out.push({
        policy,
        blockedUntil: Math.max(s.blockedUntil, this.blockedUntil),
        waitMs: this.waitMs(policy, now, lane),
        windows: this.allWindows(policy, s).map((w) => ({
          rule: w.rule ?? "Ip",
          periodSec: w.periodSec,
          max: w.max,
          allowed: Math.max(1, Math.floor(w.max * LANE_HEADROOM[lane])),
          used: this.used(s, w, now).used,
        })),
      });
    }
    return out;
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
  /** Waits for room on `policy` in the current lane, then records the request. */
  acquire(policy: TradePolicy, opts?: { maxWaitMs?: number; lane?: TradeLane }): Promise<void>;
  observe(policy: TradePolicy, headers: RateLimitHeaderSource, status?: number): Promise<void>;
  waitMs(policy: TradePolicy, lane?: TradeLane): Promise<number>;
  /** Wait before a unit with this cost can run to the end without pausing. */
  costWaitMs(cost: TradeCost, lane?: TradeLane): Promise<{ startInMs: number; durationMs: number }>;
  usage(lane?: TradeLane): Promise<PolicyUsage[]>;
  observedHeaders(policy: TradePolicy): string | undefined;
  /** Writes the snapshot now if anything changed since the last save. */
  flush(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSnapshot(): Promise<{ snapshot: PacerSnapshot; nextAllowedAt: number; updatedAt: number } | null> {
  await ensureAppTables();
  const rows = await getDb()
    .select()
    .from(tradeRateState)
    .where(eq(tradeRateState.key, STATE_KEY))
    .limit(1);
  const row = rows[0];
  if (!row?.payload) return null;
  return {
    snapshot: JSON.parse(row.payload) as PacerSnapshot,
    nextAllowedAt: row.nextAllowedAt,
    updatedAt: row.updatedAt,
  };
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
  let loaded: Promise<void> | null = null;
  let dirty = false;
  let lastSave = 0;

  function load(): Promise<void> {
    if (!persist) return Promise.resolve();
    loaded ??= (async () => {
      try {
        const saved = await loadSnapshot();
        if (!saved) return;
        pacer.merge(saved.snapshot);
        const blocked = Math.min(saved.nextAllowedAt, now() + MAX_COOLDOWN_MS);
        pacer.merge({ policies: { search: { windows: [], hits: [], blockedUntil: blocked } } });
      } catch {
        /* persistence is best-effort */
      }
    })();
    return loaded;
  }

  async function save(force = false): Promise<void> {
    if (!persist || !dirty) return;
    const at = now();
    if (!force && at - lastSave < SAVE_EVERY_MS) return;
    dirty = false;
    lastSave = at;
    try {
      await ensureAppTables();
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
      dirty = true;
    }
  }

  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      const p = queueTail.then(fn, fn);
      queueTail = p.catch(() => {});
      return p as Promise<T>;
    },
    async acquire(policy, acquireOpts) {
      await load();
      const lane = acquireOpts?.lane ?? currentTradeLane();
      const wait = pacer.waitMs(policy, now(), lane);
      const maxWait = acquireOpts?.maxWaitMs ?? Number.POSITIVE_INFINITY;
      if (wait > maxWait) throw new TradeWaitError(wait, policy);
      if (wait > 0) await doSleep(wait);
      pacer.record(policy, now());
      dirty = true;
      void save();
    },
    async observe(policy, headers, status) {
      await load();
      pacer.observe(policy, headers, now(), status);
      dirty = true;
      // A penalty must survive a crash, so it is written straight away.
      await save(status === 429);
    },
    async waitMs(policy, lane) {
      await load();
      return pacer.waitMs(policy, now(), lane ?? currentTradeLane());
    },
    async costWaitMs(cost, lane) {
      await load();
      return pacer.costWaitMs(cost, now(), lane ?? currentTradeLane());
    },
    async usage(lane) {
      await load();
      return pacer.usage(now(), lane ?? "interactive");
    },
    observedHeaders(policy) {
      return pacer.observedHeaders(policy);
    },
    flush() {
      return save(true);
    },
  };
}

const globalForLimiter = globalThis as unknown as { __tradeRateLimiter?: TradeRateLimiter | null };

export function getTradeRateLimiter(): TradeRateLimiter {
  if (!globalForLimiter.__tradeRateLimiter) {
    const limiter = createTradeRateLimiter({ persist: true });
    globalForLimiter.__tradeRateLimiter = limiter;
    // CLI scripts exit when idle; save what they learned about the limits first.
    if (!process.env.NEXT_RUNTIME && typeof process.once === "function") {
      process.once("beforeExit", () => void limiter.flush());
    }
  }
  return globalForLimiter.__tradeRateLimiter;
}

export function setTradeRateLimiter(limiter: TradeRateLimiter | null): void {
  globalForLimiter.__tradeRateLimiter = limiter;
}

export async function flushTradeBudget(): Promise<void> {
  await globalForLimiter.__tradeRateLimiter?.flush();
}

/** Time until the next trade search is allowed, without blocking. */
export async function getTradeCooldownMs(): Promise<number> {
  return getTradeRateLimiter().waitMs("search");
}

export async function waitForTradeCooldown(): Promise<void> {
  const waitMs = await getTradeCooldownMs();
  if (waitMs > 0) await sleep(waitMs);
}

/**
 * Budget as last saved by the trade owner, for pages rendered in another
 * process (the Runs board on a hosted web server).
 */
export async function readSavedBudget(lane: TradeLane = "interactive"): Promise<{
  usage: PolicyUsage[];
  savedAt: number;
  observed: { search?: string; fetch?: string };
} | null> {
  try {
    const saved = await loadSnapshot();
    if (!saved) return null;
    const pacer = new TradePacer(saved.snapshot);
    return {
      usage: pacer.usage(Date.now(), lane),
      savedAt: saved.updatedAt,
      observed: { search: pacer.observedHeaders("search"), fetch: pacer.observedHeaders("fetch") },
    };
  } catch {
    return null;
  }
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
