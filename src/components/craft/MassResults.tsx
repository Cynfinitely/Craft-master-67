import type { MassCraftPlan } from "@/lib/craft/types";
import { formatCost } from "@/lib/pricing/format";
import { Alert } from "@/components/ui/Alert";

function pct(x: number): string {
  const p = x * 100;
  if (p === 0) return "0%";
  if (p < 0.1) return "<0.1%";
  if (p < 1) return `${p.toFixed(2)}%`;
  return `${p.toFixed(1)}%`;
}

export function MassResults({ plan }: { plan: MassCraftPlan }) {
  const div = plan.divinePriceExalted;
  const nTargets = plan.targets.length;

  return (
    <div className="space-y-4">
      {plan.warnings.length > 0 ? (
        <Alert tone="warn">
          <ul className="list-inside list-disc space-y-1">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold text-forge-goldbright">
              {plan.method.name} × {plan.basesCount} bases
            </h2>
            <p className="mt-0.5 text-sm text-forge-muted">{plan.method.summary}</p>
            {plan.method.options.length ? (
              <p className="mt-0.5 text-xs text-forge-goldbright">
                <span className="text-forge-muted">Options: </span>
                {plan.method.options.join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="w-full sm:w-auto sm:text-right">
            <div className="text-xs text-forge-muted">one attempt per base</div>
            <div className="num text-sm font-semibold text-rarity-currency">{pct(plan.hitRate)} finished / base</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="panel-inset p-3">
            <div className="text-xs text-forge-muted">Expected finished items</div>
            <div className="num mt-1 text-xl font-bold text-forge-goldbright">{plan.batchHits.mean.toFixed(1)}</div>
            <div className="num text-2xs text-forge-muted">
              p10 {plan.batchHits.p10} · p50 {plan.batchHits.p50} · p90 {plan.batchHits.p90}
            </div>
          </div>
          <div className="panel-inset p-3">
            <div className="text-xs text-forge-muted">Total spend</div>
            <div className="num mt-1 text-xl font-bold text-forge-goldbright">
              {formatCost(Math.round(plan.costs.totalExalted), div)}
            </div>
            <div className="num text-2xs text-forge-muted">
              {formatCost(plan.costs.currencyPerBase, div)} currency/base
              {plan.costs.basePerBase > 0 ? ` + ${formatCost(plan.costs.basePerBase, div)} base` : ""}
            </div>
          </div>
          <div className="panel-inset p-3">
            <div className="text-xs text-forge-muted">Cost per finished item</div>
            <div className="num mt-1 text-xl font-bold text-forge-goldbright">
              {plan.costs.costPerHit != null ? formatCost(Math.round(plan.costs.costPerHit), div) : "n/a"}
            </div>
            <div className="text-2xs text-forge-muted">
              {plan.costs.costPerHit == null ? "hit rate too low to estimate" : "batch spend / expected finished"}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="section-title">Outcome per base (required targets hit)</h3>
            <ul className="mt-2 space-y-1">
              {plan.partialCounts.map((frac, k) => {
                const label = k === nTargets ? `all ${nTargets}` : `${k} of ${nTargets}`;
                const value = Math.min(100, Math.max(0, frac * 100));
                return (
                  <li key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-forge-muted sm:w-28">{label}</span>
                    <span
                      role="progressbar"
                      aria-label={`Bases hitting ${label} targets`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(value * 10) / 10}
                      aria-valuetext={pct(frac)}
                      className="h-2 flex-1 overflow-hidden rounded bg-forge-panel2"
                    >
                      <span
                        className={`block h-full ${k === nTargets ? "bg-rarity-currency" : "bg-forge-gold/30"}`}
                        style={{ width: `${value}%` }}
                      />
                    </span>
                    <span className="num w-12 shrink-0 text-right text-forge-muted">{pct(frac)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <h3 className="section-title">Shopping list (per base / batch)</h3>
            <ul className="num mt-2 space-y-1 text-xs text-forge-muted">
              <li className="flex justify-between gap-2">
                <span className="min-w-0 break-words">
                  {plan.baseName} (white, ilvl {plan.itemLevel}+)
                </span>
                <span className="shrink-0">1 / {plan.basesCount}</span>
              </li>
              {plan.currencyPerBase.map((c) => (
                <li key={c.apiId} className="flex justify-between gap-2">
                  <span className="min-w-0 break-words">{c.name}</span>
                  <span className="shrink-0 text-right">
                    {c.perItem.toFixed(2)} / {Math.ceil(c.perItem * plan.basesCount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <p className="text-xs text-forge-muted">
        Outcomes are simulated over the real modifier pool (spawn weights, prefix/suffix slots, group exclusivity).
      </p>
    </div>
  );
}
