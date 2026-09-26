import "server-only";
import type { CraftPlan } from "./types";
import { loadPriceBook } from "./brain/prices";
import { repriceMethod } from "./brain/present";

export { solve, type SolveInput } from "./brain/solve";
export { massCraft, binomialQuantiles } from "./brain/mass";
export { recommendBases } from "./brain/recommend";
export { getBaseGroups, getClassPool } from "./brain/classPool";
export { loadPriceBook } from "./brain/prices";
export { TECHNIQUES, techniquesFor } from "./techniques";
export * from "./goal";
export type * from "./types";

/**
 * Today's cost of each method in a saved plan, from its stored currency
 * breakdown (no re-simulation). Methods saved before the brain have no
 * breakdown and map to null.
 */
export async function repricePlan(plan: CraftPlan): Promise<Map<string, number | null>> {
  const prices = await loadPriceBook();
  return new Map(plan.methods.map((m) => [m.id, repriceMethod(m, (id) => prices.price(id))]));
}
