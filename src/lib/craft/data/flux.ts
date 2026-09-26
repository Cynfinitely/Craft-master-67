/**
 * Flux resistance conversion (Runes of Aldur, 0.5).
 *
 * Blazing / Chilling / Crackling Flux transform ALL elemental resistance
 * modifiers on an item into the target element; Void Flux turns them into
 * Chaos resistance. The converted mod keeps its tier (value rerolls within
 * the tier). Crafting impact: when you target one specific resistance, any
 * elemental resistance roll is acceptable — roughly tripling the effective
 * spawn weight — with a single cheap Flux applied at the end.
 *
 * Applicability: the target set must contain at most ONE resistance type
 * among {Fire, Cold, Lightning, Chaos}; a Flux converts every elemental res
 * mod on the item, so wanting two different res types rules it out.
 */

export const ELEMENTAL_RES_GROUPS = [
  "FireResistance",
  "ColdResistance",
  "LightningResistance",
] as const;

export const CHAOS_RES_GROUP = "ChaosResistance";

const FLUX_BY_TARGET: Record<string, { apiId: string; name: string }> = {
  FireResistance: { apiId: "blazing-flux", name: "Blazing Flux" },
  ColdResistance: { apiId: "chilling-flux", name: "Chilling Flux" },
  LightningResistance: { apiId: "crackling-flux", name: "Crackling Flux" },
  [CHAOS_RES_GROUP]: { apiId: "void-flux", name: "Void Flux" },
};

export interface FluxPlan {
  /** The desired resistance group the Flux converts into. */
  targetGroup: string;
  /** Groups that count as hits because the Flux will convert them. */
  surrogateGroups: string[];
  fluxApiId: string;
  fluxName: string;
}

function isElemental(group: string): boolean {
  return (ELEMENTAL_RES_GROUPS as readonly string[]).includes(group);
}

/**
 * Decides whether a Flux conversion applies to a target mod set, and which
 * one. `groups` is every desired mod group (prefixes + suffixes).
 */
export function resolveFlux(groups: string[]): FluxPlan | null {
  const ele = groups.filter(isElemental);
  const wantsChaos = groups.includes(CHAOS_RES_GROUP);

  if (ele.length > 1) return null; // flux would merge them
  if (ele.length === 1 && wantsChaos) return null; // void flux would eat the ele res

  if (ele.length === 1) {
    const target = ele[0];
    const flux = FLUX_BY_TARGET[target];
    return {
      targetGroup: target,
      surrogateGroups: (ELEMENTAL_RES_GROUPS as readonly string[]).filter(
        (g) => g !== target,
      ),
      fluxApiId: flux.apiId,
      fluxName: flux.name,
    };
  }
  if (wantsChaos) {
    const flux = FLUX_BY_TARGET[CHAOS_RES_GROUP];
    return {
      targetGroup: CHAOS_RES_GROUP,
      // Chaos res also rolls natively; all three elemental groups convert.
      surrogateGroups: [...ELEMENTAL_RES_GROUPS],
      fluxApiId: flux.apiId,
      fluxName: flux.name,
    };
  }
  return null;
}

/** Conservative fallback prices (Exalted) when poe2scout has no quote. */
export const FLUX_FALLBACK_PRICE: Record<string, number> = {
  "blazing-flux": 2,
  "chilling-flux": 2,
  "crackling-flux": 2,
  "void-flux": 3,
};
