"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveProgress,
  newProgressId,
  type ProgressJob,
} from "@/components/LiveProgress";

export function GemCorruptionControls({
  league,
  leagues,
  activeJobId = null,
}: {
  league: string;
  leagues: { value: string; label: string }[];
  /** Resume tracking an in-flight scan after page load or deduped enqueue. */
  activeJobId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [jobId, setJobId] = useState<string | null>(activeJobId);
  const [scanning, setScanning] = useState(!!activeJobId);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeJobId) {
      setJobId(activeJobId);
      setScanning(true);
    }
  }, [activeJobId]);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const debouncedRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      router.refresh();
    }, 800);
  }, [router]);

  const handleComplete = useCallback(
    (_job: ProgressJob) => {
      setScanning(false);
      router.refresh();
    },
    [router],
  );

  const handleProgress = useCallback(
    (_job: ProgressJob) => {
      debouncedRefresh();
    },
    [debouncedRefresh],
  );

  const runScan = async () => {
    if (scanning) return;
    setScanning(true);
    setEnqueueError(null);
    const id = newProgressId();
    setJobId(id);
    try {
      const res = await fetch("/api/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "scan:gems",
          payload: { league, scanStartedAt: Date.now() },
          id,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to queue scan");
      // Server may return an existing job id when deduping per league.
      if (data.id && data.id !== id) setJobId(data.id);
    } catch (err) {
      setEnqueueError(
        err instanceof Error ? err.message : "Failed to queue scan.",
      );
      setScanning(false);
      setJobId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          className="input sm:w-56"
          value={league}
          onChange={(e) => setParam("league", e.target.value || null)}
          title="League"
          disabled={scanning}
        >
          {leagues.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary shrink-0 disabled:opacity-50"
          disabled={scanning}
          onClick={runScan}
          title="Discover and price the most profitable 21/20 corrupted gems"
        >
          {scanning ? "Scanning…" : "Scan all gems"}
        </button>
        {!scanning ? (
          <span className="text-[11px] text-forge-gold/40">
            Finds gems worth corrupting to 21/20 and prices each floor. Runs in
            the background (~1–3 min).
          </span>
        ) : null}
      </div>

      {scanning ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-forge-gold/70">
            Live scan — {league}
          </p>
          <LiveProgress
            jobId={jobId}
            active={scanning}
            showLog={10}
            prominent
            onComplete={handleComplete}
            onProgress={handleProgress}
          />
          <p className="text-[10px] text-forge-gold/35">
            The table below refreshes as each gem is priced. Discovery runs
            first, then each candidate gets a floor query (~5–15s apart).
          </p>
        </div>
      ) : null}

      {enqueueError ? (
        <p className="text-xs text-forge-rust">{enqueueError}</p>
      ) : null}
    </div>
  );
}
