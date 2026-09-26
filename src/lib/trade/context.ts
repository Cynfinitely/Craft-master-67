import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who may send live requests to the PoE2 trade API.
 *
 * GGG's limits are per IP and per account, so exactly one process should talk
 * to trade: the market worker (or, in local dev without a worker, the in-process
 * queue pump). CLI scripts run outside Next.js and own trade for their run.
 * Web requests inside Next.js never do: they read the trade cache and enqueue
 * an interactive job on a miss.
 */

export type TradeLane = "interactive" | "background";

interface TradeContext {
  owner: boolean;
  lane: TradeLane;
  jobId?: string;
}

const globalForTrade = globalThis as unknown as {
  __craftTradeContext?: AsyncLocalStorage<TradeContext>;
};

const storage: AsyncLocalStorage<TradeContext> = (globalForTrade.__craftTradeContext ??=
  new AsyncLocalStorage<TradeContext>());

export class TradeOwnerError extends Error {
  constructor(message = "Live trade requests run in the market worker — queued instead.") {
    super(message);
    this.name = "TradeOwnerError";
  }
}

/** Runs `fn` with permission to call the trade API in the given lane. */
export function runAsTradeOwner<T>(
  ctx: { lane: TradeLane; jobId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ owner: true, ...ctx }, fn);
}

export function isTradeOwner(): boolean {
  if (storage.getStore()?.owner) return true;
  return !process.env.NEXT_RUNTIME;
}

export function currentTradeLane(): TradeLane {
  return storage.getStore()?.lane ?? "interactive";
}

export function currentTradeJobId(): string | undefined {
  return storage.getStore()?.jobId;
}
