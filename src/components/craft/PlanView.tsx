import Link from "next/link";
import type { CraftMethod, CraftPlan } from "@/lib/solver/types";
import { formatCost } from "@/lib/pricing/format";
import { SavePlanButton } from "./SavePlanButton";

function oddsLabel(odds?: number): string {
  if (odds === undefined) return "";
  if (odds >= 1) return "guaranteed";
  if (odds <= 0) return "not possible";
  const pct = odds * 100;
  if (pct < 0.1) return "<0.1%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
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
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-forge-goldbright">
            {rank === 0 ? (
              <span className="rounded bg-rarity-currency/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rarity-currency">
                cheapest
              </span>
            ) : null}
            {method.name}
          </h3>
          <p className="mt-0.5 text-sm text-forge-gold/60">{method.summary}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-forge-gold/50">est. cost</div>
          <div className="text-sm font-semibold text-rarity-currency">
            {method.costApproximate ? "~" : ""}
            {formatCost(method.estCostExalted, divinePriceExalted)}
            {method.excludesMarketPrice ? (
              <span className="text-forge-gold/50"> + base price</span>
            ) : null}
          </div>
          {method.overallOdds > 0 && method.overallOdds < 1 ? (
            <div className="mt-0.5 text-[11px] text-forge-gold/50">
              single-pass {oddsLabel(method.overallOdds)}
            </div>
          ) : null}
        </div>
      </div>

      {(method.pros.length > 0 || method.cons.length > 0) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {method.pros.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-emerald-300/80">
              {method.pros.map((p, i) => (
                <li key={i}>+ {p}</li>
              ))}
            </ul>
          ) : (
            <span />
          )}
          {method.cons.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-forge-rust/90">
              {method.cons.map((c, i) => (
                <li key={i}>− {c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <ol className="mt-3 space-y-2">
        {method.steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-forge-gold/30 text-xs font-semibold text-forge-gold">
              {s.n}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-forge-goldbright">
                  {s.title}
                </span>
                <span className="text-[11px] text-forge-gold/50">
                  {s.odds !== undefined ? oddsLabel(s.odds) : ""}
                  {s.expectedAttempts
                    ? ` · ~${s.expectedAttempts} tr${s.expectedAttempts === 1 ? "y" : "ies"}`
                    : ""}
                  {s.costExalted !== undefined
                    ? ` · ${formatCost(s.costExalted, divinePriceExalted)}`
                    : ""}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-forge-gold/60">{s.detail}</p>
              {s.currency ? (
                <Link
                  href={`/price?focus=${encodeURIComponent(s.currency)}`}
                  className="mt-1 inline-block tag-chip hover:border-forge-gold/60"
                >
                  {s.currency}
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PlanView({ plan }: { plan: CraftPlan }) {
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
            <h2 className="text-lg font-semibold text-forge-goldbright">
              {plan.baseName}
            </h2>
            <p className="text-sm text-forge-gold/60">
              {plan.desiredPrefixes.length} prefix
              {plan.desiredPrefixes.length === 1 ? "" : "es"},{" "}
              {plan.desiredSuffixes.length} suffix
              {plan.desiredSuffixes.length === 1 ? "" : "es"} · item level{" "}
              {plan.itemLevel} ·{" "}
              {plan.methods.length} method
              {plan.methods.length === 1 ? "" : "s"}
            </p>
          </div>
          <SavePlanButton plan={plan} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.desiredPrefixes.map((d) => (
            <span
              key={d.group}
              className="rounded border border-affix-prefix/40 bg-affix-prefix/10 px-2 py-0.5 text-xs text-affix-prefix"
            >
              {d.label}
              {d.tierValue ? (
                <span className="ml-1 text-affix-prefix/60">≥ {d.tierValue}</span>
              ) : null}
            </span>
          ))}
          {plan.desiredSuffixes.map((d) => (
            <span
              key={d.group}
              className="rounded border border-affix-suffix/40 bg-affix-suffix/10 px-2 py-0.5 text-xs text-affix-suffix"
            >
              {d.label}
              {d.tierValue ? (
                <span className="ml-1 text-affix-suffix/60">≥ {d.tierValue}</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {plan.methods.length === 0 ? (
        <div className="panel p-6 text-center text-forge-gold/50">
          No feasible crafting method for this selection.
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
            Crafting methods (cheapest first)
          </h3>
          {plan.methods.map((m, i) => (
            <MethodCard
              key={m.id}
              method={m}
              rank={i}
              divinePriceExalted={plan.divinePriceExalted ?? 0}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-forge-gold/40">
        Odds and costs are approximate. Costs are expected attempts × live unit
        price (with fallbacks when a price is missing) and don&apos;t capture
        every Omen, Essence tier, or fractured-affix interaction. &ldquo;~&rdquo;
        marks methods whose cost is a rough estimate (e.g. buying a base). Always
        sanity-check large crafts in-game.
      </p>
    </div>
  );
}
