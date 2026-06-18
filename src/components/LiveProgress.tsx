"use client";

import { useEffect, useRef, useState } from "react";

export interface ProgressJob {
  id: string;
  kind: string;
  status: "pending" | "running" | "done" | "error";
  message: string;
  log: { at: number; text: string }[];
  current: number | null;
  total: number | null;
  startedAt: number;
  updatedAt: number;
}

/** Fresh unique job id for an action about to start. */
export function newProgressId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isInProgress(status: ProgressJob["status"]): boolean {
  return status === "pending" || status === "running";
}

function gemScanPhase(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("discover")) return "Discovery";
  if (m.includes("found") && m.includes("gems")) return "Discovery";
  if (m.includes("loading currency")) return "Setup";
  if (m.includes("rate limit") || m.includes("cooldown") || m.includes("waiting"))
    return "Rate limit";
  if (m.includes("fetching trade") || m.includes("priced") || m.includes("floor"))
    return "Pricing";
  if (m.includes("done")) return "Complete";
  return null;
}

/**
 * Live step-by-step view of a server-side job. Polls while `active`, keeps
 * the final state visible afterwards. Drop it under any action button and
 * pass the same id the action sent to its API route.
 */
export function LiveProgress({
  jobId,
  active,
  showLog = 4,
  prominent = false,
  onComplete,
  onProgress,
}: {
  jobId: string | null;
  active: boolean;
  /** How many recent log lines to show under the headline (0 = none). */
  showLog?: number;
  /** Larger progress bar and typography for long-running scans. */
  prominent?: boolean;
  onComplete?: (job: ProgressJob) => void;
  onProgress?: (job: ProgressJob) => void;
}) {
  const [job, setJob] = useState<ProgressJob | null>(null);
  const [pollError, setPollError] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatus = useRef<ProgressJob["status"] | null>(null);
  const prevCurrent = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onProgressRef = useRef(onProgress);

  onCompleteRef.current = onComplete;
  onProgressRef.current = onProgress;

  useEffect(() => {
    setJob(null);
    setPollError(false);
    prevStatus.current = null;
    prevCurrent.current = null;
    if (!jobId) return;

    let cancelled = false;
    const handleJob = (next: ProgressJob) => {
      if (cancelled) return;
      setJob(next);
      setPollError(false);

      if (
        next.current != null &&
        next.current !== prevCurrent.current &&
        isInProgress(next.status)
      ) {
        onProgressRef.current?.(next);
      }
      prevCurrent.current = next.current;

      const terminal = next.status === "done" || next.status === "error";
      if (terminal && prevStatus.current !== next.status) {
        onCompleteRef.current?.(next);
      }
      prevStatus.current = next.status;

      if (!isInProgress(next.status) && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/progress?id=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as { job: ProgressJob | null };
        if (body.job) handleJob(body.job);
        else if (!cancelled) setPollError(true);
      } catch {
        if (!cancelled) setPollError(true);
      }
    };

    poll();
    timer.current = setInterval(poll, 900);
    return () => {
      cancelled = true;
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [jobId]);

  useEffect(() => {
    if (!active && timer.current && job && !isInProgress(job.status)) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [active, job]);

  if (!jobId) return null;

  const shell = prominent
    ? "rounded-lg border border-amber-400/25 bg-forge-panel2/50 px-4 py-3 text-sm"
    : "rounded border border-forge-border bg-forge-panel2/40 px-3 py-2 text-xs";

  if (!job) {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="text-forge-gold/85">Connecting to scan…</span>
        </div>
        {pollError ? (
          <p className="mt-2 text-[11px] text-forge-gold/45">
            Waiting for job status — if this persists, refresh the page.
          </p>
        ) : null}
      </div>
    );
  }

  const pct =
    job.total != null && job.total > 0 && job.current != null
      ? Math.min(100, Math.round((job.current / job.total) * 100))
      : null;
  const elapsed = Math.max(
    0,
    Math.round((Date.now() - job.startedAt) / 1000),
  );
  const recent =
    showLog > 0 ? job.log.slice(-1 - showLog, -1).slice(-showLog) : [];
  const stillWorking =
    job.status === "running" &&
    elapsed > 20 &&
    (pct == null || pct >= 100);
  const phase =
    job.kind === "scan:gems" ? gemScanPhase(job.message) : null;
  const counterLabel =
    job.current != null && job.total != null && job.total > 0
      ? `${job.current} / ${job.total} gems`
      : null;

  return (
    <div className={shell}>
      <div className="flex flex-wrap items-center gap-2">
        {isInProgress(job.status) ? (
          <span
            className={`${prominent ? "h-2.5 w-2.5" : "h-2 w-2"} shrink-0 animate-pulse rounded-full bg-amber-400`}
          />
        ) : job.status === "done" ? (
          <span
            className={`${prominent ? "h-2.5 w-2.5" : "h-2 w-2"} shrink-0 rounded-full bg-emerald-400`}
          />
        ) : (
          <span
            className={`${prominent ? "h-2.5 w-2.5" : "h-2 w-2"} shrink-0 rounded-full bg-red-400`}
          />
        )}
        {phase ? (
          <span className="rounded bg-forge-panel px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-affix-suffix">
            {phase}
          </span>
        ) : null}
        <span
          className={`min-w-0 flex-1 ${
            prominent ? "text-sm font-medium" : ""
          } ${
            job.status === "error"
              ? "text-forge-rust"
              : "text-forge-goldbright"
          }`}
        >
          {job.message}
        </span>
        <span className="ml-auto shrink-0 text-forge-gold/45">
          {pct != null ? `${pct}% · ` : ""}
          {elapsed}s
        </span>
      </div>

      {counterLabel ? (
        <p className="mt-1.5 text-[11px] font-medium text-forge-gold/55">
          Progress: {counterLabel}
        </p>
      ) : null}

      {pct != null ? (
        <div
          className={`mt-2 overflow-hidden rounded bg-forge-panel2 ${
            prominent ? "h-2" : "h-1"
          }`}
        >
          <div
            className={`h-full transition-all duration-500 ${
              job.status === "error"
                ? "bg-red-400/70"
                : stillWorking
                  ? "animate-pulse bg-amber-400/50"
                  : "bg-amber-400/80"
            }`}
            style={{
              width: stillWorking ? "100%" : `${pct}%`,
            }}
          />
        </div>
      ) : isInProgress(job.status) ? (
        <div
          className={`mt-2 overflow-hidden rounded bg-forge-panel2 ${
            prominent ? "h-2" : "h-1"
          }`}
        >
          <div className="h-full w-1/3 animate-pulse bg-amber-400/40" />
        </div>
      ) : null}

      {stillWorking ? (
        <p className="mt-2 text-[11px] text-forge-gold/45">
          Waiting on the PoE2 trade API (rate-limited, ~5–15s per gem). This is
          normal — not stuck.
        </p>
      ) : null}

      {recent.length > 0 ? (
        <div
          className={`mt-3 space-y-1 border-t border-forge-border/50 pt-2 ${
            prominent ? "max-h-40 overflow-y-auto" : ""
          }`}
        >
          <p className="text-[10px] uppercase tracking-wide text-forge-gold/35">
            Recent steps
          </p>
          {recent.map((e, i) => (
            <p
              key={`${e.at}-${i}`}
              className="truncate text-[11px] text-forge-gold/50"
            >
              {e.text}
            </p>
          ))}
        </div>
      ) : null}

      {job.status === "done" ? (
        <p className="mt-2 text-[11px] text-emerald-400/90">
          Scan complete — table updated below.
        </p>
      ) : null}
    </div>
  );
}
