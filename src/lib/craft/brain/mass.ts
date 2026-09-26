import "server-only";
import type { GoalEntry } from "../goal";
import { TECHNIQUES, getTechnique } from "../techniques";
import type { MassCraftPlan } from "../types";
import { buildContext } from "./context";
import { evaluate } from "./evaluate";
import { optimize } from "./optimize";
import { loadPriceBook } from "./prices";
import { round2 } from "./present";
import { hashSeed } from "../engine/rng";

const MASS_ATTEMPTS = 5000;

/** Quantiles of Binomial(n, p) via the normal approximation with continuity correction. */
export function binomialQuantiles(n: number, p: number) {
  const mean = n * p;
  const sd = Math.sqrt(Math.max(0, n * p * (1 - p)));
  const clamp = (x: number) => Math.max(0, Math.min(n, Math.round(x)));
  return {
    p10: clamp(mean - 1.2816 * sd - 0.5),
    p50: clamp(mean),
    p90: clamp(mean + 1.2816 * sd + 0.5),
    mean,
  };
}

/**
 * One pass of a technique on each of `basesCount` bases: expected finished
 * items, their spread, and the batch cost. `techniqueId` "auto" lets the
 * brain pick the cheapest technique per finished item.
 */
export async function massCraft(input: {
  baseId: string;
  itemLevel: number;
  goal: GoalEntry[];
  techniqueId: string;
  basesCount: number;
  baseCost?: number;
}): Promise<MassCraftPlan | null> {
  const prices = await loadPriceBook();
  const built = await buildContext({ ...input, prices });
  if (!built) return null;
  const { ctx } = built;
  const baseCost = Math.max(0, input.baseCost ?? 0);
  const n = Math.max(1, Math.min(10000, Math.round(input.basesCount)));
  const warnings = [...built.warnings];

  const tech = input.techniqueId === "auto" ? null : getTechnique(input.techniqueId);
  if (input.techniqueId !== "auto" && !tech) warnings.push(`Unknown technique "${input.techniqueId}".`);

  const seedKey = `mass|${input.baseId}|${input.itemLevel}|${input.goal.map((g) => g.group).join(",")}`;
  const best = built.feasible
    ? optimize(ctx, tech ? [tech] : TECHNIQUES, { baseCost, seedKey, budgetMs: 800 }).ranked[0]
    : undefined;
  if (built.feasible && !best) {
    warnings.push(tech ? `${tech.name} doesn't reach this goal.` : "No technique reaches this goal.");
  }
  if (!best) return null;

  const stats = evaluate(best.tech, best.choice, ctx, {
    attempts: MASS_ATTEMPTS,
    seed: hashSeed(`${seedKey}|${best.tech.id}|${best.key}|mass`),
    baseCost,
  });
  const currencyPerBase = [...stats.currencyPerAttempt.entries()]
    .map(([apiId, per]) => ({
      apiId,
      name: prices.name(apiId),
      perItem: round2(per),
      unitPriceExalted: round2(prices.price(apiId)),
    }))
    .sort((a, b) => b.perItem * b.unitPriceExalted - a.perItem * a.unitPriceExalted);
  const currencyCost = stats.meanAttemptCost - baseCost;
  const total = n * stats.meanAttemptCost;
  const hits = n * stats.p;

  return {
    baseId: built.baseId,
    baseName: ctx.baseName,
    itemClass: ctx.itemClass,
    itemLevel: ctx.itemLevel,
    basesCount: n,
    method: {
      id: `${best.tech.id}:${best.key}`,
      name: best.tech.name,
      summary: best.tech.summary,
      options: best.tech.options(best.choice, ctx),
    },
    targets: ctx.targets
      .filter((t) => !t.optional)
      .map((t) => ({ group: t.group, label: ctx.labels.get(t.group) ?? t.group, side: t.side, minLevel: t.minLevel })),
    hitRate: stats.p,
    partialCounts: stats.partial,
    batchHits: binomialQuantiles(n, stats.p),
    currencyPerBase,
    costs: {
      currencyPerBase: round2(currencyCost),
      basePerBase: baseCost,
      totalExalted: round2(total),
      costPerHit: hits > 0 ? round2(total / hits) : null,
    },
    warnings,
    divinePriceExalted: round2(prices.divinePriceExalted),
  };
}
