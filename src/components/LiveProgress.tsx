"use client";

import { useEffect, useRef, useState } from "react";

interface ProgressJob {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
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

/**
 * Live step-by-step view of a server-side job. Polls while `active`, keeps
 * the final state visible afterwards. Drop it under any action button and
 * pass the same id the action sent to its API route.
 */
export function LiveProgress({
  jobId,
  active,
  showLog = 4,
}: {
  jobId: string | null;
  active: boolean;
  /** How many recent log lines to show under the headline (0 = none). */
  showLog?: number;
}) {
  const [job, setJob] = useState<ProgressJob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setJob(null);
    if (!jobId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/progress?id=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as { job: ProgressJob | null };
        if (!cancelled && body.job) {
          setJob(body.job);
          if (body.job.status !== "running" && timer.current) {
            clearInterval(timer.current);
            timer.current = null;
          }
        }
      } catch {
        /* poll errors are non-fatal */
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

  // Keep polling stopped once the parent says the action is over.
  useEffect(() => {
    if (!active && timer.current && job && job.status !== "running") {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [active, job]);

  if (!jobId || !job) return null;

  const pct =
    job.total != null && job.total > 0 && job.current != null
      ? Math.min(100, Math.round((job.current / job.total) * 100))
      : null;
  const elapsed = Math.max(0, Math.round((job.updatedAt - job.startedAt) / 1000));
  const recent = showLog > 0 ? job.log.slice(-1 - showLog, -1).slice(-showLog) : [];

  return (
    <div className="rounded border border-forge-border bg-forge-panel2/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        {job.status === "running" ? (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
        ) : job.status === "done" ? (
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
        ) : (
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
        )}
        <span
          className={
            job.status === "error"
              ? "text-forge-rust"
              : "text-forge-gold/85"
          }
        >
          {job.message}
        </span>
        <span className="ml-auto shrink-0 text-forge-gold/40">
          {pct != null ? `${pct}% · ` : ""}
          {elapsed}s
        </span>
      </div>
      {pct != null ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-forge-panel2">
          <div
            className={`h-full transition-all ${
              job.status === "error" ? "bg-red-400/70" : "bg-amber-400/70"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {recent.length > 0 ? (
        <div className="mt-1.5 space-y-0.5 border-t border-forge-border/50 pt-1.5">
          {recent.map((e, i) => (
            <p key={`${e.at}-${i}`} className="truncate text-[11px] text-forge-gold/40">
              {e.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
