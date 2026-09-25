"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveProgress,
  newProgressId,
  type ProgressJob,
} from "@/components/LiveProgress";

function formatFetched(at: number | null): string {
  if (!at) return "Prices have not been refreshed yet.";
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "Prices refreshed just now.";
  if (mins < 60) return `Prices refreshed ${mins} min ago.`;
  const hours = Math.round(mins / 60);
  return `Prices refreshed ${hours} hour${hours === 1 ? "" : "s"} ago.`;
}

function formatWait(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.ceil(sec / 60)} min`;
}

interface StatusCounts {
  confirmed: number;
  waiting: number;
  thin: number;
}

export function TabletControls({
  league,
  leagues,
  tablet,
  tablets,
  activeJobId = null,
  fetchedAt = null,
  counts = { confirmed: 0, waiting: 0, thin: 0 },
  tradeWaitMs = 0,
}: {
  league: string;
  leagues: { value: string; label: string }[];
  tablet: string;
  tablets: string[];
  activeJobId?: string | null;
  fetchedAt?: number | null;
  counts?: StatusCounts;
  tradeWaitMs?: number;
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
    refreshTimer.current = setTimeout(() => router.refresh(), 800);
  }, [router]);

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
          kind: "scan:tablets",
          payload: { league, scanStartedAt: Date.now() },
          id,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to queue scan");
      if (data.id && data.id !== id) setJobId(data.id);
    } catch (err) {
      setEnqueueError(err instanceof Error ? err.message : "Failed to queue scan.");
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
          disabled={scanning}
        >
          {leagues.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <select
          className="input sm:w-56"
          value={tablet}
          onChange={(e) => setParam("tablet", e.target.value || null)}
        >
          {tablets.map((name) => (
            <option key={name} value={name}>
              {name}
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
        >
          {scanning ? "Refreshing…" : "Refresh prices"}
        </button>
        {!scanning ? (
          <span className="text-[11px] text-forge-gold/40">{formatFetched(fetchedAt)}</span>
        ) : null}
        {tradeWaitMs > 15_000 ? (
          <span className="text-[11px] text-forge-rust/80">
            Trade limit reached — {scanning ? "continuing" : "next search"} in{" "}
            {formatWait(tradeWaitMs)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded border border-forge-gold/20 px-2 py-0.5 text-forge-goldbright">
          {counts.confirmed} confirmed
        </span>
        <span
          className="rounded border border-forge-gold/20 px-2 py-0.5 text-forge-gold/70"
          title="Combinations seen on expensive listings that still need a price check. Each refresh checks up to 20."
        >
          {counts.waiting} waiting to be checked
        </span>
        <span
          className="rounded border border-forge-gold/20 px-2 py-0.5 text-forge-gold/50"
          title="Fewer than 3 live listings, so the price is not trusted. Rechecked after 6 hours."
        >
          {counts.thin} too few listings
        </span>
      </div>
      {scanning ? (
        <LiveProgress
          jobId={jobId}
          active={scanning}
          showLog={8}
          prominent
          onComplete={() => {
            setScanning(false);
            router.refresh();
          }}
          onProgress={(_job: ProgressJob) => debouncedRefresh()}
        />
      ) : null}
      {enqueueError ? <p className="text-xs text-forge-rust">{enqueueError}</p> : null}
    </div>
  );
}
