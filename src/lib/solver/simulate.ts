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
  /** Locked by a Fracturing Orb — immune to Annul/Chaos/Abyss removal. */
  fractured?: boolean;
  /** Added via desecration (Well of Souls). 0.5 caps these at 1 per item. */
  desecrated?: boolean;
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

/** Annul-style removal: random non-fractured mod, optionally side-locked. */
function removeRandomUnfractured(
  item: ItemState,
  side?: Side,
): RolledMod | null {
  const idxs: number[] = [];
  for (let i = 0; i < item.mods.length; i++) {
    const m = item.mods[i];
    if (m.fractured) continue;
    if (side && m.side !== side) continue;
    idxs.push(i);
  }
  if (idxs.length === 0) return null;
  const i = idxs[Math.floor(Math.random() * idxs.length)];
  return item.mods.splice(i, 1)[0];
}

/** Weighted sample of up to k DISTINCT groups (desecration reveal options). */
function drawDistinctGroups(groups: SimGroup[], k: number): SimGroup[] {
  const remaining = groups.map((g) => ({
    g,
    weight: g.tiers.reduce((s, t) => s + t.weight, 0),
  }));
  const out: SimGroup[] = [];
  while (out.length < k && remaining.length > 0) {
    const pick = pickWeighted(remaining);
    if (!pick) break;
    out.push(pick.g);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return out;
}

/* ----------------------------- method specs ----------------------------- */

export type SimMethodId =
  | "alch-spam"
  | "alch-chaos"
  | "transmute-regal-exalt"
  | "perfect-seed"
  | "essence-exalt"
  | "omen-exalt"
  | "essence-omen-exalt"
  | "fracture-omen-exalt"
  | "desecrate-omen-exalt";

export interface SimEssenceSpec {
  /** Mod group the essence guarantees. */
  group: string;
  side: Side;
  /** Modifier level of the guaranteed tier (for tier checks). */
  level: number;
  apiId: string;
  name: string;
}

/** Abyss desecration pipeline (Essence of the Abyss → bone → Well of Souls). */
export interface SimDesecrateSpec {
  /** Side the directional Necromancy omen forces. */
  side: Side;
  /** Desecrated mod group we want revealed. */
  targetGroup: string;
  /** Desecrated mod pool for that side on this item class. */
  groups: SimGroup[];
  /** Omen of Abyssal Echoes: reveal 5 options instead of 3. */
  useEchoes: boolean;
  boneApiId: string;
  necroApiId: string;
  /**
   * Additional omens consumed per desecration (e.g. Omen of the Sovereign,
   * which also restricts `groups` to the Ulaman pool).
   */
  extraOmenApiIds?: string[];
  /**
   * Skip the Essence of the Abyss step (the item should not lose a random
   * mod first — finisher flows desecrate directly into an OPEN slot).
   */
  skipAbyssMark?: boolean;
}

/** Fracturing Orb target (locks one random mod; we want this one). */
export interface SimFractureSpec {
  targetGroup: string;
  side: Side;
}

export interface SimMethodSpec {
  id: SimMethodId;
  /** Chaos budget per base for alch-chaos. */
  maxChaos?: number;
  /** Essence used by essence-led methods (0.5: at most ONE per item). */
  essence?: SimEssenceSpec;
  /** Desecration pipeline used by desecrate-omen-exalt / essence-omen-exalt. */
  desecrate?: SimDesecrateSpec;
  /** Fracture target used by fracture-omen-exalt. */
  fracture?: SimFractureSpec;
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
  {
    id: "omen-exalt",
    name: "Omen-directed Exalts",
    blurb:
      "Magic ladder, then Sinistral/Dextral Exaltation slams per target with side-omen Annul cleanup on misses.",
  },
  {
    id: "essence-omen-exalt",
    name: "Essence + Omen-directed Exalts",
    blurb:
      "Transmute, essence-guarantee the lead mod (0.5: one crafted mod), then directional Exalt slams with Annul cleanup.",
  },
  {
    id: "fracture-omen-exalt",
    name: "Fracture + Omen-directed Exalts",
    blurb:
      "Alchemy, Fracture to lock the key mod (random pick), Annul fillers, then directional Exalt slams.",
  },
  {
    id: "desecrate-omen-exalt",
    name: "Desecrate + Omen-directed Exalts",
    blurb:
      "Alchemy, Abyss-desecrate one mod on a chosen side (pick 1 of 3 at the Well of Souls), then directional Exalt slams.",
  },
];

/** Methods whose policies consume directional omens. */
export const OMEN_METHODS: ReadonlySet<SimMethodId> = new Set([
  "omen-exalt",
  "essence-omen-exalt",
  "fracture-omen-exalt",
  "desecrate-omen-exalt",
]);

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

/* ----------------------- omen-directed crafting helpers ----------------------- */

const EXALT_OMEN: Record<Side, string> = {
  prefix: "omen-of-sinistral-exaltation",
  suffix: "omen-of-dextral-exaltation",
};
const ANNUL_OMEN: Record<Side, string> = {
  prefix: "omen-of-sinistral-annulment",
  suffix: "omen-of-dextral-annulment",
};

function targetSatisfied(item: ItemState, t: SimTarget): boolean {
  const accepted = [t.group, ...(t.altGroups ?? [])];
  return item.mods.some(
    (m) =>
      accepted.includes(m.group) && m.side === t.side && m.level >= t.minLevel,
  );
}

/** True when this rolled mod satisfies one of the targets (don't annul it). */
function isNeededMod(m: RolledMod, targets: SimTarget[]): boolean {
  return targets.some(
    (t) =>
      t.side === m.side &&
      [t.group, ...(t.altGroups ?? [])].includes(m.group) &&
      m.level >= t.minLevel,
  );
}

/** Guard on total actions per base so degenerate pools can't spin forever. */
const MAX_ACTIONS_PER_BASE = 60;

/**
 * Directional-omen fill: for each unsatisfied target, slam Exalts forced to
 * the target's side (Sinistral/Dextral Exaltation). When the side is full of
 * junk, pair Annul with the side omen to clear — the Annul is random within
 * the side, so it can strip a finished target mod (the real brick risk).
 * When the remaining open slots exactly match the remaining targets, a
 * single Omen of Greater Exaltation double-slam fills two at once.
 */
function omenExaltFill(
  pool: SimPool,
  item: ItemState,
  targets: SimTarget[],
  tally: CurrencyTally,
  opts: { cleanup?: boolean } = {},
): void {
  const cleanup = opts.cleanup !== false;
  let actions = 0;
  // Targets that can actually roll from the normal pool — desecrated-only
  // groups can't be Exalt-slammed; a miss on their reveal is final.
  const rollable = (t: SimTarget): boolean => {
    const groups = t.side === "prefix" ? pool.prefixes : pool.suffixes;
    const accepted = [t.group, ...(t.altGroups ?? [])];
    return groups.some((g) => accepted.includes(g.group));
  };
  const unsatisfied = () =>
    targets.filter((t) => !targetSatisfied(item, t) && rollable(t));

  while (actions++ < MAX_ACTIONS_PER_BASE) {
    const remaining = unsatisfied();
    if (remaining.length === 0) return;

    // Greater Exaltation double-slam: with >= 2 targets remaining and the
    // open slots exactly matching them, one Exalt adds two mods at once and
    // can't displace anything (no cleanup risk).
    const openSlots =
      MAX_PER_SIDE -
      sideCount(item, "prefix") +
      (MAX_PER_SIDE - sideCount(item, "suffix"));
    if (remaining.length >= 2 && openSlots === remaining.length) {
      tally.add("exalted");
      tally.add("omen-of-greater-exaltation");
      addRandomMod(pool, item);
      addRandomMod(pool, item);
      continue;
    }

    const t = remaining[0];
    if (sideCount(item, t.side) >= MAX_PER_SIDE) {
      // Side full. Without cleanup (snipe economics: slam once, sell the
      // result either way), the trial simply ends here as a miss — an
      // Annul+omen grind on a cheap base costs more than a fresh buy.
      if (!cleanup) return;
      // Clear junk with Annul + side omen. If every mod on the
      // side is needed (or fractured), the base is a dead end.
      const strippable = item.mods.some(
        (m) => m.side === t.side && !m.fractured && !isNeededMod(m, targets),
      );
      if (!strippable) return;
      tally.add("annul");
      // Omen only needed if a plain Annul could hit the opposite side.
      const other = t.side === "prefix" ? "suffix" : "prefix";
      if (item.mods.some((m) => m.side === other && !m.fractured)) {
        tally.add(ANNUL_OMEN[t.side]);
      }
      // Random within the side: this is where finished mods get bricked.
      if (!removeRandomUnfractured(item, t.side)) return;
      continue;
    }

    tally.add("exalted");
    const otherSide = t.side === "prefix" ? "suffix" : "prefix";
    const otherOpen = sideCount(item, otherSide) < MAX_PER_SIDE;
    const otherNeeded = remaining.some((r) => r.side === otherSide);
    if (otherOpen && otherNeeded) {
      // Junk on the other side would block a wanted slot — pay for the omen.
      tally.add(EXALT_OMEN[t.side]);
      if (!addRandomMod(pool, item, 0, t.side)) return;
    } else if (otherOpen) {
      // Junk on the other side is harmless: plain slams are cheaper than
      // omens, and once that side fills up the slam is side-locked for free.
      if (!addRandomMod(pool, item)) return;
    } else {
      // Only the target side has open slots — a plain slam is already forced.
      if (!addRandomMod(pool, item, 0, t.side)) return;
    }
  }
}

/** Applies an essence: upgrades to Rare, guarantees the spec'd mod (1 crafted mod max). */
function applyEssence(item: ItemState, ess: SimEssenceSpec, tally: CurrencyTally): void {
  tally.add(ess.apiId);
  if (!hasGroup(item, ess.group) && sideCount(item, ess.side) < MAX_PER_SIDE) {
    item.mods.push({ group: ess.group, level: ess.level, side: ess.side });
  }
}

/**
 * Abyss desecration: Essence of the Abyss replaces a random non-fractured
 * mod with the Mark; the bone (+ directional Necromancy) converts it into an
 * unrevealed desecrated mod on the chosen side; the Well of Souls reveals
 * 3 options (5 with Abyssal Echoes) — take the target if offered, otherwise
 * one of the offered mods occupies the slot (0.5: max 1 desecrated mod, so
 * there is no re-roll on the same item).
 */
function applyDesecration(
  item: ItemState,
  spec: SimDesecrateSpec,
  tally: CurrencyTally,
): void {
  if (item.mods.some((m) => m.desecrated)) return; // 0.5 cap: 1 desecrated
  if (!spec.skipAbyssMark) {
    tally.add("essence-of-the-abyss");
    removeRandomUnfractured(item);
  }
  tally.add(spec.boneApiId);
  tally.add(spec.necroApiId);
  if (spec.useEchoes) tally.add("omen-of-abyssal-echoes");
  for (const omen of spec.extraOmenApiIds ?? []) tally.add(omen);
  if (sideCount(item, spec.side) >= MAX_PER_SIDE) return;
  const k = spec.useEchoes ? 5 : 3;
  const candidates = spec.groups.filter((g) => !hasGroup(item, g.group));
  const options = drawDistinctGroups(candidates, k);
  if (options.length === 0) return;
  const chosen =
    options.find((g) => g.group === spec.targetGroup) ?? options[0];
  const tier = pickWeighted(chosen.tiers);
  item.mods.push({
    group: chosen.group,
    level: tier?.level ?? 0,
    side: spec.side,
    desecrated: true,
  });
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
      if (ess) applyEssence(item, ess, tally);
      while (item.mods.length < 6) {
        tally.add("exalted");
        if (!addRandomMod(pool, item)) break;
      }
      break;
    }
    case "omen-exalt": {
      // Magic ladder to Rare, then directional slams per target.
      tally.add("transmutation");
      addRandomMod(pool, item);
      tally.add("augmentation");
      addRandomMod(pool, item);
      tally.add("regal");
      addRandomMod(pool, item);
      omenExaltFill(pool, item, targets, tally);
      break;
    }
    case "essence-omen-exalt": {
      // Transmute, essence-guarantee the lead (single 0.5 crafted mod),
      // optional desecration for a second chosen-side mod, then directional
      // slams for the rest.
      tally.add("transmutation");
      addRandomMod(pool, item);
      if (spec.essence) applyEssence(item, spec.essence, tally);
      if (spec.desecrate) applyDesecration(item, spec.desecrate, tally);
      omenExaltFill(pool, item, targets, tally);
      break;
    }
    case "fracture-omen-exalt": {
      // Alch (4 mods). If the key mod landed, fracture: a random
      // non-desecrated mod gets locked — only sometimes the right one.
      tally.add("alch");
      for (let i = 0; i < 4; i++) addRandomMod(pool, item);
      const f = spec.fracture;
      if (f) {
        const key = item.mods.find(
          (m) => m.group === f.targetGroup && m.side === f.side,
        );
        if (key) {
          tally.add("fracturing-orb");
          const fracturable = item.mods.filter((m) => !m.desecrated);
          const locked =
            fracturable[Math.floor(Math.random() * fracturable.length)];
          if (locked) locked.fractured = true;
        }
      }
      omenExaltFill(pool, item, targets, tally);
      break;
    }
    case "desecrate-omen-exalt": {
      tally.add("alch");
      for (let i = 0; i < 4; i++) addRandomMod(pool, item);
      if (spec.desecrate) applyDesecration(item, spec.desecrate, tally);
      omenExaltFill(pool, item, targets, tally);
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

/* ----------------------------- finish simulation ----------------------------- */

/** A mod already on a bought/owned item when the finishing starts. */
export interface SimStartMod {
  group: string;
  side: Side;
  level: number;
  fractured?: boolean;
  desecrated?: boolean;
}

/** Finishing plan: optional desecration first, then directional slams. */
export interface FinishSpec {
  desecrate?: SimDesecrateSpec;
  /**
   * Annul-cleanup loops when a side fills with junk (default true). Disable
   * for snipe economics: a missed slam on a cheap base means "sell as-is and
   * buy the next one", not an omen-priced annul grind.
   */
  cleanup?: boolean;
}

/**
 * Simulates finishing a PARTIALLY-ROLLED item: start from its current mods,
 * optionally desecrate into an open slot, then omen-directed Exalt slams
 * (with Annul cleanup) toward the remaining targets. This is the engine
 * behind "buy for X, finish for Y, sell for Z".
 */
export function simulateFinish(
  pool: SimPool,
  startMods: SimStartMod[],
  targets: SimTarget[],
  spec: FinishSpec,
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
    const item: ItemState = {
      mods: startMods.map((m) => ({ ...m })),
    };
    if (spec.desecrate) applyDesecration(item, spec.desecrate, tally);
    omenExaltFill(pool, item, targets, tally, { cleanup: spec.cleanup });

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
