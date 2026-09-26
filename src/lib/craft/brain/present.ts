import { fluxStep } from "../techniques/helpers";
import type { CraftContext } from "../techniques/types";
import type { CraftMethod, CraftStep, CurrencyUse } from "../types";
import type { RankedMethod } from "./optimize";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Turns an optimizer result into the plan's method card. */
export function toCraftMethod(r: RankedMethod, ctx: CraftContext, baseCost: number): CraftMethod {
  const { tech, choice, stats } = r;
  const p = stats.p;
  const currency: CurrencyUse[] = [...stats.currencyPerAttempt.entries()]
    .map(([apiId, perAttempt]) => ({
      apiId,
      name: ctx.prices.name(apiId),
      perItem: round2(perAttempt / p),
      unitPriceExalted: round2(ctx.prices.price(apiId)),
    }))
    .filter((c) => c.perItem > 0)
    .sort((a, b) => b.perItem * b.unitPriceExalted - a.perItem * a.unitPriceExalted);

  const drafts = [...tech.describe(choice, ctx), ...fluxStep(ctx)];
  drafts.push({
    title: "Divine to perfect values (optional)",
    detail: "Divine Orbs reroll values within each tier. Not included in the cost.",
    currency: ctx.prices.name("divine"),
  });
  const steps: CraftStep[] = drafts.map((s, i) => ({ ...s, n: i + 1 }));

  const cons = [...tech.cons(choice, ctx)];
  if (stats.lowConfidence) {
    cons.push(`Only ${stats.successes} successes in ${stats.attempts} simulated attempts; the numbers are rough.`);
  }

  return {
    id: `${tech.id}:${r.key}`,
    techniqueId: tech.id,
    name: tech.name,
    summary: tech.summary,
    steps,
    feasible: true,
    estCostExalted: stats.expectedCost == null ? null : round2(stats.expectedCost),
    p50CostExalted: stats.p50 == null ? null : round2(stats.p50),
    p90CostExalted: stats.p90 == null ? null : round2(stats.p90),
    successChancePerAttempt: p,
    expectedItemsConsumed: p > 0 ? round2(1 / p) : 0,
    avgActionsPerAttempt: round2(stats.avgActions),
    chosenOptions: tech.options(choice, ctx),
    currency,
    baseCostExalted: baseCost,
    attemptsSimulated: stats.attempts,
    lowConfidence: stats.lowConfidence,
    optionalHitRate: ctx.targets.some((t) => t.optional) ? stats.optionalHitRate : undefined,
    pros: tech.pros(choice, ctx),
    cons,
  };
}

/**
 * Cost of a method at new prices, from its stored per-item currency list
 * (no re-simulation). Returns null for methods without a breakdown.
 */
export function repriceMethod(m: CraftMethod, price: (apiId: string) => number): number | null {
  if (!m.currency?.length || m.estCostExalted == null) return null;
  const currency = m.currency.reduce((s, c) => s + c.perItem * price(c.apiId), 0);
  return round2(currency + (m.baseCostExalted ?? 0) * (m.expectedItemsConsumed ?? 1));
}
