"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { LiveProgress } from "@/components/LiveProgress";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";
import { ToolbarGroup } from "@/components/ui/ToolbarGroup";
import { oppsProgressId } from "@/lib/progressId";

export function OpportunityControls({
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
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const itemClass = params.get("class") ?? "";
  const baseId = params.get("base") ?? "";
  const ilvl = params.get("ilvl") ?? "82";
  const view = params.get("view") ?? "crafts";
  const isRunning = params.get("run") === "1";

  const push = (
    updates: Record<string, string | null>,
    options?: { triggerBuild?: boolean },
  ) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const nextClass = next.get("class");
    const nextView = next.get("view") ?? "crafts";
    const willBuild =
      options?.triggerBuild ||
      (next.get("run") === "1" && !!nextClass && nextView === "crafts");
    setJobId(
      willBuild
        ? oppsProgressId(
            league,
            nextClass!,
            next.get("ilvl") ?? "82",
            next.get("base"),
          )
        : null,
    );
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  const rank = () => {
    if (!itemClass) return;
    push({ run: "1" }, { triggerBuild: true });
  };

  const deepScan = async () => {
    if (!itemClass || scanning) return;
    setScanning(true);
    setScanMessage(null);
    const id = oppsProgressId(league, itemClass, ilvl, baseId || undefined);
    setJobId(id);
    try {
      const res = await fetch("/api/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "scan:class",
          payload: {
            league,
            itemClass,
            itemLevel: Number.parseInt(ilvl, 10) || 82,
          },
          id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to enqueue scan");
      if (data.id) setJobId(data.id);
      setScanMessage("Deep scan queued. Progress stays here and on Runs.");
    } catch (err) {
      setScanMessage(
        err instanceof Error ? err.message : "Failed to enqueue scan.",
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-3">
      <ToolbarGroup className="w-full">
        <select
          className="input min-w-0 flex-1 md:max-w-xs"
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
            className="input min-w-0 flex-1 md:max-w-xs"
            value={baseId}
            onChange={(e) => push({ base: e.target.value || null, run: null })}
            title="Pin the search to one base, or let the planner pick the best base per combo"
          >
            <option value="">Any base (auto-pick best)</option>
            {bases.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="text-xs text-forge-gold/80">iLvl</label>
          <input
            type="number"
            min={1}
            max={100}
            className="input w-16 text-center"
            defaultValue={ilvl}
            key={ilvl}
            onBlur={(e) =>
              push({ ilvl: e.target.value || "82", run: null })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter")
                push({
                  ilvl: (e.target as HTMLInputElement).value || "82",
                  run: null,
                });
            }}
          />
        </div>
        <span className="text-xs text-forge-gold/80">league: {league}</span>
      </ToolbarGroup>

      {view === "crafts" ? (
        <ToolbarGroup>
          <ActionWithInfo
            label="Rank live (quick)"
            summary="Builds profit-ranked craft opportunities now from existing market data."
            detail={[
              "Uses samples and probes already stored from the Market page.",
              "Runs Monte Carlo + planner for up to ~6 combos per build.",
              "Results appear immediately but are not persisted after refresh.",
              "Best when Market data is fresh — no new tier enumeration.",
            ]}
          >
            <button
              type="button"
              className="btn btn-primary disabled:opacity-50 max-sm:w-full"
              disabled={!itemClass || isPending}
              onClick={rank}
            >
              {isPending && isRunning ? "Ranking…" : "Rank live (quick)"}
            </button>
          </ActionWithInfo>
          <ActionWithInfo
            label="Deep scan"
            summary="Queues a thorough background scan with tier combos and stored rankings."
            detail={[
              "Enqueues a scan:class job via the durable worker queue.",
              "Enqueues a scan:class job. The worker runs it under the trade rate limit.",
              "Probes up to ~30 tier-aware combos and simulates up to ~20.",
              "Writes market_scan_results — page loads rankings instantly later.",
            ]}
          >
            <button
              type="button"
              className="btn disabled:opacity-50 max-sm:w-full"
              disabled={!itemClass || scanning}
              onClick={deepScan}
            >
              {scanning ? "Queueing…" : "Deep scan"}
            </button>
          </ActionWithInfo>
        </ToolbarGroup>
      ) : null}

      <LiveProgress jobId={jobId} active={isPending || scanning} showLog={3} />
      {scanMessage ? (
        <p className="text-xs text-forge-gold/80">{scanMessage}</p>
      ) : null}
    </div>
  );
}
