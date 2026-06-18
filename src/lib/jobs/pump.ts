import "server-only";
import { claimNextJob, countUnfinishedJobs } from "@/lib/jobs/queue";
import { handleMarketJob } from "@/lib/jobs/handlers";

/**
 * In-process queue drainer — lets "Scan all gems" run itself inside the Next
 * dev/server process, so no separate `npm run market:worker` terminal is
 * needed. A single loop (guarded by a globalThis singleton, like the rate
 * limiter) claims jobs, runs them, and keeps polling while any job is still
 * pending/running (covers the between-batch and rate-limit reschedules). It
 * exits once the queue has been empty for the idle grace window.
 */

const POLL_MS = 1500;
/** Keep polling this long after the queue is fully empty before stopping. */
const IDLE_GRACE_MS = 20_000;
/** If a "running" pump hasn't ticked in this long, treat it as dead and restart
 * (covers dev hot-reloads that abandon the loop while the flag stays set). This
 * is well above any normal claim duration, so it never spawns a duplicate. */
const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

interface PumpState {
  running: boolean;
  heartbeat: number;
}

const globalForPump = globalThis as unknown as {
  __craftQueuePump?: PumpState;
};

const state: PumpState = (globalForPump.__craftQueuePump ??= {
  running: false,
  heartbeat: 0,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pumpLoop(): Promise<void> {
  let idleSince: number | null = null;
  for (;;) {
    state.heartbeat = Date.now();
    let ran = false;
    try {
      const job = await claimNextJob();
      if (job) {
        ran = true;
        idleSince = null;
        await handleMarketJob(job);
      }
    } catch (err) {
      // Never let one failed job kill the pump; the job row records the error.
      console.warn("[pump] job failed:", err);
    }

    if (ran) continue;

    // Nothing claimable right now. Keep polling while work is still queued
    // (rescheduled future jobs); only stop after a quiet grace period.
    let unfinished = 0;
    try {
      unfinished = await countUnfinishedJobs();
    } catch {
      /* treat as empty */
    }

    if (unfinished > 0) {
      idleSince = null;
    } else if (idleSince == null) {
      idleSince = Date.now();
    } else if (Date.now() - idleSince > IDLE_GRACE_MS) {
      break;
    }

    await sleep(POLL_MS);
  }
}

/**
 * Starts the queue pump if it isn't already running. Fire-and-forget: callers
 * (the enqueue route, the gems page) don't await it.
 */
export function triggerQueuePump(): void {
  const stale = Date.now() - state.heartbeat > STALE_HEARTBEAT_MS;
  if (state.running && !stale) return;
  state.running = true;
  state.heartbeat = Date.now();
  void pumpLoop().finally(() => {
    state.running = false;
  });
}
