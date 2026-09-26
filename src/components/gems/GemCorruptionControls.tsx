"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveProgress, type ProgressJob } from "@/components/LiveProgress";

export interface GemScanScope {
  id: string;
  label: string;
  hint: string;
  /** Gems to re-price; null runs a full discovery scan. */
  gemTypes: string[] | null;
  at: number | null;
}

function age(at: number | null): string {
  if (!at) return "never";
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function GemCorruptionControls({
  league,
  leagues,
  activeJobId = null,
  scopes = [],
}: {
  league: string;
  leagues: { value: string; label: string }[];
  /** Resume tracking an in-flight scan after page load or deduped enqueue. */
  activeJobId?: string | null;
  scopes?: GemScanScope[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [jobId, setJobId] = useState<string | null>(activeJobId);
  const [scanning, setScanning] = useState(!!activeJobId);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState(scopes[0]?.id ?? "all");
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

  const scope = scopes.find((s) => s.id === scopeId) ?? null;
  const emptyScope = scope?.gemTypes != null && scope.gemTypes.length === 0;

  const runScan = async () => {
    if (scanning || emptyScope) return;
    setScanning(true);
    setEnqueueError(null);
    setJobId(null);
    const gemTypes = scope?.gemTypes ?? null;
    try {
      const res = await fetch("/api/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "scan:gems",
          payload: {
            league,
            scanStartedAt: Date.now(),
            ...(gemTypes ? { gemTypes, scopeKey: scope!.id } : {}),
          },
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Failed to queue scan");
      setJobId(data.id);
    } catch (err) {
      setEnqueueError(
        err instanceof Error ? err.message : "Failed to queue scan.",
      );
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          className="input sm:w-56"
          value={league}
          onChange={(e) => setParam("league", e.target.value || null)}
          aria-label="League"
          disabled={scanning}
        >
          {leagues.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {scopes.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Gems to scan">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-forge-gold/70">Scan</span>
          {scopes.map((s) => {
            const active = s.id === scopeId;
            const empty = s.gemTypes != null && s.gemTypes.length === 0;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={scanning || empty}
                onClick={() => setScopeId(s.id)}
                title={`Last priced ${age(s.at)}`}
                className={`tap inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40 ${
                  active
                    ? "border-forge-gold bg-forge-gold/15 text-forge-goldbright"
                    : "border-forge-border text-forge-gold/75 hover:border-forge-gold/50"
                }`}
              >
                <span>{s.label}</span>
                <span className="text-[10px] text-forge-gold/60">{s.hint}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary tap shrink-0 disabled:opacity-50"
          disabled={scanning || emptyScope}
          onClick={runScan}
          title="Discover and price the most profitable 21/20 corrupted gems"
        >
          {scanning
            ? "Scanning…"
            : scope?.gemTypes
              ? `Re-price ${scope.gemTypes.length} gem${scope.gemTypes.length === 1 ? "" : "s"}`
              : "Scan all gems"}
        </button>
        {!scanning ? (
          <span className="text-[11px] text-forge-gold/80" suppressHydrationWarning>
            {scope?.gemTypes
              ? `Only these gems are re-priced; the rest of the table stays. Last priced ${age(scope.at)}.`
              : "Finds gems worth corrupting to 21/20 and prices each floor. Runs in the background."}
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
          <p className="text-[10px] text-forge-gold/80">
            The table below refreshes as each gem is priced. Searches are spaced
            out to stay inside the trade site&apos;s rate limits.
          </p>
        </div>
      ) : null}

      {enqueueError ? (
        <p className="text-xs text-forge-rust">{enqueueError}</p>
      ) : null}
    </div>
  );
}
