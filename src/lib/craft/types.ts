export type Side = "prefix" | "suffix";

/** A mod the user wants on the finished item. */
export interface Target {
  group: string;
  side: Side;
  /** Minimum modifier level of the rolled tier (0 = any tier). */
  minLevel: number;
  /** Nice-to-have: reported as a bonus, not required for success. */
  optional: boolean;
  /** Only obtainable through desecration (Well of Souls). */
  desecrated: boolean;
  /** Flux surrogates: these groups also count, a Flux converts them at the end. */
  altGroups?: string[];
}

/** A target resolved against a base, with display data. */
export interface DesiredMod {
  group: string;
  label: string;
  generationType: Side;
  /** Minimum modifier level the tier must reach (absent = any tier). */
  tierLevel?: number;
  /** Display value of the minimum tier. */
  tierValue?: string;
  optional?: boolean;
  desecrated?: boolean;
  /** P(one fresh roll of this side lands the group at the tier). */
  oddsFresh: number;
  fluxName?: string;
}

/** A mod already on an item (finish mode). */
export interface CurrentMod {
  group: string;
  side: Side;
  /** Modifier level of the rolled tier (0 when unknown). */
  level: number;
  fractured?: boolean;
  desecrated?: boolean;
}

export interface CraftStep {
  n: number;
  title: string;
  detail: string;
  /** Primary currency used in this step (display name). */
  currency?: string;
}

export interface CurrencyUse {
  apiId: string;
  name: string;
  /** Average units consumed per finished item (restarts included). */
  perItem: number;
  unitPriceExalted: number;
}

/** One ranked way of reaching the goal: a technique with its best options. */
export interface CraftMethod {
  /** Unique per technique + options, e.g. "essence-exalt:greater". */
  id: string;
  techniqueId: string;
  name: string;
  summary: string;
  steps: CraftStep[];
  feasible: boolean;
  /** Expected total cost per finished item (bases + currency), in Exalted. */
  estCostExalted: number | null;
  /** Cost after which 50% / 90% of crafts are done. */
  p50CostExalted: number | null;
  p90CostExalted: number | null;
  /** P(one attempt on one base finishes the item). */
  successChancePerAttempt: number;
  /** Expected attempts (bases consumed) until one finished item. */
  expectedItemsConsumed: number;
  /** Average currency actions per attempt. */
  avgActionsPerAttempt: number;
  /** Decisions the brain picked for this technique. */
  chosenOptions: string[];
  /** Shopping list per finished item. */
  currency: CurrencyUse[];
  /** Base cost per attempt used in the estimate. */
  baseCostExalted: number;
  /** Simulated attempts behind the numbers. */
  attemptsSimulated: number;
  /** Few successes observed: numbers are rough. */
  lowConfidence: boolean;
  /** Share of successes that also hit every optional target. */
  optionalHitRate?: number;
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
  /** Mods already on the item when finishing (finish mode only). */
  current?: CurrentMod[];
  /** Ranked cheapest-first. */
  methods: CraftMethod[];
  warnings: string[];
  notes: string[];
  feasible: boolean;
  divinePriceExalted: number;
  baseCostExalted: number;
  pricesFetchedAt: number;
  /** Technique/option candidates the brain simulated. */
  candidatesEvaluated: number;
  /** Techniques left out, with the reason (not applicable / never succeeded). */
  rejected?: { id: string; name: string; reason: string }[];
  engineVersion: number;
}

export interface GroupChoice {
  group: string;
  label: string;
  generationType: Side;
  weight: number;
  tiers: { level: number; value: string; weight: number }[];
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
  /** Product of fresh odds of the targets (pre-ranking score). */
  score: number;
  perGroup: { group: string; label: string; odds: number }[];
  missing: string[];
  cheapestCostExalted: number | null;
  cheapestMethod: string | null;
}

export interface MassCraftPlan {
  baseId: string;
  baseName: string;
  itemClass: string;
  itemLevel: number;
  basesCount: number;
  method: { id: string; name: string; summary: string; options: string[] };
  targets: { group: string; label: string; side: Side; minLevel: number }[];
  /** P(one base ends as a finished item). */
  hitRate: number;
  /** partialCounts[k] = share of bases ending with exactly k required targets. */
  partialCounts: number[];
  batchHits: { p10: number; p50: number; p90: number; mean: number };
  currencyPerBase: CurrencyUse[];
  costs: {
    currencyPerBase: number;
    basePerBase: number;
    totalExalted: number;
    costPerHit: number | null;
  };
  warnings: string[];
  divinePriceExalted: number;
}
