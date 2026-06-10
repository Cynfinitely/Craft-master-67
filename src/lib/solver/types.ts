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
  /** Top stat value of the targeted tier (for essence reach checks). */
  tierStatMax?: number;
  /** True when this mod only comes from desecration (Well of Souls). */
  desecrated?: boolean;
  /**
   * Alternate groups that count as hits because a Flux converts them into
   * this group at the end of the craft (e.g. any elemental res → Fire res).
   */
  fluxGroups?: string[];
  /** Flux item (apiId) that performs the conversion. */
  fluxApiId?: string;
  /** Display name of that Flux. */
  fluxName?: string;
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
  /**
   * Chance this step destroys earlier progress (e.g. an Annul/Chaos strips a
   * finished mod), forcing a restart. 0..1.
   */
  brickOdds?: number;
  /** Step number a brick on this step reverts the craft to (default 1). */
  restartFromStep?: number;
  /** External link relevant to this step (e.g. a pre-filled trade search). */
  link?: { href: string; label: string };
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
  /** Expected profit vs. the estimated market sale value, in Exalted Orbs. */
  expectedProfitExalted?: number | null;
  /** Probability a single full pass of the sequence succeeds (0..1). */
  successChancePerAttempt?: number;
  /** Probability the craft bricks (strips finished progress) on a pass, 0..1. */
  brickRisk?: number;
  /** Expected number of full attempts/items consumed to succeed once. */
  expectedItemsConsumed?: number;
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
  /** Live Divine Orb price in Exalted Orbs (for dual-currency display). */
  divinePriceExalted?: number;
  /** Estimated market sale value of the finished item (probes/samples). */
  estimatedSale?: {
    priceExalted: number;
    sampleCount: number;
    source: "probe" | "trade" | "manual" | "mixed";
  } | null;
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
