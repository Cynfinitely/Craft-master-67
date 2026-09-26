import "server-only";
import { getModPool, searchBases } from "@/lib/data/queries";
import { modLabel } from "@/lib/data/format";
import type { PriceBook } from "../engine/prices";
import type { GoalEntry } from "../goal";
import type { BaseRecommendation } from "../types";
import { loadPriceBook } from "./prices";
import { solve } from "./solve";

const SOLVE_TOP = 10;

/**
 * Ranks the bases of an item class for a goal: a cheap odds score for every
 * base, then the full brain (quick pass) on the best few.
 */
export async function recommendBases(input: {
  itemClass: string;
  itemLevel: number;
  goal: GoalEntry[];
  limit?: number;
  baseCost?: number;
  prices?: PriceBook;
}): Promise<BaseRecommendation[]> {
  const required = input.goal.filter((g) => !g.optional);
  if (!required.length) return [];
  const bases = await searchBases({ itemClass: input.itemClass, limit: 500 });

  const recs: BaseRecommendation[] = [];
  for (const b of bases) {
    const pool = await getModPool(b.id, input.itemLevel);
    if (!pool) continue;
    const weights = new Map<string, { weight: number; label: string; side: "prefix" | "suffix" }>();
    for (const m of [...pool.prefixes, ...pool.suffixes]) {
      const g = m.groups[0] ?? m.id;
      const side = m.generationType === "suffix" ? "suffix" : "prefix";
      const cur = weights.get(g);
      if (cur) cur.weight += m.weight;
      else weights.set(g, { weight: m.weight, label: modLabel(m), side });
    }
    let score = 1;
    const perGroup: BaseRecommendation["perGroup"] = [];
    const missing: string[] = [];
    for (const e of required) {
      if (e.desecrated) continue;
      const info = weights.get(e.group);
      if (!info) {
        missing.push(e.group);
        score *= 0.0001;
        continue;
      }
      const total = info.side === "prefix" ? pool.prefixTotalWeight : pool.suffixTotalWeight;
      const odds = total ? info.weight / total : 0;
      score *= odds || 0.0001;
      perGroup.push({ group: e.group, label: info.label, odds });
    }
    recs.push({
      baseId: b.id,
      baseName: b.name,
      score,
      perGroup,
      missing,
      cheapestCostExalted: null,
      cheapestMethod: null,
    });
  }

  recs.sort((a, b) => a.missing.length - b.missing.length || b.score - a.score);

  const prices = input.prices ?? (await loadPriceBook());
  const top = recs.filter((r) => r.missing.length === 0).slice(0, SOLVE_TOP);
  for (const r of top) {
    const plan = await solve({
      baseId: r.baseId,
      itemLevel: input.itemLevel,
      goal: input.goal,
      baseCost: input.baseCost,
      budgetMs: 250,
      stage1Attempts: 120,
      prices,
    });
    const best = plan?.methods[0];
    if (best) {
      r.cheapestCostExalted = best.estCostExalted;
      r.cheapestMethod = best.name;
    }
  }

  recs.sort((a, b) => {
    if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
    const ca = a.cheapestCostExalted ?? Infinity;
    const cb = b.cheapestCostExalted ?? Infinity;
    if (ca !== cb) return ca - cb;
    return b.score - a.score;
  });
  return recs.slice(0, input.limit ?? 8);
}
