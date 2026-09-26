import "server-only";
import { isRemoteDb } from "@/db";
import { countUnfinishedJobs } from "@/lib/jobs/queue";
import { drainOne } from "@/lib/jobs/runner";
import { beatDrainer, hasLiveWorker, newDrainerId, removeDrainer } from "@/lib/jobs/workers";
import { flushTradeBudget } from "@/lib/trade/rateLimiter";

/**
 * In-process queue drainer for local dev, so the app works without a separate
 * `npm run market:worker` terminal. It never starts when the database is
 * hosted or a market worker is online: only one process may talk to trade.
 * It exits once the queue has been empty for the idle grace window.
 */

const POLL_MS = 1500;
const IDLE_GRACE_MS = 20_000;
const BEAT_MS = 10_000;
/** A loop that hasn't ticked in this long was abandoned by a dev hot reload. */
const STALE_LOOP_MS = 5 * 60 * 1000;

interface PumpState {
  running: boolean;
  heartbeat: number;
  id: string;
}

const globalForPump = globalThis as unknown as { __craftQueuePump?: PumpState };

const state: PumpState = (globalForPump.__craftQueuePump ??= {
  running: false,
  heartbeat: 0,
  id: newDrainerId("pump"),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pumpLoop(): Promise<void> {
  const startedAt = Date.now();
  let idleSince: number | null = null;
  let lastBeat = 0;
  try {
    for (;;) {
      state.heartbeat = Date.now();
      if (state.heartbeat - lastBeat > BEAT_MS) {
        lastBeat = state.heartbeat;
        if (await hasLiveWorker()) return;
        await beatDrainer(state.id, "pump", startedAt, null).catch(() => {});
        await flushTradeBudget().catch(() => {});
      }

      let ran = false;
      try {
        ran = (await drainOne(state.id)) != null;
      } catch (err) {
        console.warn("[pump] job failed:", err);
      }
      if (ran) {
        idleSince = null;
        continue;
      }

      let unfinished = 0;
      try {
        unfinished = await countUnfinishedJobs();
      } catch {
        /* treat as empty */
      }
      if (unfinished > 0) idleSince = null;
      else if (idleSince == null) idleSince = Date.now();
      else if (Date.now() - idleSince > IDLE_GRACE_MS) return;

      await sleep(POLL_MS);
    }
  } finally {
    await flushTradeBudget().catch(() => {});
    await removeDrainer(state.id).catch(() => {});
  }
}

/** Starts the local queue pump if it isn't already running. Fire-and-forget. */
export function triggerQueuePump(): void {
  if (isRemoteDb()) return;
  const stale = Date.now() - state.heartbeat > STALE_LOOP_MS;
  if (state.running && !stale) return;
  state.running = true;
  state.heartbeat = Date.now();
  void pumpLoop()
    .catch((err) => console.warn("[pump] stopped:", err))
    .finally(() => {
      state.running = false;
    });
}
