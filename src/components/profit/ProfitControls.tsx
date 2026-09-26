"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { LiveProgress } from "@/components/LiveProgress";
import type { RankMode } from "@/lib/market/profitEngine";
import {
  DEFAULT_PROFIT_PREFS,
  type ProfitPrefs,
} from "@/lib/market/profitPrefs";

const TABS = [
  { id: "opportunities", label: "Opportunities" },
  { id: "market", label: "Market Data" },
  { id: "snipes", label: "Snipes" },
  { id: "manual", label: "Manual Sales" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function loadPrefs(): ProfitPrefs {
  if (typeof window === "undefined") return DEFAULT_PROFIT_PREFS;
  try {
    const raw = localStorage.getItem("profit-prefs");
    if (!raw) return DEFAULT_PROFIT_PREFS;
    return { ...DEFAULT_PROFIT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFIT_PREFS;
  }
}

export function ProfitControls({
  classes,
  bases,
  league,
}: {
  classes: { category: string; classes: string[] }[];
  bases: { id: string; name: string }[];
  league: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ProfitPrefs>(DEFAULT_PROFIT_PREFS);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const itemClass = params.get("class") ?? "";
  const baseId = params.get("base") ?? "";
  const ilvl = params.get("ilvl") ?? "82";
  const tab = (params.get("tab") ?? "opportunities") as TabId;
  const rank = (params.get("rank") ?? prefs.rankMode) as RankMode;

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if ("class" in updates || "base" in updates || "ilvl" in updates) {
        next.delete("run");
      }
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`);
      });
    },
    [params, pathname, router],
  );

  const savePrefs = (patch: Partial<ProfitPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    localStorage.setItem("profit-prefs", JSON.stringify(next));
  };

  const rankOpportunities = async () => {
    if (!itemClass || scanning || ranking) return;
    setRanking(true);
    setScanMsg(null);
    setJobId(null);
    try {
      const res = await fetch("/api/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "rank:opportunities",
          payload: {
            league,
            itemClass,
            itemLevel: Number.parseInt(ilvl, 10) || 82,
            baseId: baseId || null,
            rankMode: rank,
          },
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not queue ranking");
      setJobId(data.id);
      if (tab !== "opportunities") push({ tab: null });
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : "Could not queue ranking.");
      setRanking(false);
    }
  };

  const runScan = async () => {
    if (!itemClass || scanning) return;
    setScanning(true);
    setScanMsg(null);
    setJobId(null);
    try {
      const res = await fetch("/api/market/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemClass,
          league,
          probeBudget: 3,
          quickSample: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      if (data.id) setJobId(data.id);
      setScanMsg("Queued a market scan. Progress stays here and on Runs.");
    } catch (err) {
      setScanMsg(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          className="input"
          value={itemClass}
          onChange={(e) =>
            push({ class: e.target.value || null, base: null, run: null })
          }
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
        {itemClass ? (
          <select
            className="input"
            value={baseId}
            onChange={(e) => push({ base: e.target.value || null, run: null })}
          >
            <option value="">Any base (auto-pick)</option>
            {bases.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
        <input
          className="input w-20"
          type="number"
          min={1}
          max={100}
          value={ilvl}
          onChange={(e) => push({ ilvl: e.target.value || "82", run: null })}
          title="Item level"
        />
        <span className="text-xs text-forge-gold/80">league: {league}</span>
      </div>

      {itemClass ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary tap shrink-0 disabled:opacity-50"
            disabled={scanning || isPending}
            onClick={runScan}
            title="Quick sample pass + up to 3 probes"
          >
            {scanning ? "Queueing…" : "Scan market"}
          </button>
          <button
            type="button"
            className="btn tap shrink-0 disabled:opacity-50"
            disabled={scanning || ranking}
            onClick={rankOpportunities}
          >
            {ranking ? "Ranking…" : "Rank opportunities"}
          </button>
          <span className="text-[11px] text-forge-gold/80">
            1. Scan market → 2. Rank opportunities → 3. Browse tabs below
          </span>
        </div>
      ) : (
        <p className="text-sm text-forge-gold/80">
          Pick an item class first — nothing runs until you click Scan or Rank.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!itemClass}
            onClick={() => {
              if (!itemClass) return;
              push({ tab: t.id === "opportunities" ? null : t.id, run: null });
            }}
            className={`rounded-t border-b-2 px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              tab === t.id
                ? "border-forge-gold font-semibold text-forge-goldbright"
                : "border-transparent text-forge-gold/55 hover:text-forge-gold"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {itemClass && tab === "opportunities" ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-forge-gold/80">Rank by:</span>
          {(
            [
              ["hour", "Profit/hr"],
              ["craft", "Batch profit"],
              ["roi", "ROI %"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                savePrefs({ rankMode: mode });
                push({ rank: mode });
              }}
              className={`rounded px-2 py-0.5 ${
                rank === mode
                  ? "bg-forge-gold/20 text-forge-goldbright"
                  : "text-forge-gold/80 hover:text-forge-gold"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <LiveProgress
        jobId={jobId}
        active={ranking || scanning}
        onComplete={() => {
          setRanking(false);
          router.refresh();
        }}
      />
      {scanMsg ? <p className="text-xs text-forge-gold/80">{scanMsg}</p> : null}
    </div>
  );
}
