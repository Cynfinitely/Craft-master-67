/**
 * In-memory live-progress registry for long-running actions (probing,
 * sampling, snipe scans, opportunity builds). Actions report step-by-step
 * updates under a job id; the client polls `/api/progress?id=...` and shows
 * what is actually happening instead of a frozen "...ing" button.
 *
 * The store lives on `globalThis` so it survives Next.js dev HMR and is
 * shared across route handlers within the single server process.
 */

export interface ProgressEvent {
  at: number;
  text: string;
}

export interface ProgressJob {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  /** Latest one-line status. */
  message: string;
  /** Recent step log (newest last, capped). */
  log: ProgressEvent[];
  current: number | null;
  total: number | null;
  startedAt: number;
  updatedAt: number;
}

export type ProgressReporter = (
  text: string,
  opts?: { current?: number; total?: number },
) => void;

const MAX_LOG_LINES = 60;
const JOB_TTL_MS = 15 * 60 * 1000;

const store: Map<string, ProgressJob> = ((
  globalThis as { __craftProgress?: Map<string, ProgressJob> }
).__craftProgress ??= new Map());

function prune(): void {
  const now = Date.now();
  for (const [id, job] of store) {
    if (now - job.updatedAt > JOB_TTL_MS) store.delete(id);
  }
}

export function startJob(id: string, kind: string, message: string): void {
  prune();
  const now = Date.now();
  store.set(id, {
    id,
    kind,
    status: "running",
    message,
    log: [{ at: now, text: message }],
    current: null,
    total: null,
    startedAt: now,
    updatedAt: now,
  });
}

/** Reporter bound to a job id; a no-op when the job doesn't exist. */
export function reporterFor(id: string): ProgressReporter {
  return (text, opts) => {
    const job = store.get(id);
    if (!job || job.status !== "running") return;
    job.message = text;
    job.log.push({ at: Date.now(), text });
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
    if (opts?.current != null) job.current = opts.current;
    if (opts?.total != null) job.total = opts.total;
    job.updatedAt = Date.now();
  };
}

export function finishJob(id: string, message?: string): void {
  const job = store.get(id);
  if (!job) return;
  job.status = "done";
  if (message) {
    job.message = message;
    job.log.push({ at: Date.now(), text: message });
  }
  if (job.total != null) job.current = job.total;
  job.updatedAt = Date.now();
}

export function failJob(id: string, message: string): void {
  const job = store.get(id);
  if (!job) return;
  job.status = "error";
  job.message = message;
  job.log.push({ at: Date.now(), text: message });
  job.updatedAt = Date.now();
}

export function getJob(id: string): ProgressJob | null {
  prune();
  return store.get(id) ?? null;
}
