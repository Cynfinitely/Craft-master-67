import "server-only";
import { getPrices } from "@/lib/pricing/poe2scout";

/**
 * Runic Recipe EV — 0.5 "Runes of Aldur" Runeforging arbitrage.
 *
 * Each Ezomyte Remnant recipe turns runeshape runes into alloys, currency or
 * better runes. This module prices the inputs against the output and answers
 * "is forging this cheaper than buying it" (and the reverse arbitrage: which
 * recipes print money from cheap runes).
 *
 * Recipe tables curated from the 0.5 community recipe lists (Runes of Aldur).
 */

export interface RunicRecipe {
  /** poe2scout-style apiId of the output (also used for price lookups). */
  outputApiId: string;
  outputName: string;
  outputCount: number;
  category: "alloy" | "currency";
  /** Input runeshape runes (apiIds follow the `<name>-rune` convention). */
  inputs: { apiId: string; name: string }[];
}

const r = (name: string) => ({
  apiId: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-rune`,
  name: `${name} Rune`,
});

export const RUNIC_RECIPES: RunicRecipe[] = [
  /* ----- alloys ----- */
  { outputApiId: "runic-alloy", outputName: "Runic Alloy", outputCount: 1, category: "alloy", inputs: [r("Adaptive"), r("Rebirth")] },
  { outputApiId: "runic-alloy", outputName: "Runic Alloy", outputCount: 2, category: "alloy", inputs: [r("Vision"), r("Rebirth"), r("Prismatic")] },
  { outputApiId: "adaptive-alloy", outputName: "Adaptive Alloy", outputCount: 1, category: "alloy", inputs: [r("Earth"), r("Rebirth"), r("Stone")] },
  { outputApiId: "protective-alloy", outputName: "Protective Alloy", outputCount: 1, category: "alloy", inputs: [r("Sky"), r("Rebirth"), r("Bloodletting")] },
  { outputApiId: "expansive-alloy", outputName: "Expansive Alloy", outputCount: 1, category: "alloy", inputs: [r("Volcanic"), r("Rebirth"), r("Tidal")] },
  { outputApiId: "cyclonic-alloy", outputName: "Cyclonic Alloy", outputCount: 1, category: "alloy", inputs: [r("Rage"), r("Rebirth"), r("Tidal"), r("Cyclonic")] },
  { outputApiId: "prismatic-alloy", outputName: "Prismatic Alloy", outputCount: 1, category: "alloy", inputs: [r("Prismatic"), r("Rebirth"), r("Adaptive"), r("Opulent"), r("Bond")] },
  { outputApiId: "mystic-alloy", outputName: "Mystic Alloy", outputCount: 1, category: "alloy", inputs: [r("Adaptive"), r("Rebirth"), r("Time"), r("Arcane"), r("Electrocuting")] },
  { outputApiId: "sovereign-alloy", outputName: "Sovereign Alloy", outputCount: 1, category: "alloy", inputs: [r("Adaptive"), r("Rebirth"), r("Moon"), r("Toxic"), r("Power"), r("Oath")] },
  { outputApiId: "celestial-alloy", outputName: "Celestial Alloy", outputCount: 1, category: "alloy", inputs: [r("Earth"), r("Rebirth"), r("Celestial"), r("Adaptive"), r("Power"), r("Soul"), r("Cyclonic")] },
  { outputApiId: "transcendent-alloy", outputName: "Transcendent Alloy", outputCount: 1, category: "alloy", inputs: [r("Sky"), r("Rebirth"), r("Momentum"), r("Rage"), r("Power"), r("Electrocuting"), r("Death")] },
  { outputApiId: "the-runebinders-alloy", outputName: "The Runebinder's Alloy", outputCount: 1, category: "alloy", inputs: [r("Ward"), r("Rebirth"), r("Soul"), r("Cyclonic"), r("Power"), r("Lightning"), r("Bloodletting")] },
  { outputApiId: "the-runefathers-alloy", outputName: "The Runefather's Alloy", outputCount: 1, category: "alloy", inputs: [r("Ward"), r("Rebirth"), r("Time"), r("Cold"), r("Power"), r("Prismatic"), r("Moon")] },
  /* ----- currency ----- */
  { outputApiId: "exalted", outputName: "Exalted Orb", outputCount: 1, category: "currency", inputs: [r("Adaptive"), r("Protective")] },
  { outputApiId: "exalted", outputName: "Exalted Orb", outputCount: 2, category: "currency", inputs: [r("Adaptive"), r("Arcane"), r("Tidal")] },
  { outputApiId: "exalted", outputName: "Exalted Orb", outputCount: 2, category: "currency", inputs: [r("Adaptive"), r("Moon"), r("Soul"), r("Cyclonic")] },
  { outputApiId: "chaos", outputName: "Chaos Orb", outputCount: 1, category: "currency", inputs: [r("Adaptive"), r("Tidal"), r("Bloodletting")] },
  { outputApiId: "chaos", outputName: "Chaos Orb", outputCount: 2, category: "currency", inputs: [r("Adaptive"), r("Oath"), r("Fire"), r("Rebirth")] },
  { outputApiId: "regal", outputName: "Regal Orb", outputCount: 1, category: "currency", inputs: [r("Adaptive"), r("Moon")] },
  { outputApiId: "regal", outputName: "Regal Orb", outputCount: 2, category: "currency", inputs: [r("Cyclonic"), r("Celestial")] },
  { outputApiId: "alch", outputName: "Orb of Alchemy", outputCount: 1, category: "currency", inputs: [r("Adaptive"), r("Rebirth"), r("Prismatic")] },
  { outputApiId: "alch", outputName: "Orb of Alchemy", outputCount: 2, category: "currency", inputs: [r("Adaptive"), r("Moon"), r("Tidal"), r("Electrocuting")] },
  { outputApiId: "annul", outputName: "Orb of Annulment", outputCount: 2, category: "currency", inputs: [r("Cyclonic"), r("Arcane"), r("Vision"), r("Rebirth"), r("Cyclonic"), r("Lightning"), r("Power")] },
  { outputApiId: "transmutation", outputName: "Orb of Transmutation", outputCount: 2, category: "currency", inputs: [r("Prismatic"), r("Moon")] },
  { outputApiId: "augmentation", outputName: "Orb of Augmentation", outputCount: 2, category: "currency", inputs: [r("Prismatic"), r("Tidal")] },
  { outputApiId: "gemcutters-prism", outputName: "Gemcutter's Prism", outputCount: 1, category: "currency", inputs: [r("Sky"), r("Celestial")] },
  { outputApiId: "artificers-orb", outputName: "Artificer's Orb", outputCount: 3, category: "currency", inputs: [r("Stone"), r("Vision"), r("Prismatic")] },
];

/** Conservative fallbacks (exalted) when poe2scout has no live price. */
const RUNE_FALLBACK_EX = 0.5;
const OUTPUT_FALLBACK_EX: Record<string, number> = {
  // Alloys mirror the solver's FALLBACK_PRICE so both sides agree.
  "runic-alloy": 3, "adaptive-alloy": 3, "expansive-alloy": 3,
  "protective-alloy": 3, "cyclonic-alloy": 3, "mystic-alloy": 3,
  "prismatic-alloy": 3, "swift-alloy": 3, "celestial-alloy": 3,
  "sovereign-alloy": 3, "the-runebinders-alloy": 3, "the-runefathers-alloy": 3,
  "transcendent-alloy": 3,
  exalted: 1, chaos: 0.5, regal: 0.3, alch: 0.25, annul: 2,
  transmutation: 0.02, augmentation: 0.05,
  "gemcutters-prism": 1, "artificers-orb": 0.3,
};

export interface RunicRecipeEV {
  recipe: RunicRecipe;
  outputValueExalted: number;
  inputCostExalted: number;
  profitExalted: number;
  /** True when every price came from the live market (not fallbacks). */
  fullyPriced: boolean;
  verdict: "forge" | "buy" | "even";
}

/**
 * Prices every runic recipe: output market value minus input rune cost.
 * "forge" = making it beats buying it (or prints profit selling the output);
 * "buy" = the runes are worth more than the product.
 */
export async function getRunicRecipeEV(
  league?: string,
): Promise<{ league: string; recipes: RunicRecipeEV[] }> {
  let priceMap = new Map<string, number>();
  let leagueName = league ?? "Standard";
  try {
    const prices = await getPrices(league);
    priceMap = new Map(prices.items.map((i) => [i.apiId, i.priceExalted]));
    leagueName = prices.league;
  } catch {
    /* fallbacks only */
  }

  const priceOf = (apiId: string, fallback: number) => {
    const live = priceMap.get(apiId);
    return { value: live && live > 0 ? live : fallback, live: !!live && live > 0 };
  };

  const out: RunicRecipeEV[] = [];
  for (const recipe of RUNIC_RECIPES) {
    let fullyPriced = true;
    let inputCost = 0;
    for (const input of recipe.inputs) {
      const p = priceOf(input.apiId, RUNE_FALLBACK_EX);
      inputCost += p.value;
      fullyPriced &&= p.live;
    }
    const outPrice = priceOf(
      recipe.outputApiId,
      OUTPUT_FALLBACK_EX[recipe.outputApiId] ?? 1,
    );
    fullyPriced &&= outPrice.live;
    const outputValue = outPrice.value * recipe.outputCount;
    const profit = outputValue - inputCost;
    out.push({
      recipe,
      outputValueExalted: Math.round(outputValue * 100) / 100,
      inputCostExalted: Math.round(inputCost * 100) / 100,
      profitExalted: Math.round(profit * 100) / 100,
      fullyPriced,
      verdict:
        profit > 0.25 ? "forge" : profit < -0.25 ? "buy" : "even",
    });
  }
  out.sort((a, b) => b.profitExalted - a.profitExalted);
  return { league: leagueName, recipes: out };
}

/**
 * Folds Runic-Recipe production costs into a price map: when forging an
 * alloy from runes is cheaper than its market/fallback price, the alloy's
 * effective price drops to the forge cost. Lets the planner price alloy-led
 * methods at "make it yourself" rates. Mutates and returns the map.
 */
export function applyForgeCosts(
  priceMap: Map<string, number>,
): Map<string, number> {
  for (const recipe of RUNIC_RECIPES) {
    if (recipe.category !== "alloy") continue;
    let inputCost = 0;
    for (const input of recipe.inputs) {
      const live = priceMap.get(input.apiId);
      inputCost += live && live > 0 ? live : RUNE_FALLBACK_EX;
    }
    const perUnit = inputCost / recipe.outputCount;
    const current =
      priceMap.get(recipe.outputApiId) ??
      OUTPUT_FALLBACK_EX[recipe.outputApiId] ??
      Infinity;
    if (perUnit < current) priceMap.set(recipe.outputApiId, perUnit);
  }
  return priceMap;
}

/** Cheapest way to obtain one unit of an output (buy vs best forge recipe). */
export async function alloyAcquisitionCost(
  apiId: string,
  league?: string,
): Promise<{ costExalted: number; via: "buy" | "forge" } | null> {
  const { recipes } = await getRunicRecipeEV(league);
  const candidates = recipes.filter((r) => r.recipe.outputApiId === apiId);
  if (candidates.length === 0) return null;
  const buy = candidates[0].outputValueExalted / candidates[0].recipe.outputCount;
  let best: { costExalted: number; via: "buy" | "forge" } = {
    costExalted: buy,
    via: "buy",
  };
  for (const c of candidates) {
    const perUnit = c.inputCostExalted / c.recipe.outputCount;
    if (perUnit < best.costExalted) best = { costExalted: perUnit, via: "forge" };
  }
  return best;
}
