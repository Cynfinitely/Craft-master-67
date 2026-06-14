import Link from "next/link";
import { formatCost } from "@/lib/pricing/format";
import type { Opportunity } from "@/lib/market/opportunities";
import type { RankMode } from "@/lib/market/profitEngine";

export function OpportunityList({
  opportunities,
  divinePrice,
  itemLevel,
  rankMode,
}: {
  opportunities: Opportunity[];
  divinePrice: number;
  itemLevel: number;
  rankMode: RankMode;
}) {
  if (opportunities.length === 0) return null;

  return (
    <div className="space-y-3">
      {opportunities.map((o, rank) => (
        <div key={o.key} className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-forge-gold/30 text-xs font-semibold text-forge-gold">
                  {rank + 1}
                </span>
                <span className="font-semibold text-forge-goldbright">
                  {o.baseName}
                </span>
                <span className="text-xs text-forge-gold/50">
                  iLvl {itemLevel} · {o.methodName}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    o.confidence === "high"
                      ? "bg-emerald-900/50 text-emerald-300"
                      : o.confidence === "medium"
                        ? "bg-amber-900/40 text-amber-300"
                        : "bg-forge-panel2 text-forge-gold/50"
                  }`}
                >
                  {o.confidence} confidence
                </span>
                {o.saturated ? (
                  <span className="rounded bg-forge-rust/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-forge-rust">
                    saturated market
                  </span>
                ) : null}
                {o.rareCombo ? (
                  <span className="rounded bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                    rare combo · 0 listed
                  </span>
                ) : null}
                {o.craftModel === "keys-fillers" ? (
                  <span className="rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                    keys + fillers
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {o.labels.map((label, i) => (
                  <span
                    key={`${o.key}-${i}`}
                    className="rounded border border-forge-border bg-forge-panel2/60 px-1.5 py-0.5 text-xs text-forge-gold/85"
                  >
                    {label}
                  </span>
                ))}
              </div>
              {o.craftModel === "keys-fillers" ? (
                <p className="mt-1.5 text-[11px] text-sky-300/80">
                  keys{o.essenceName ? ` (${o.essenceName} locks one)` : ""}:{" "}
                  {o.keyLabels.join(", ")} — sellable (≤1 filler short){" "}
                  {Math.round(o.sellableRate * 1000) / 10}% per base
                </p>
              ) : null}
              <p className="mt-1.5 text-[11px] text-forge-gold/45">
                {Math.round(o.hitRate * 1000) / 10}% full-combo · batch of{" "}
                {o.basesCount} ~{formatCost(o.totalCostExalted, divinePrice)}
                {o.nearMissResaleExalted > 0
                  ? ` · near-misses ~${formatCost(o.nearMissResaleExalted, divinePrice)}`
                  : ""}
              </p>
              <p className="mt-0.5 text-[11px] text-forge-gold/45">
                sale {formatCost(o.saleExalted, divinePrice)}
                {o.adjustedSaleExalted < o.saleExalted ? (
                  <>
                    {" "}
                    (~{formatCost(o.adjustedSaleExalted, divinePrice)} after
                    undercut)
                  </>
                ) : null}
                {o.timeToSellDays != null
                  ? ` · ~${o.timeToSellDays}d to sell`
                  : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div
                className={`text-lg font-bold ${
                  o.profitP50Exalted >= 0
                    ? "text-emerald-300"
                    : "text-forge-rust"
                }`}
              >
                {o.profitP50Exalted >= 0 ? "+" : ""}
                {formatCost(o.profitP50Exalted, divinePrice)}
              </div>
              <div className="text-[11px] text-forge-gold/55">
                {rankMode === "hour" && o.profitPerHour != null ? (
                  <>
                    <span className="text-forge-goldbright">
                      {formatCost(o.profitPerHour, divinePrice)}/hr
                    </span>
                    {" · "}
                  </>
                ) : null}
                {rankMode === "roi" ? (
                  <span className="text-forge-goldbright">
                    {o.roiPercent.toFixed(0)}% ROI ·{" "}
                  </span>
                ) : null}
                p10 {formatCost(o.profitP10Exalted, divinePrice)} · p90{" "}
                {formatCost(o.profitP90Exalted, divinePrice)}
              </div>
              <div className="mt-1.5 flex flex-col items-end gap-1">
                <Link
                  href={o.massHref}
                  className="inline-block rounded border border-forge-gold/40 px-2 py-1 text-xs text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright"
                >
                  Open mass-craft plan →
                </Link>
                <Link
                  href={o.craftHref}
                  className="text-[11px] text-forge-gold/60 underline hover:text-forge-goldbright"
                >
                  single-item plan
                </Link>
              </div>
            </div>
          </div>
        </div>
      ))}
      <p className="text-xs text-forge-gold/40">
        Profit uses sellable-rate EV × velocity-adjusted asks + near-miss
        resale − batch cost. Toggle rank mode above to sort by profit/hour,
        batch profit, or ROI.
      </p>
    </div>
  );
}
