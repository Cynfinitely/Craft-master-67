"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { InfoTip } from "@/components/InfoTip";
import { LiveProgress, newProgressId } from "@/components/LiveProgress";

export function MarketControls({
  classes,
  league,
}: {
  classes: { category: string; classes: string[] }[];
  league: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [sampling, setSampling] = useState(false);
  const [probing, setProbing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const itemClass = params.get("class") ?? "";

  const push = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  };

  const sample = async () => {
    if (!itemClass || sampling) return;
    setSampling(true);
    setMessage(null);
    const id = newProgressId();
    setJobId(id);
    try {
      const res = await fetch("/api/market/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemClass, league, progressId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sampling failed");
      setMessage(
        `Stored ${data.inserted} samples (${data.fetched} listings fetched, ${data.totalListings} online).`,
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sampling failed.");
    } finally {
      setSampling(false);
    }
  };

  const probe = async () => {
    if (!itemClass || probing) return;
    setProbing(true);
    setMessage(null);
    const id = newProgressId();
    setJobId(id);
    try {
      const res = await fetch("/api/market/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemClass, league, progressId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Probing failed");
      setMessage(
        `Refreshed ${data.refreshed} of ${data.candidates} candidate combos (${data.probeCount} stored).`,
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Probing failed.");
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          className="input"
          value={itemClass}
          onChange={(e) => push({ class: e.target.value || null })}
        >
          <option value="">Choose an item class…</option>
          {classes.map((cat) => (
            <optgroup key={cat.category} label={cat.category}>
              {cat.classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="btn btn-primary disabled:opacity-50"
            disabled={!itemClass || probing || sampling}
            onClick={probe}
          >
            {probing ? "Probing combos…" : "Probe meta combos"}
          </button>
          <InfoTip
            label="Probe meta combos"
            summary="Runs targeted trade searches for known high-value mod combinations."
            detail={[
              "Uses meta templates and prior sample hits as candidates.",
              "Refreshes up to 6 stale probes per run (rate-limited).",
              "Gives exact listing count, ask price, and sell-through.",
              "Feeds Craft Opportunities with high-confidence pricing.",
            ]}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="btn disabled:opacity-50"
            disabled={!itemClass || sampling || probing}
            onClick={sample}
          >
            {sampling ? "Sampling trade…" : "Sample live listings"}
          </button>
          <InfoTip
            label="Sample live listings"
            summary="Fetches ~60 random rare listings across price bands for the item class."
            detail={[
              "Discovery pass when you don't know which combos sell.",
              "Populates the combo analytics tables below.",
              "Finds unexpected profitable mod pairs.",
              "Less precise than probes, but broader coverage.",
            ]}
          />
        </div>
        <span className="text-xs text-forge-gold/50">league: {league}</span>
      </div>
      <LiveProgress jobId={jobId} active={probing || sampling} />
      {message ? (
        <p className="text-xs text-forge-gold/60">{message}</p>
      ) : null}
      <p className="text-[11px] text-forge-gold/40">
        <span className="text-forge-gold/60">Probing</span> runs one exact
        stat-filtered trade search per meta combo (precise supply + ask
        prices). <span className="text-forge-gold/60">Sampling</span> pulls
        ~60 random rare listings for discovery. Both are rate-limited and
        cached; re-run occasionally to keep data fresh.
      </p>
    </div>
  );
}
