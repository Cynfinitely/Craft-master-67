/** A single tier of a modifier group. */
export interface ModTier {
  /** Required item/mod level for this tier. */
  level: number;
  /** Display value, e.g. "+(30-40) to maximum Life" or "5 to 8". */
  value: string;
  /** Spawn weight of this individual tier. */
  weight: number;
}

export interface DesiredMod {
  group: string;
  label: string;
  generationType: "prefix" | "suffix";
  /** Combined spawn weight of the group on the target base. */
  weight: number;
  /** Fresh odds of rolling this group from a full open pool of its type. */
  oddsFresh: number;
  /** If the user targets a specific tier, its minimum required level. */
  tierLevel?: number;
  /** Display value of the targeted tier. */
  tierValue?: string;
}

export interface CraftStep {
  n: number;
  title: string;
  detail: string;
  /** Primary currency/material used in this step (display name). */
  currency?: string;
  /** Probability of success for this step (0..1), if probabilistic. */
  odds?: number;
  /** Expected number of attempts ~ 1/odds. */
  expectedAttempts?: number;
  /** Estimated cost contributed by this step, in Exalted Orbs. */
  costExalted?: number;
}

/** A distinct strategy for reaching the desired mods on a base. */
export interface CraftMethod {
  id: string;
  name: string;
  /** One-line summary of how the method works. */
  summary: string;
  steps: CraftStep[];
  feasible: boolean;
  /** Rough probability that a single pass lands all targeted mods. */
  overallOdds: number;
  /** Estimated total cost in Exalted Orbs (expected attempts x unit price). */
  estCostExalted: number | null;
  /** True when the cost is a rough/approximate estimate (e.g. RNG modeling). */
  costApproximate: boolean;
  /** True when the estimate omits an unknown market price (e.g. buying a base). */
  excludesMarketPrice?: boolean;
  pros: string[];
  cons: string[];
}

export interface CraftPlan {
  baseId: string;
  baseName: string;
  itemClass: string;
  itemLevel: number;
  desiredPrefixes: DesiredMod[];
  desiredSuffixes: DesiredMod[];
  /** Cost-ranked alternative strategies (cheapest feasible first). */
  methods: CraftMethod[];
  warnings: string[];
  feasible: boolean;
  /** Mirror of the cheapest feasible method's steps (legacy/back-compat). */
  steps: CraftStep[];
  /** Mirror of the cheapest feasible method's overall odds. */
  overallOdds: number;
}

export interface GroupChoice {
  group: string;
  label: string;
  generationType: "prefix" | "suffix";
  weight: number;
  /** Tiers available for this group on the base/class, best (highest) first. */
  tiers: ModTier[];
  /** Notable descriptive tags (attack, caster, fire, life…). */
  tags: string[];
}

export interface ClassPool {
  itemClass: string;
  itemLevel: number;
  prefixes: GroupChoice[];
  suffixes: GroupChoice[];
}

export interface BaseRecommendation {
  baseId: string;
  baseName: string;
  /** Higher score = the desired set is easier to hit on this base. */
  score: number;
  perGroup: { group: string; label: string; odds: number }[];
  missing: string[];
  /** Estimated cost of the cheapest feasible method on this base (Exalted). */
  cheapestCostExalted: number | null;
  /** Name of that cheapest method. */
  cheapestMethod: string | null;
}
