import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tradeRateState } from "@/db/schema";

const STATE_KEY = "default";
const MIN_SPACING_MS = 1500;

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
  let loaded = false;

  async function loadPersisted(): Promise<void> {
    if (loaded || opts?.persist === false) return;
    loaded = true;
    try {
      await ensureAppTables();
      const db = getDb();
      const rows = await db
        .select()
        .from(tradeRateState)
        .where(eq(tradeRateState.key, STATE_KEY))
        .limit(1);
      if (rows[0]) {
        nextAllowedAt = Math.max(nextAllowedAt, rows[0].nextAllowedAt);
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
        await loadPersisted();
        const now = Date.now();
        if (now < nextAllowedAt) await sleep(nextAllowedAt - now);
        nextAllowedAt = Date.now() + minSpacingMs;
        await persistNextAllowedAt(nextAllowedAt);
        return fn();
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
    if (current >= max) wait = Math.max(wait, period * 1000);
    else if (current >= max - 1) wait = Math.max(wait, (period * 1000) / 2);
    else if (current >= max - 2) wait = Math.max(wait, (period * 1000) / max);
  }
  return wait;
}
