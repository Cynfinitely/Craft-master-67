import type { CraftStep, DesiredMod } from "./types";

/**
 * Shared finishing/utility steps used by several craft methods: quality
 * catalysts for jewellery, a Vaal corruption finisher, and the directional
 * Essence + Crystallisation trick that makes an essence remove (and thus add to)
 * only one affix side.
 *
 * Each helper is pure and takes a `price(apiId)` function so it can be reused by
 * any method builder without pulling in the solver's internals.
 */

type Pricer = (apiId: string) => number;

function round(n: number): number {
  if (!Number.isFinite(n)) return n;
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

const JEWELLERY = new Set(["Ring", "Amulet", "Belt"]);

interface CatalystDef {
  apiId: string;
  name: string;
  /** Keywords in a desired mod label that this catalyst boosts. */
  match: RegExp;
}
// PoE2 elemental catalysts add quality that amplifies a matching mod type.
const CATALYSTS: CatalystDef[] = [
  { apiId: "xophs-catalyst", name: "Xoph's Catalyst", match: /fire|ignite|burn/i },
  { apiId: "tuls-catalyst", name: "Tul's Catalyst", match: /cold|freeze|chill/i },
  { apiId: "eshs-catalyst", name: "Esh's Catalyst", match: /lightning|shock/i },
  {
    apiId: "uul-netols-catalyst",
    name: "Uul-Netol's Catalyst",
    match: /resist|resistance|attribute|strength|dexterity|intelligence/i,
  },
];

/**
 * For jewellery, a catalyst step that adds 20% quality biased toward the
 * desired mod's type (increasing its magnitude). Returns null off-class.
 */
export function catalystStep(
  itemClass: string,
  targets: DesiredMod[],
  n: number,
  price: Pricer,
): { step: CraftStep; cost: number } | null {
  if (!JEWELLERY.has(itemClass)) return null;
  const labels = targets.map((t) => t.label).join(" ");
  const pick =
    CATALYSTS.find((c) => c.match.test(labels)) ??
    CATALYSTS.find((c) => c.apiId === "uul-netols-catalyst")!;
  // ~20 catalysts to reach 20% quality (each adds ~1%); cheap consumables.
  const qty = 20;
  const cost = qty * (price(pick.apiId) || 1);
  return {
    step: {
      n,
      title: `Catalyse quality with ${pick.name}`,
      detail: `Apply ${pick.name} to ~20% quality. On jewellery, quality from a matching catalyst raises the magnitude of the boosted modifier type (e.g. resistances/elemental), squeezing more out of the same tier.`,
      currency: pick.name,
      costExalted: round(cost),
    },
    cost,
  };
}

/**
 * Optional Vaal corruption finisher. Binary outcome (can add a socket, reroll,
 * or do nothing); add a socket first so a bad implicit can't waste the item.
 */
export function corruptionStep(n: number, price: Pricer): { step: CraftStep; cost: number } {
  const cost = price("vaal");
  return {
    step: {
      n,
      title: "Optional: Vaal Orb finish",
      detail:
        "A Vaal Orb corrupts the item for a chance at an extra socket, a bonus implicit, or a reroll. It's all-or-nothing and locks the item from further crafting — add any rune sockets you want first, and only corrupt a finished item you're willing to risk.",
      currency: "Vaal Orb",
      costExalted: round(cost),
    },
    cost,
  };
}

/**
 * Essence + directional Crystallisation: a Sinistral/Dextral Crystallisation
 * omen forces a Perfect/Corrupted essence to remove only one affix side, so the
 * essence's guaranteed mod lands on that side without touching the other.
 */
export function crystallisationStep(
  side: "prefix" | "suffix",
  essenceName: string,
  n: number,
  price: Pricer,
): { step: CraftStep; cost: number } {
  const omenApi =
    side === "prefix"
      ? "omen-of-sinistral-crystallisation"
      : "omen-of-dextral-crystallisation";
  const omenName =
    side === "prefix"
      ? "Omen of Sinistral Crystallisation"
      : "Omen of Dextral Crystallisation";
  const cost = price(omenApi);
  return {
    step: {
      n,
      title: `${essenceName} + ${omenName} (deterministic ${side} add)`,
      detail: `Set the ${omenName} active, then apply ${essenceName}: the omen forces the essence to remove only a ${side}, so its guaranteed modifier lands on the ${side} while your other side stays intact — a 100% directional add.`,
      currency: omenName,
      odds: 1,
      costExalted: round(cost),
    },
    cost,
  };
}
