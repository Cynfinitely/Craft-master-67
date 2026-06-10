"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

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
    try {
      const res = await fetch("/api/market/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemClass, league }),
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
    try {
      const res = await fetch("/api/market/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemClass, league }),
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
        <button
          type="button"
          className="btn btn-primary shrink-0 disabled:opacity-50"
          disabled={!itemClass || probing || sampling}
          onClick={probe}
        >
          {probing ? "Probing combos…" : "Probe meta combos"}
        </button>
        <button
          type="button"
          className="btn shrink-0 disabled:opacity-50"
          disabled={!itemClass || sampling || probing}
          onClick={sample}
        >
          {sampling ? "Sampling trade…" : "Sample live listings"}
        </button>
        <span className="text-xs text-forge-gold/50">league: {league}</span>
      </div>
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
