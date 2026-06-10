import type { EligibleMod } from "@/lib/data/types";

/**
 * Monte Carlo affix-roll simulator.
 *
 * Unlike the heuristic cost model in `solver/index.ts` (expected attempts x
 * unit price), this rolls actual items: prefix/suffix slot limits, group
 * exclusivity, per-tier spawn weights, ilvl gating, and per-method currency
 * sequences. It exists for the mass-crafting workflow: "if I buy N bases and
 * run method M on each, what do I end up with?"
 */

/* ----------------------------- pool model ----------------------------- */

export interface SimTier {
  level: number;
  weight: number;
}

export interface SimGroup {
  group: string;
  tiers: SimTier[];
}

export interface SimPool {
  prefixes: SimGroup[];
  suffixes: SimGroup[];
}

export function buildSimPool(
  prefixes: EligibleMod[],
  suffixes: EligibleMod[],
): SimPool {
  const toGroups = (mods: EligibleMod[]): SimGroup[] => {
    const map = new Map<string, SimTier[]>();
    for (const m of mods) {
      if (m.weight <= 0) continue;
      const g = m.groups[0] ?? m.id;
      const arr = map.get(g) ?? [];
      arr.push({ level: m.requiredLevel, weight: m.weight });
      map.set(g, arr);
    }
    return [...map.entries()].map(([group, tiers]) => ({
      group,
      tiers: tiers.sort((a, b) => b.level - a.level),
    }));
  };
  return { prefixes: toGroups(prefixes), suffixes: toGroups(suffixes) };
}

/* ----------------------------- item state ----------------------------- */

type Side = "prefix" | "suffix";

interface RolledMod {
  group: string;
  level: number;
  side: Side;
}

interface ItemState {
  mods: RolledMod[];
}

const MAX_PER_SIDE = 3;

function sideCount(item: ItemState, side: Side): number {
  let n = 0;
  for (const m of item.mods) if (m.side === side) n++;
  return n;
}

function hasGroup(item: ItemState, group: string): boolean {
  return item.mods.some((m) => m.group === group);
}

/**
 * Tiers of a group eligible at a minimum modifier level. When none qualify,
 * the highest tier still rolls (PoE2 fallback rule) — mirrors
 * `groupWeightAtLevel` in the heuristic solver. Exported for unit tests.
 */
export function eligibleTiers(group: SimGroup, minLevel: number): SimTier[] {
  if (minLevel <= 0) return group.tiers;
  const q = group.tiers.filter((t) => t.level >= minLevel);
  if (q.length > 0) return q;
  return group.tiers.length ? [group.tiers[0]] : [];
}

interface Candidate {
  group: string;
  side: Side;
  tiers: SimTier[];
  weight: number;
}

function openCandidates(
  pool: SimPool,
  item: ItemState,
  minLevel: number,
  forceSide?: Side,
): Candidate[] {
  const out: Candidate[] = [];
  const consider = (groups: SimGroup[], side: Side) => {
    if (forceSide && side !== forceSide) return;
    if (sideCount(item, side) >= MAX_PER_SIDE) return;
    for (const g of groups) {
      if (hasGroup(item, g.group)) continue;
      const tiers = eligibleTiers(g, minLevel);
      const weight = tiers.reduce((s, t) => s + t.weight, 0);
      if (weight > 0) out.push({ group: g.group, side, tiers, weight });
    }
  };
  consider(pool.prefixes, "prefix");
  consider(pool.suffixes, "suffix");
  return out;
}

function pickWeighted<T extends { weight: number }>(items: T[]): T | null {
  let total = 0;
  for (const i of items) total += i.weight;
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const i of items) {
    r -= i.weight;
    if (r <= 0) return i;
  }
  return items[items.length - 1] ?? null;
}

/** Adds one random mod (optionally side-forced / level-floored). */
function addRandomMod(
  pool: SimPool,
  item: ItemState,
  minLevel = 0,
  forceSide?: Side,
): boolean {
  const candidates = openCandidates(pool, item, minLevel, forceSide);
  const group = pickWeighted(candidates);
  if (!group) return false;
  const tier = pickWeighted(group.tiers);
  if (!tier) return false;
  item.mods.push({ group: group.group, level: tier.level, side: group.side });
  return true;
}

function removeRandomMod(item: ItemState): RolledMod | null {
  if (item.mods.length === 0) return null;
  const i = Math.floor(Math.random() * item.mods.length);
  return item.mods.splice(i, 1)[0];
}

/* ----------------------------- method specs ----------------------------- */

export type SimMethodId =
  | "alch-spam"
  | "alch-chaos"
  | "transmute-regal-exalt"
  | "perfect-seed"
  | "essence-exalt";

export interface SimEssenceSpec {
  /** Mod group the essence guarantees. */
  group: string;
  side: Side;
  /** Modifier level of the guaranteed tier (for tier checks). */
  level: number;
  apiId: string;
  name: string;
}

export interface SimMethodSpec {
  id: SimMethodId;
  /** Chaos budget per base for alch-chaos. */
  maxChaos?: number;
  /** Essence used by essence-exalt. */
  essence?: SimEssenceSpec;
}

export interface SimTarget {
  group: string;
  side: Side;
  /** Minimum modifier level the rolled tier must reach (0 = any). */
  minLevel: number;
  /**
   * Alternate groups that also count as hits (Flux conversion: any elemental
   * resistance can be converted to the wanted one at the same tier).
   */
  altGroups?: string[];
  /**
   * Realistic large-combo model: "key" mods (default) must ALL hit;
   * "filler" mods are a nice-to-have whitelist whose hit count is graded
   * (`gradedRates`). Nobody crafts 6 exact mods — you lock 2-3 keys and
   * accept good-enough fillers.
   */
  role?: "key" | "filler";
}

export const SIM_METHODS: { id: SimMethodId; name: string; blurb: string }[] = [
  {
    id: "alch-spam",
    name: "Alchemy spam",
    blurb: "Orb of Alchemy on each white base (4 random mods), keep the hits.",
  },
  {
    id: "alch-chaos",
    name: "Alchemy + Chaos cycles",
    blurb:
      "Alchemy each base, then Chaos-reroll a few times per base chasing the targets.",
  },
  {
    id: "transmute-regal-exalt",
    name: "Transmute → Regal → Exalt slams",
    blurb:
      "Magic ladder then blind Exalt slams to 6 mods on each base — no omens.",
  },
  {
    id: "perfect-seed",
    name: "Perfect Transmute + Augment seed",
    blurb:
      "Perfect Transmute/Augment (mod level ≥ 70) + Perfect Regal (≥ 50), then blind Exalts — every early roll is high tier.",
  },
  {
    id: "essence-exalt",
    name: "Essence + Exalt slams",
    blurb:
      "Transmute, guarantee the lead mod with an essence, then blind Exalt slams.",
  },
];

/* ----------------------------- simulation ----------------------------- */

function countTargetHits(item: ItemState, targets: SimTarget[]): number {
  let hits = 0;
  for (const t of targets) {
    const accepted = [t.group, ...(t.altGroups ?? [])];
    if (
      item.mods.some(
        (m) =>
          accepted.includes(m.group) &&
          m.side === t.side &&
          m.level >= t.minLevel,
      )
    ) {
      hits++;
    }
  }
  return hits;
}

class CurrencyTally {
  counts = new Map<string, number>();
  add(apiId: string, n = 1) {
    this.counts.set(apiId, (this.counts.get(apiId) ?? 0) + n);
  }
}

function runTrial(
  pool: SimPool,
  targets: SimTarget[],
  spec: SimMethodSpec,
  tally: CurrencyTally,
): ItemState {
  const item: ItemState = { mods: [] };

  switch (spec.id) {
    case "alch-spam": {
      tally.add("alch");
      for (let i = 0; i < 4; i++) addRandomMod(pool, item);
      break;
    }
    case "alch-chaos": {
      tally.add("alch");
      for (let i = 0; i < 4; i++) addRandomMod(pool, item);
      const budget = spec.maxChaos ?? 10;
      for (let i = 0; i < budget; i++) {
        if (countTargetHits(item, targets) === targets.length) break;
        tally.add("chaos");
        removeRandomMod(item);
        addRandomMod(pool, item);
      }
      break;
    }
    case "transmute-regal-exalt": {
      tally.add("transmutation");
      addRandomMod(pool, item);
      tally.add("augmentation");
      addRandomMod(pool, item);
      tally.add("regal");
      addRandomMod(pool, item);
      while (item.mods.length < 6) {
        tally.add("exalted");
        if (!addRandomMod(pool, item)) break;
      }
      break;
    }
    case "perfect-seed": {
      // Perfect Magic-item orbs guarantee modifier level >= 70; Perfect Regal
      // >= 50. Exalt slams afterwards are unrestricted.
      tally.add("perfect-orb-of-transmutation");
      addRandomMod(pool, item, 70);
      tally.add("perfect-orb-of-augmentation");
      addRandomMod(pool, item, 70);
      tally.add("perfect-regal-orb");
      addRandomMod(pool, item, 50);
      while (item.mods.length < 6) {
        tally.add("exalted");
        if (!addRandomMod(pool, item)) break;
      }
      break;
    }
    case "essence-exalt": {
      const ess = spec.essence;
      tally.add("transmutation");
      addRandomMod(pool, item);
      if (ess) {
        tally.add(ess.apiId);
        if (!hasGroup(item, ess.group) && sideCount(item, ess.side) < MAX_PER_SIDE) {
          item.mods.push({ group: ess.group, level: ess.level, side: ess.side });
        }
      }
      while (item.mods.length < 6) {
        tally.add("exalted");
        if (!addRandomMod(pool, item)) break;
      }
      break;
    }
  }
  return item;
}

export interface SimulationResult {
  trials: number;
  /** P(one base ends with every target mod at the required tier). */
  fullHitRate: number;
  /** partialCounts[k] = fraction of trials ending with exactly k targets. */
  partialCounts: number[];
  /** P(every key-role target hit). Equals fullHitRate when no fillers. */
  keyHitRate: number;
  /**
   * gradedRates[f] = P(all keys hit AND exactly f fillers hit). Length is
   * fillerCount + 1; sums to keyHitRate. With no fillers: [keyHitRate].
   */
  gradedRates: number[];
  /** Average currency consumed per base. */
  avgCurrency: { apiId: string; avgPerBase: number }[];
  /** Average currency cost per base in Exalted (via the price fn). */
  avgCurrencyCostExalted: number;
}

/** Simulates `trials` independent bases through the method. */
export function simulateMethod(
  pool: SimPool,
  targets: SimTarget[],
  spec: SimMethodSpec,
  opts: { trials?: number; price: (apiId: string) => number },
): SimulationResult {
  const trials = Math.max(100, Math.min(20000, opts.trials ?? 3000));
  const tally = new CurrencyTally();
  const partial = new Array<number>(targets.length + 1).fill(0);
  const keys = targets.filter((t) => (t.role ?? "key") === "key");
  const fillers = targets.filter((t) => t.role === "filler");
  const graded = new Array<number>(fillers.length + 1).fill(0);
  let full = 0;
  let keyFull = 0;

  for (let i = 0; i < trials; i++) {
    const item = runTrial(pool, targets, spec, tally);
    const keyHits = countTargetHits(item, keys);
    const fillerHits = countTargetHits(item, fillers);
    const hits = keyHits + fillerHits;
    partial[hits]++;
    if (hits === targets.length) full++;
    if (keyHits === keys.length) {
      keyFull++;
      graded[fillerHits]++;
    }
  }

  const avgCurrency = [...tally.counts.entries()]
    .map(([apiId, count]) => ({ apiId, avgPerBase: count / trials }))
    .sort((a, b) => b.avgPerBase - a.avgPerBase);
  const avgCurrencyCostExalted = avgCurrency.reduce(
    (s, c) => s + c.avgPerBase * opts.price(c.apiId),
    0,
  );

  return {
    trials,
    fullHitRate: full / trials,
    partialCounts: partial.map((n) => n / trials),
    keyHitRate: keyFull / trials,
    gradedRates: graded.map((n) => n / trials),
    avgCurrency,
    avgCurrencyCostExalted,
  };
}

/* ----------------------------- batch math ----------------------------- */

export interface BatchQuantiles {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}

/**
 * Quantiles of Binomial(n, p) — hits across a batch of n bases — via normal
 * approximation with continuity correction (exact enough for planning).
 */
export function binomialQuantiles(n: number, p: number): BatchQuantiles {
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
