import type { CraftMethod, CraftPlan, DesiredMod } from "@/lib/craft/types";
import { formatCost } from "@/lib/pricing/format";
import { SavePlanButton } from "./SavePlanButton";

function pct(p: number): string {
  if (p >= 1) return "100%";
  if (p <= 0) return "0%";
  const v = p * 100;
  if (v < 0.1) return "<0.1%";
  if (v < 1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(1)}%`;
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] ${
        tone === "warn"
          ? "bg-amber-100 text-amber-900"
          : "border border-forge-border bg-forge-panel2/60 text-forge-gold/70"
      }`}
    >
      {children}
    </span>
  );
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
          <h3 className="flex items-center gap-2 font-semibold text-forge-goldbright">
            {rank === 0 ? (
              <span className="rounded bg-rarity-currency/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rarity-currency">
                Best
              </span>
            ) : null}
            {method.name}
          </h3>
          <p className="mt-0.5 text-sm text-forge-gold/80">{method.summary}</p>
          {method.chosenOptions.length > 0 ? (
            <p className="mt-1 text-xs text-forge-goldbright/80">
              <span className="text-forge-gold/60">Brain picked: </span>
              {method.chosenOptions.join(" · ")}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip>{pct(method.successChancePerAttempt)} success per attempt</Chip>
            {method.expectedItemsConsumed > 1.05 ? (
              <Chip>~{method.expectedItemsConsumed.toFixed(1)} bases per finished item</Chip>
            ) : null}
            {method.optionalHitRate != null ? <Chip>{pct(method.optionalHitRate)} also hit the optional mods</Chip> : null}
            {method.lowConfidence ? <Chip tone="warn">low confidence</Chip> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-forge-gold/80">expected cost</div>
          <div className="text-sm font-semibold text-rarity-currency">
            {formatCost(method.estCostExalted, divinePriceExalted)}
          </div>
          {method.p50CostExalted != null && method.p90CostExalted != null ? (
            <div
              className="mt-0.5 text-[11px] text-forge-gold/80"
              title="Half of crafts finish within the first number; nine in ten within the second."
            >
              50%: {formatCost(method.p50CostExalted)} · 90%: {formatCost(method.p90CostExalted)}
            </div>
          ) : null}
        </div>
      </div>

      {(method.pros.length > 0 || method.cons.length > 0) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ul className="space-y-0.5 text-xs text-emerald-800">
            {method.pros.map((p, i) => (
              <li key={i}>+ {p}</li>
            ))}
          </ul>
          <ul className="space-y-0.5 text-xs text-forge-rust/90">
            {method.cons.map((c, i) => (
              <li key={i}>− {c}</li>
            ))}
          </ul>
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {method.steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-forge-gold/30 text-xs font-semibold text-forge-gold">
              {s.n}
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium text-forge-goldbright">{s.title}</span>
              <p className="mt-0.5 text-xs text-forge-gold/80">{s.detail}</p>
              {s.currency ? <span className="mt-1 inline-block tag-chip">{s.currency}</span> : null}
            </div>
          </li>
        ))}
      </ol>

      {method.currency.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-forge-gold/80">
            Shopping list per finished item
          </summary>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-forge-gold/60">
                <th className="py-1 font-normal">Currency</th>
                <th className="py-1 text-right font-normal">Amount</th>
                <th className="py-1 text-right font-normal">Unit</th>
                <th className="py-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {method.currency.map((c) => (
                <tr key={c.apiId} className="border-t border-forge-border/40 text-forge-gold/90">
                  <td className="py-1">{c.name}</td>
                  <td className="py-1 text-right">{c.perItem < 10 ? c.perItem.toFixed(1) : Math.round(c.perItem)}</td>
                  <td className="py-1 text-right">{formatCost(c.unitPriceExalted)}</td>
                  <td className="py-1 text-right">{formatCost(c.perItem * c.unitPriceExalted)}</td>
                </tr>
              ))}
              {method.baseCostExalted > 0 ? (
                <tr className="border-t border-forge-border/40 text-forge-gold/90">
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
          <p className="mt-1 text-[10px] text-forge-gold/60">
            Averages from {method.attemptsSimulated.toLocaleString()} simulated attempts.
          </p>
        </details>
      ) : null}
    </div>
  );
}

function TargetChip({ d }: { d: DesiredMod }) {
  const color = d.desecrated
    ? "border-forge-rust/40 bg-forge-rust/10 text-forge-rust"
    : d.generationType === "prefix"
      ? "border-affix-prefix/40 bg-affix-prefix/10 text-affix-prefix"
      : "border-affix-suffix/40 bg-affix-suffix/10 text-affix-suffix";
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${color} ${d.optional ? "border-dashed opacity-80" : ""}`}>
      {d.label}
      {d.tierValue ? <span className="ml-1 opacity-60">≥ {d.tierValue}</span> : null}
      {d.optional ? <span className="ml-1 opacity-60">(optional)</span> : null}
      {d.desecrated ? <span className="ml-1 opacity-60">(desecrated)</span> : null}
      {d.fluxName ? <span className="ml-1 opacity-60">(any element + {d.fluxName})</span> : null}
    </span>
  );
}

export function PlanView({ plan }: { plan: CraftPlan }) {
  const targets = [...plan.desiredPrefixes, ...plan.desiredSuffixes];
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-forge-goldbright">{plan.baseName}</h2>
            <p className="text-sm text-forge-gold/80">
              {plan.current ? "Finishing your item · " : ""}
              {targets.length} target{targets.length === 1 ? "" : "s"} · item level {plan.itemLevel} ·{" "}
              {plan.methods.length} technique{plan.methods.length === 1 ? "" : "s"} ranked from{" "}
              {plan.candidatesEvaluated} simulated option sets
              {plan.baseCostExalted > 0 ? ` · base ${formatCost(plan.baseCostExalted)}` : ""}
            </p>
          </div>
          <SavePlanButton plan={plan} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {targets.map((d) => (
            <TargetChip key={d.group} d={d} />
          ))}
        </div>
        {plan.notes.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-forge-gold/80">
            {plan.notes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {plan.methods.length === 0 ? (
        <div className="panel p-6 text-center text-forge-gold/80">No technique reaches this goal.</div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
            Techniques, cheapest first
          </h3>
          {plan.methods.map((m, i) => (
            <MethodCard key={m.id} method={m} rank={i} divinePriceExalted={plan.divinePriceExalted} />
          ))}
        </div>
      )}

      {plan.rejected?.length ? (
        <details className="panel p-3 text-xs text-forge-gold/80">
          <summary className="cursor-pointer font-semibold">Techniques not used ({plan.rejected.length})</summary>
          <ul className="mt-2 space-y-0.5">
            {plan.rejected.map((r) => (
              <li key={r.id}>
                <span className="text-forge-goldbright/80">{r.name}</span>: {r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-xs text-forge-gold/80">
        Costs are simulated: each technique is run thousands of times on fresh bases at current currency prices
        (conservative defaults when a price is missing), restarts included. Treat them as estimates and sanity-check
        big crafts in-game.
      </p>
    </div>
  );
}
