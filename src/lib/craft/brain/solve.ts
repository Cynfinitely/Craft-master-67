import "server-only";
import { formatCurrentMods, formatGoalEntry, type GoalEntry } from "../goal";
import type { PriceBook } from "../engine/prices";
import { TECHNIQUES } from "../techniques";
import type { AnyTechnique } from "../techniques/types";
import type { CraftPlan, CurrentMod } from "../types";
import { ENGINE_VERSION, Lru } from "./cache";
import { buildContext } from "./context";
import { optimize } from "./optimize";
import { loadPriceBook } from "./prices";
import { round2, toCraftMethod } from "./present";

export interface SolveInput {
  baseId: string;
  itemLevel: number;
  goal: GoalEntry[];
  /** Cost of one base (or one copy of the pasted item) in Exalted. */
  baseCost?: number;
  /** Finish mode: the mods already on the item. */
  current?: CurrentMod[];
  /** Optimizer time budget. */
  budgetMs?: number;
  /** Stage-1 attempts per candidate (lower = faster, rougher). */
  stage1Attempts?: number;
  techniques?: AnyTechnique[];
  prices?: PriceBook;
}

const planCache = new Lru<Promise<CraftPlan | null>>(200);

function goalKey(input: SolveInput): string {
  return [
    input.baseId,
    input.itemLevel,
    input.goal.map(formatGoalEntry).sort().join(","),
    input.current ? formatCurrentMods(input.current) : "",
    input.baseCost ?? 0,
    input.stage1Attempts ?? "",
  ].join("|");
}

/** Ranks every applicable technique (with its best options) for a goal on one base. */
export async function solve(input: SolveInput): Promise<CraftPlan | null> {
  const prices = input.prices ?? (await loadPriceBook());
  const cacheable = !input.techniques && !input.prices;
  const key = `${goalKey(input)}|${prices.fetchedAt}|${ENGINE_VERSION}`;
  if (cacheable) {
    const hit = planCache.get(key);
    if (hit) return hit;
  }
  const p = runSolve(input, prices);
  if (cacheable) {
    planCache.set(key, p);
    p.catch(() => undefined);
  }
  return p;
}

async function runSolve(input: SolveInput, prices: PriceBook): Promise<CraftPlan | null> {
  const built = await buildContext({
    baseId: input.baseId,
    itemLevel: input.itemLevel,
    goal: input.goal,
    prices,
    current: input.current,
  });
  if (!built) return null;
  const { ctx } = built;
  const baseCost = Math.max(0, input.baseCost ?? 0);
  const warnings = [...built.warnings];
  const notes = [...built.notes];

  let methods: CraftPlan["methods"] = [];
  let evaluated = 0;
  let rejected: CraftPlan["rejected"] = [];
  if (built.feasible) {
    const result = optimize(ctx, input.techniques ?? TECHNIQUES, {
      baseCost,
      seedKey: goalKey(input),
      budgetMs: input.budgetMs,
      stage1Attempts: input.stage1Attempts,
    });
    evaluated = result.evaluated;
    rejected = result.rejected;
    methods = result.ranked.map((r) => toCraftMethod(r, ctx, baseCost));
    if (!methods.length) {
      warnings.push("No technique reached this goal in simulation. Try fewer targets or lower minimum tiers.");
    }
  }
  if (prices.fallbacksUsed.size) {
    notes.push(
      `No live price for ${[...prices.fallbacksUsed].slice(0, 6).map((id) => prices.name(id)).join(", ")}` +
        `${prices.fallbacksUsed.size > 6 ? " and more" : ""}; conservative defaults were used.`,
    );
  }

  return {
    baseId: built.baseId,
    baseName: ctx.baseName,
    itemClass: ctx.itemClass,
    itemLevel: ctx.itemLevel,
    desiredPrefixes: built.desiredPrefixes,
    desiredSuffixes: built.desiredSuffixes,
    current: input.current,
    methods,
    warnings,
    notes,
    feasible: built.feasible && methods.length > 0,
    divinePriceExalted: round2(prices.divinePriceExalted),
    baseCostExalted: baseCost,
    pricesFetchedAt: prices.fetchedAt,
    candidatesEvaluated: evaluated,
    rejected,
    engineVersion: ENGINE_VERSION,
  };
}
