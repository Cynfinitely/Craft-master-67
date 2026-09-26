import type { ProgressJob } from "@/lib/progress";

const TERMINAL = new Set<ProgressJob["status"]>(["done", "error", "cancelled"]);

/**
 * Browser helper: polls a queue job until it finishes and returns it.
 * Rejects when the signal aborts.
 */
export async function waitForJob(
  id: string,
  opts: { intervalMs?: number; signal?: AbortSignal; onUpdate?: (job: ProgressJob) => void } = {},
): Promise<ProgressJob> {
  const interval = opts.intervalMs ?? 1200;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const res = await fetch(`/api/jobs?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal: opts.signal,
      });
      const body = (await res.json()) as { job: ProgressJob | null };
      if (body.job) {
        opts.onUpdate?.(body.job);
        if (TERMINAL.has(body.job.status)) return body.job;
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
