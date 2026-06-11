"use client";

import { useCallback, useEffect, useState } from "react";
import { LiveProgress, newProgressId } from "@/components/LiveProgress";
import { SnipeBuilder, type SpecSummary } from "./SnipeBuilder";

interface Template {
  id: string;
  name: string;
  description: string;
  source: "recipe" | "auto" | "custom";
}

interface SnipeResult {
  listingId: string;
  baseName: string;
  ilvl: number;
  priceText: string;
  buyExalted: number;
  currentLabels: string[];
  targetLabel: string;
  tierNote: string | null;
  successRate: number;
  finishCostExalted: number;
  saleExalted: number | null;
  saleSource: string | null;
  saleSamples: number;
  sellThroughPerDay: number | null;
  evExalted: number | null;
  feasible: boolean;
  warnings: string[];
  steps: { title: string; detail: string }[];
}

interface Scan {
  template: Template;
  tradeUrl: string;
  total: number;
  results: SnipeResult[];
  skipped: number;
  warnings: string[];
}

function ex(n: number | null): string {
  if (n == null) return "?";
  return `${Math.round(n * 10) / 10}ex`;
}

export function SnipePanel({
  itemClass,
  league,
}: {
  itemClass: string;
  league: string;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (reloadTick === 0) {
      setTemplates(null);
      setScan(null);
    }
    setLoadError(null);
    fetch(
      `/api/market/snipe?class=${encodeURIComponent(itemClass)}&league=${encodeURIComponent(league)}`,
    )
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) setLoadError(body.error ?? "Failed to load templates");
        else {
          setTemplates(body.templates ?? []);
          setSpecs(body.specs ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load templates");
      });
    return () => {
      cancelled = true;
    };
    // reloadTick re-fetches after spec create/delete without a full reset.
  }, [itemClass, league, reloadTick]);

  const runScan = useCallback(
    (params: { template?: string; spec?: number }) => {
      const key = params.template ?? `spec-${params.spec}`;
      setScanning(key);
      setScan(null);
      setScanError(null);
      const id = newProgressId();
      setJobId(id);
      const target = params.template
        ? `&template=${encodeURIComponent(params.template)}`
        : `&spec=${params.spec}`;
      fetch(
        `/api/market/snipe?class=${encodeURIComponent(itemClass)}&league=${encodeURIComponent(league)}${target}&progress=${encodeURIComponent(id)}`,
      )
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) setScanError(body.error ?? "Scan failed");
          else setScan(body.scan as Scan);
        })
        .catch(() => setScanError("Scan failed"))
        .finally(() => setScanning(null));
    },
    [itemClass, league],
  );

  if (loadError) {
    return <div className="panel p-6 text-sm text-forge-rust">{loadError}</div>;
  }
  if (templates === null) {
    return (
      <div className="panel p-6 text-sm text-forge-gold/50">
        Loading snipe templates…
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <SnipeBuilder
        itemClass={itemClass}
        league={league}
        specs={specs}
        scanning={scanning !== null}
        onSpecsChanged={() => setReloadTick((t) => t + 1)}
        onScan={(specId) => runScan({ spec: specId })}
      />

      {templates.length === 0 ? (
        <div className="panel p-6 text-sm text-forge-gold/50">
          No snipe templates for {itemClass} yet. Build a custom target above,
          or probe combos on the Market page — high-value probes auto-generate
          &ldquo;one mod short&rdquo; templates.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="panel flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-forge-goldbright">
                  {t.name}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    t.source === "recipe"
                      ? "bg-emerald-900/50 text-emerald-300"
                      : "bg-indigo-900/40 text-indigo-300"
                  }`}
                >
                  {t.source === "recipe" ? "known recipe" : "from probe"}
                </span>
              </div>
              <p className="flex-1 text-xs text-forge-gold/60">
                {t.description}
              </p>
              <button
                type="button"
                className="self-start rounded border border-forge-gold/40 px-2.5 py-1 text-xs text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright disabled:opacity-50"
                disabled={scanning !== null}
                onClick={() => runScan({ template: t.id })}
              >
                {scanning === t.id
                  ? "Scanning live listings…"
                  : "Scan listings"}
              </button>
            </div>
          ))}
        </div>
      )}

      <LiveProgress jobId={jobId} active={scanning !== null} showLog={5} />

      {scanError ? (
        <div className="panel p-4 text-sm text-forge-rust">{scanError}</div>
      ) : null}

      {scan ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-forge-gold/60">
            <span className="font-semibold text-forge-goldbright">
              {scan.template.name}
            </span>
            <span>
              {scan.total} matching listing{scan.total === 1 ? "" : "s"} ·{" "}
              {scan.results.length} evaluated
              {scan.skipped > 0 ? ` · ${scan.skipped} skipped` : ""}
            </span>
            <a
              href={scan.tradeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-forge-gold underline hover:text-forge-goldbright"
            >
              open on trade site →
            </a>
          </div>
          {scan.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-300/80">
              {w}
            </p>
          ))}
          {scan.results.length === 0 ? (
            <div className="panel p-6 text-sm text-forge-gold/50">
              No evaluable listings right now — try again later or raise the
              price cap.
            </div>
          ) : (
            scan.results.map((r) => (
              <div key={r.listingId} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-forge-goldbright">
                        {r.baseName}
                      </span>
                      <span className="text-xs text-forge-gold/50">
                        iLvl {r.ilvl} · buy {r.priceText} (~{ex(r.buyExalted)})
                      </span>
                      {!r.feasible ? (
                        <span className="rounded bg-forge-rust/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-forge-rust">
                          not finishable
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.currentLabels.map((label, i) => (
                        <span
                          key={i}
                          className="rounded border border-forge-border bg-forge-panel2/60 px-1.5 py-0.5 text-xs text-forge-gold/85"
                        >
                          {label}
                        </span>
                      ))}
                      <span className="rounded border border-emerald-700/60 bg-emerald-900/30 px-1.5 py-0.5 text-xs text-emerald-300">
                        + {r.targetLabel}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-forge-gold/45">
                      finish ~{ex(r.finishCostExalted)} ·{" "}
                      {Math.round(r.successRate * 1000) / 10}% success ·{" "}
                      {r.saleExalted != null
                        ? `sells ~${ex(r.saleExalted)} (${r.saleSamples} ${r.saleSource})`
                        : "no sale data — the finished combo had no priced listings"}
                      {r.sellThroughPerDay != null
                        ? ` · demand ~${r.sellThroughPerDay}/day`
                        : ""}
                    </p>
                    {r.tierNote ? (
                      <p className="mt-0.5 text-[11px] text-sky-300/70">
                        {r.tierNote}
                      </p>
                    ) : null}
                    {r.steps[0] ? (
                      <p
                        className="mt-0.5 text-[11px] text-forge-gold/45"
                        title={r.steps[0].detail}
                      >
                        {r.steps[0].title}
                      </p>
                    ) : null}
                    {r.warnings.map((w, i) => (
                      <p key={i} className="mt-0.5 text-[11px] text-amber-300/70">
                        {w}
                      </p>
                    ))}
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={`text-lg font-bold ${
                        (r.evExalted ?? -1) >= 0
                          ? "text-emerald-300"
                          : "text-forge-rust"
                      }`}
                    >
                      {r.evExalted != null
                        ? `${r.evExalted >= 0 ? "+" : ""}${ex(r.evExalted)}`
                        : "EV ?"}
                    </div>
                    <div className="text-[11px] text-forge-gold/55">
                      expected profit
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-forge-gold/40">
            EV = success% × predicted sale + miss% × half the buy price (a
            missed finish still resells) − (buy + expected finish cost). Sale
            prices are pinned to the expected tier outcome, not best-case
            rolls. Listings move fast — verify price and open slots on the
            trade site before buying.
          </p>
        </div>
      ) : null}
    </div>
  );
}
