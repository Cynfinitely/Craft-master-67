import type { MassCraftPlan } from "@/lib/solver/massCraft";
import { formatCost } from "@/lib/pricing/format";

function pct(x: number): string {
  const p = x * 100;
  if (p === 0) return "0%";
  if (p < 0.1) return "<0.1%";
  if (p < 1) return `${p.toFixed(2)}%`;
  return `${p.toFixed(1)}%`;
}

const CURRENCY_NAMES: Record<string, string> = {
  alch: "Orb of Alchemy",
  chaos: "Chaos Orb",
  exalted: "Exalted Orb",
  transmutation: "Orb of Transmutation",
  augmentation: "Orb of Augmentation",
  regal: "Regal Orb",
};

/** "essence-of-insulation" -> "Essence Of Insulation" for unmapped apiIds. */
function currencyName(apiId: string): string {
  return (
    CURRENCY_NAMES[apiId] ??
    apiId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function MassResults({ plan }: { plan: MassCraftPlan }) {
  const div = plan.divinePriceExalted;
  const profitTone = (v: number | null) =>
    v == null
      ? "text-forge-gold/50"
      : v >= 0
        ? "text-emerald-300"
        : "text-forge-rust";

  return (
    <div className="space-y-4">
      {plan.warnings.length > 0 ? (
        <div className="panel border-forge-rust/60 bg-forge-rust/10 p-4">
          <ul className="list-inside list-disc space-y-1 text-sm text-forge-goldbright/90">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-forge-goldbright">
              {plan.method.name} × {plan.basesCount} bases
            </h2>
            <p className="mt-0.5 text-sm text-forge-gold/60">{plan.method.blurb}</p>
            {plan.essence ? (
              <p className="mt-0.5 text-xs text-forge-gold/60">
                Essence used: {plan.essence.name}
              </p>
            ) : null}
            {plan.flux ? (
              <p className="mt-0.5 text-xs text-violet-300/80">
                Flux conversion: any elemental resistance counts — finish hits
                with a {plan.flux.name} (~
                {formatCost(plan.flux.pricePerHit, plan.divinePriceExalted)}{" "}
                each, included in totals).
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <div className="text-xs text-forge-gold/50">
              simulated over {plan.sim.trials.toLocaleString()} bases
            </div>
            <div className="text-sm font-semibold text-rarity-currency">
              {pct(plan.sim.fullHitRate)} hit / base
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="panel-inset p-3">
            <div className="text-xs text-forge-gold/50">Expected finished items</div>
            <div className="mt-1 text-xl font-bold text-forge-goldbright">
              {plan.batchHits.mean.toFixed(1)}
            </div>
            <div className="text-[11px] text-forge-gold/50">
              p10 {plan.batchHits.p10} · p50 {plan.batchHits.p50} · p90{" "}
              {plan.batchHits.p90}
            </div>
          </div>
          <div className="panel-inset p-3">
            <div className="text-xs text-forge-gold/50">Total spend</div>
            <div className="mt-1 text-xl font-bold text-forge-goldbright">
              {plan.costs.excludesBasePrice ? "~" : ""}
              {formatCost(Math.round(plan.costs.totalExalted), div)}
            </div>
            <div className="text-[11px] text-forge-gold/50">
              {formatCost(plan.costs.currencyPerBase, div)} currency/base
              {plan.costs.basePerBase != null
                ? ` + ${formatCost(plan.costs.basePerBase, div)} base`
                : " (base price unknown)"}
            </div>
          </div>
          <div className="panel-inset p-3">
            <div className="text-xs text-forge-gold/50">Cost per finished item</div>
            <div className="mt-1 text-xl font-bold text-forge-goldbright">
              {plan.costs.costPerHit != null
                ? formatCost(Math.round(plan.costs.costPerHit), div)
                : "n/a"}
            </div>
            <div className="text-[11px] text-forge-gold/50">
              {plan.costs.costPerHit == null
                ? "hit rate too low to estimate"
                : "expected, before listing fees"}
            </div>
          </div>
          <div className="panel-inset p-3">
            <div className="text-xs text-forge-gold/50">Expected profit</div>
            <div
              className={`mt-1 text-xl font-bold ${profitTone(plan.revenue.profitExalted)}`}
            >
              {plan.revenue.profitExalted != null
                ? `${plan.revenue.profitExalted >= 0 ? "+" : ""}${formatCost(Math.round(plan.revenue.profitExalted), div)}`
                : "unknown"}
            </div>
            <div className="text-[11px] text-forge-gold/50">
              {plan.sale
                ? `sells ~${formatCost(plan.sale.priceExalted, div)} (${plan.sale.source === "probe" ? `exact probe, ${plan.sale.sampleCount} listed` : `${plan.sale.sampleCount} samples`}) · p10 ${plan.revenue.profitP10Exalted != null ? formatCost(Math.round(plan.revenue.profitP10Exalted), div) : "?"} / p90 ${plan.revenue.profitP90Exalted != null ? formatCost(Math.round(plan.revenue.profitP90Exalted), div) : "?"}`
                : "no market data for this combo yet — probe it on the Market page"}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-forge-gold/60">
              Outcome distribution (per base)
            </h3>
            <ul className="mt-2 space-y-1">
              {plan.sim.partialCounts.map((frac, k) => (
                <li key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 text-forge-gold/60">
                    {k === plan.targets.length
                      ? `all ${plan.targets.length} target${plan.targets.length === 1 ? "" : "s"}`
                      : `${k} of ${plan.targets.length} targets`}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-forge-panel2">
                    <span
                      className={`block h-full ${k === plan.targets.length ? "bg-rarity-currency" : "bg-forge-gold/30"}`}
                      style={{ width: `${Math.min(100, frac * 100)}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-forge-gold/70">
                    {pct(frac)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-forge-gold/60">
              Shopping list (per base avg / total)
            </h3>
            <ul className="mt-2 space-y-1 text-xs text-forge-gold/75">
              {plan.baseQuote ? (
                <li className="flex justify-between gap-2">
                  <span>{plan.baseName} (white, ilvl {plan.itemLevel}+)</span>
                  <span>
                    1 / {plan.basesCount} —{" "}
                    {formatCost(plan.baseQuote.priceExalted * plan.basesCount, div)}
                  </span>
                </li>
              ) : null}
              {plan.sim.avgCurrency.map((c) => (
                <li key={c.apiId} className="flex justify-between gap-2">
                  <span>{currencyName(c.apiId)}</span>
                  <span>
                    {c.avgPerBase.toFixed(2)} /{" "}
                    {Math.ceil(c.avgPerBase * plan.basesCount)}
                  </span>
                </li>
              ))}
            </ul>
            {plan.baseQuote ? (
              <a
                href={plan.baseQuote.tradeUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block tag-chip text-rarity-currency hover:border-forge-gold/60"
              >
                Buy bases on trade ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <p className="text-xs text-forge-gold/40">
        Outcomes are Monte Carlo estimates over the real modifier pool
        (spawn weights, prefix/suffix slots, group exclusivity). Partial hits
        often retain resale value — check the Market page for what near-miss
        combos fetch. Sale estimates use listing medians (ask prices), so
        treat profit as optimistic.
      </p>
    </div>
  );
}
