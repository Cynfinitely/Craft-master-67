import type { CraftMethod, CraftPlan, DesiredMod } from "@/lib/craft/types";
import { formatCost } from "@/lib/pricing/format";
import { InfoTip } from "@/components/InfoTip";
import { Alert } from "@/components/ui/Alert";
import { AffixMark, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SavePlanButton } from "./SavePlanButton";

function pct(p: number): string {
  if (p >= 1) return "100%";
  if (p <= 0) return "0%";
  const v = p * 100;
  if (v < 0.1) return "<0.1%";
  if (v < 1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(1)}%`;
}

function MethodCard({
  method,
  rank,
  divinePriceExalted,
}: {
  method: CraftMethod;
  rank: number;
  divinePriceExalted: number;
}) {
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="flex flex-wrap items-center gap-2 font-semibold text-forge-goldbright">
            {rank === 0 ? <Badge tone="accent">Best</Badge> : null}
            {method.name}
          </h4>
          <p className="mt-0.5 text-sm text-forge-muted">{method.summary}</p>
          {method.chosenOptions.length > 0 ? (
            <p className="mt-1 text-xs text-forge-goldbright">
              <span className="text-forge-muted">Brain picked: </span>
              {method.chosenOptions.join(" · ")}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge className="num">{pct(method.successChancePerAttempt)} success per attempt</Badge>
            {method.expectedItemsConsumed > 1.05 ? (
              <Badge className="num">~{method.expectedItemsConsumed.toFixed(1)} bases per finished item</Badge>
            ) : null}
            {method.optionalHitRate != null ? (
              <Badge className="num">{pct(method.optionalHitRate)} also hit the optional mods</Badge>
            ) : null}
            {method.lowConfidence ? <Badge tone="warn">low confidence</Badge> : null}
          </div>
        </div>
        <div className="w-full sm:w-auto sm:text-right">
          <div className="text-xs text-forge-muted">expected cost</div>
          <div className="num text-sm font-semibold text-rarity-currency">
            {formatCost(method.estCostExalted, divinePriceExalted)}
          </div>
          {method.p50CostExalted != null && method.p90CostExalted != null ? (
            <div className="num mt-0.5 flex items-center gap-1 text-2xs text-forge-muted sm:justify-end">
              <span>
                50%: {formatCost(method.p50CostExalted)} · 90%: {formatCost(method.p90CostExalted)}
              </span>
              <InfoTip
                label="Cost spread"
                summary="How the cost varies between crafts, restarts included."
                detail={[
                  "50%: half of crafts finish within this amount.",
                  "90%: nine in ten crafts finish within this amount.",
                ]}
              />
            </div>
          ) : null}
        </div>
      </div>

      {(method.pros.length > 0 || method.cons.length > 0) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ul className="space-y-0.5 text-xs text-success-fg" aria-label="Pros">
            {method.pros.map((p, i) => (
              <li key={i}>
                <span aria-hidden="true">+ </span>
                {p}
              </li>
            ))}
          </ul>
          <ul className="space-y-0.5 text-xs text-forge-rust-strong" aria-label="Cons">
            {method.cons.map((c, i) => (
              <li key={i}>
                <span aria-hidden="true">− </span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {method.steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <div
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-forge-gold/30 text-xs font-semibold text-forge-gold"
            >
              {s.n}
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium text-forge-goldbright">{s.title}</span>
              <p className="mt-0.5 text-xs text-forge-muted">{s.detail}</p>
              {s.currency ? <span className="mt-1 inline-block tag-chip">{s.currency}</span> : null}
            </div>
          </li>
        ))}
      </ol>

      {method.currency.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-forge-muted">
            Shopping list per finished item
          </summary>
          <div className="table-scroll">
            <table className="num mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-forge-muted">
                  <th scope="col" className="py-1 font-normal">Currency</th>
                  <th scope="col" className="py-1 text-right font-normal">Amount</th>
                  <th scope="col" className="py-1 text-right font-normal">Unit</th>
                  <th scope="col" className="py-1 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {method.currency.map((c) => (
                  <tr key={c.apiId} className="border-t border-forge-border/40 text-forge-muted">
                    <td className="py-1">{c.name}</td>
                    <td className="py-1 text-right">{c.perItem < 10 ? c.perItem.toFixed(1) : Math.round(c.perItem)}</td>
                    <td className="py-1 text-right">{formatCost(c.unitPriceExalted)}</td>
                    <td className="py-1 text-right">{formatCost(c.perItem * c.unitPriceExalted)}</td>
                  </tr>
                ))}
                {method.baseCostExalted > 0 ? (
                  <tr className="border-t border-forge-border/40 text-forge-muted">
                    <td className="py-1">Bases</td>
                    <td className="py-1 text-right">{method.expectedItemsConsumed.toFixed(1)}</td>
                    <td className="py-1 text-right">{formatCost(method.baseCostExalted)}</td>
                    <td className="py-1 text-right">
                      {formatCost(method.baseCostExalted * method.expectedItemsConsumed)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-2xs text-forge-muted">
            Averages from {method.attemptsSimulated.toLocaleString()} simulated attempts.
          </p>
        </details>
      ) : null}
    </div>
  );
}

function TargetChip({ d }: { d: DesiredMod }) {
  const color = d.desecrated
    ? "border-forge-rust/40 bg-forge-rust/10 text-forge-rust-strong"
    : d.generationType === "prefix"
      ? "border-affix-prefix/40 bg-affix-prefix/10 text-affix-prefix"
      : "border-affix-suffix/40 bg-affix-suffix/10 text-affix-suffix";
  return (
    <li className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${color} ${d.optional ? "border-dashed" : ""}`}>
      <AffixMark kind={d.generationType === "suffix" ? "suffix" : "prefix"} />
      {d.label}
      {d.tierValue ? <span className="text-forge-muted">≥ {d.tierValue}</span> : null}
      {d.optional ? <span className="text-forge-muted">(optional)</span> : null}
      {d.desecrated ? <span className="text-forge-muted">(desecrated)</span> : null}
      {d.fluxName ? <span className="text-forge-muted">(any element + {d.fluxName})</span> : null}
    </li>
  );
}

export function PlanView({ plan }: { plan: CraftPlan }) {
  const targets = [...plan.desiredPrefixes, ...plan.desiredSuffixes];
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-forge-goldbright">{plan.baseName}</h2>
            <p className="text-sm text-forge-muted">
              {plan.current ? "Finishing your item · " : ""}
              {targets.length} target{targets.length === 1 ? "" : "s"} · item level {plan.itemLevel} ·{" "}
              {plan.methods.length} technique{plan.methods.length === 1 ? "" : "s"} ranked from{" "}
              {plan.candidatesEvaluated} simulated option sets
              {plan.baseCostExalted > 0 ? ` · base ${formatCost(plan.baseCostExalted)}` : ""}
            </p>
          </div>
          <SavePlanButton plan={plan} />
        </div>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Target modifiers">
          {targets.map((d) => (
            <TargetChip key={d.group} d={d} />
          ))}
        </ul>
        {plan.notes.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-forge-muted">
            {plan.notes.map((n, i) => (
              <li key={i}>
                <span aria-hidden="true">• </span>
                {n}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {plan.methods.length === 0 ? (
        <EmptyState title="No technique reaches this goal">
          Try lower minimum tiers, fewer modifiers (or mark some optional), or a higher item level.
        </EmptyState>
      ) : (
        <section className="space-y-3" aria-labelledby="plan-techniques-heading">
          <h3 id="plan-techniques-heading" className="section-title">
            Techniques, cheapest first
          </h3>
          {plan.methods.map((m, i) => (
            <MethodCard key={m.id} method={m} rank={i} divinePriceExalted={plan.divinePriceExalted} />
          ))}
        </section>
      )}

      {plan.rejected?.length ? (
        <details className="panel p-3 text-xs text-forge-muted">
          <summary className="cursor-pointer font-semibold">Techniques not used ({plan.rejected.length})</summary>
          <ul className="mt-2 space-y-0.5">
            {plan.rejected.map((r) => (
              <li key={r.id}>
                <span className="text-forge-goldbright">{r.name}</span>: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-xs text-forge-muted">
        Costs are simulated: each technique is run thousands of times on fresh bases at current currency prices
        (conservative defaults when a price is missing), restarts included. Treat them as estimates and sanity-check
        big crafts in-game.
      </p>
    </div>
  );
}
