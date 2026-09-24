import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tradeRateState } from "@/db/schema";

const STATE_KEY = "default";
export const MIN_SPACING_MS = 2800;
/** Hard ceiling on any single cooldown — guards against a poisoned/stale
 * persisted backoff (e.g. an oversized header window) stalling work forever. */
const MAX_COOLDOWN_MS = 15 * 60 * 1000;

export interface TradeRateLimiterState {
  nextAllowedAt: number;
  windowRemaining: number;
}

export interface TradeRateLimiter {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  getState(): TradeRateLimiterState;
  persistNextAllowedAt(at: number): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** In-process limiter with optional SQLite persistence. */
export function createTradeRateLimiter(opts?: {
  minSpacingMs?: number;
  persist?: boolean;
}): TradeRateLimiter {
  const minSpacingMs = opts?.minSpacingMs ?? MIN_SPACING_MS;
  let queueTail: Promise<unknown> = Promise.resolve();
  let nextAllowedAt = 0;

  async function reloadPersisted(): Promise<void> {
    if (opts?.persist === false) return;
    try {
      await ensureAppTables();
      const db = getDb();
      const rows = await db
        .select()
        .from(tradeRateState)
        .where(eq(tradeRateState.key, STATE_KEY))
        .limit(1);
      if (rows[0]) {
        const capped = Math.min(
          rows[0].nextAllowedAt,
          Date.now() + MAX_COOLDOWN_MS,
        );
        nextAllowedAt = Math.max(nextAllowedAt, capped);
      }
    } catch {
      /* persistence optional */
    }
  }

  async function persistNextAllowedAt(at: number): Promise<void> {
    if (opts?.persist === false) return;
    nextAllowedAt = Math.max(nextAllowedAt, at);
    try {
      await ensureAppTables();
      const db = getDb();
      const now = Date.now();
      await db
        .insert(tradeRateState)
        .values({
          key: STATE_KEY,
          nextAllowedAt,
          payload: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: tradeRateState.key,
          set: {
            nextAllowedAt,
            updatedAt: now,
          },
        });
    } catch {
      /* best-effort */
    }
  }

  return {
    schedule<T>(fn: () => Promise<T>): Promise<T> {
      const run = async () => {
        await reloadPersisted();
        const now = Date.now();
        if (now < nextAllowedAt) await sleep(nextAllowedAt - now);
        try {
          return await fn();
        } finally {
          nextAllowedAt = Math.max(nextAllowedAt, Date.now() + minSpacingMs);
          await persistNextAllowedAt(nextAllowedAt);
        }
      };
      const p = queueTail.then(run, run);
      queueTail = p.catch(() => {});
      return p as Promise<T>;
    },
    getState(): TradeRateLimiterState {
      return {
        nextAllowedAt,
        windowRemaining: Math.max(0, nextAllowedAt - Date.now()),
      };
    },
    persistNextAllowedAt,
  };
}

let sharedLimiter: TradeRateLimiter | null = null;

export function getTradeRateLimiter(): TradeRateLimiter {
  if (!sharedLimiter) {
    sharedLimiter = createTradeRateLimiter({ persist: true });
  }
  return sharedLimiter;
}

export function setTradeRateLimiter(limiter: TradeRateLimiter | null): void {
  sharedLimiter = limiter;
}

/**
 * Remaining shared trade cooldown in ms (from DB + in-memory), without
 * blocking. Callers can decide whether to wait inline or reschedule.
 */
export async function getTradeCooldownMs(): Promise<number> {
  const limiter = getTradeRateLimiter();
  let nextAt = limiter.getState().nextAllowedAt;
  try {
    await ensureAppTables();
    const rows = await getDb()
      .select()
      .from(tradeRateState)
      .where(eq(tradeRateState.key, STATE_KEY))
      .limit(1);
    if (rows[0]) nextAt = Math.max(nextAt, rows[0].nextAllowedAt);
  } catch {
    /* optional */
  }
  return Math.min(MAX_COOLDOWN_MS, Math.max(0, nextAt - Date.now()));
}

/**
 * Blocks until the shared trade cooldown (from DB + in-memory) elapses.
 */
export async function waitForTradeCooldown(): Promise<void> {
  const waitMs = await getTradeCooldownMs();
  if (waitMs > 0) await sleep(waitMs);
}

/** Upper bound on a proactive header-derived wait; longer backoffs are handled
 * by rescheduling the job (so the claim never blocks for minutes silently). */
const MAX_HEADER_WAIT_MS = 60_000;

export function rateHeaderWaitMs(res: Response): number {
  const limits = res.headers.get("x-rate-limit-ip");
  const state = res.headers.get("x-rate-limit-ip-state");
  if (!limits || !state) return 0;
  const lim = limits.split(",").map((s) => s.split(":").map(Number));
  const st = state.split(",").map((s) => s.split(":").map(Number));
  let wait = 0;
  for (let i = 0; i < Math.min(lim.length, st.length); i++) {
    const [max, period] = lim[i];
    const [current] = st[i];
    if (!max || !period) continue;
    const periodMs = period * 1000;
    if (current >= max) wait = Math.max(wait, periodMs);
    else if (current >= max - 1) wait = Math.max(wait, periodMs / 2);
    else if (current >= max - 2) wait = Math.max(wait, periodMs / max);
  }
  return Math.min(wait, MAX_HEADER_WAIT_MS);
}

/** Parse Retry-After header into milliseconds (default 12s). */
export function parseRetryAfterMs(res: Response, defaultSec = 12): number {
  const retryAfter = Number(res.headers.get("retry-after") ?? String(defaultSec));
  const sec = Number.isFinite(retryAfter) ? retryAfter + 1 : defaultSec + 1;
  return sec * 1000;
}
