import type { MarketJobRow } from "@/db/schema";
import { handleMarketJob } from "@/lib/jobs/handlers";
import { claimNextJob, HEARTBEAT_MS, heartbeatJob, type JobLane } from "@/lib/jobs/queue";
import { runAsTradeOwner } from "@/lib/trade/context";

/**
 * Runs one claimed job as the trade owner in the job's lane, keeping its lease
 * alive until the handler returns.
 */
export async function runClaimedJob(job: MarketJobRow, owner: string): Promise<void> {
  const timer = setInterval(() => {
    void heartbeatJob(job.id, owner).catch(() => {});
  }, HEARTBEAT_MS);
  try {
    await runAsTradeOwner({ lane: job.lane as JobLane, jobId: job.id }, () => handleMarketJob(job));
  } finally {
    clearInterval(timer);
  }
}

/** Claims and runs the next due job. Returns the job, or null when none is due. */
export async function drainOne(
  owner: string,
  onClaim?: (job: MarketJobRow) => void,
): Promise<MarketJobRow | null> {
  const job = await claimNextJob({ owner });
  if (!job) return null;
  onClaim?.(job);
  await runClaimedJob(job, owner);
  return job;
}
