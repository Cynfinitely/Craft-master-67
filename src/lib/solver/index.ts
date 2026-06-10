import "server-only";
import { getEligibleMods, getModPool, searchBases } from "@/lib/data/queries";
import { groupByModGroup, modLabel, tierValue } from "@/lib/data/format";
import { notableTags } from "@/lib/data/tags";
import {
  getCurrentLeagueName,
  getPriceByApiId,
  getPrices,
} from "@/lib/pricing/poe2scout";
import { getBasePrice, type BasePriceQuote } from "@/lib/trade/basePrice";
import { buildModStatMap, type ModStatMap } from "@/lib/trade/modMap";
import { withTimeout } from "@/lib/trade/client";
import { estimateSaleValue } from "@/lib/market/analytics";
import {
  essenceReachesTarget,
  resolveDeterminism,
  type EssenceGuarantee,
} from "./determinism";
import { resolveAlloys, type AlloyGuarantee } from "./alloys";
import { leagueAdvice } from "./leagueAdvisor";
import { applyForgeCosts } from "@/lib/market/runes";
import { BONE_BY_CLASS } from "./registry";
import {
  MAX_DESECRATED_MODS,
  RULE_05_SUMMARY,
  validateTargets05,
} from "./rules";
import { FLUX_FALLBACK_PRICE, resolveFlux } from "./flux";
import { withRisk } from "./risk";
import { catalystStep, corruptionStep, crystallisationStep } from "./finishers";
import { isRuneforgeable, runeforgingNote } from "@/lib/data/runeforging";
import type { EligibleMod } from "@/lib/data/types";
import type {
  BaseRecommendation,
  ClassPool,
  CraftMethod,
  CraftPlan,
  CraftStep,
  DesiredMod,
  GroupChoice,
} from "./types";

const MAX_AFFIXES_PER_TYPE = 3;

interface GroupInfo {
  group: string;
  label: string;
  weight: number;
}

function buildGroupMap(mods: EligibleMod[]): Map<string, GroupInfo> {
  const grouped = groupByModGroup(mods);
  const map = new Map<string, GroupInfo>();
  for (const g of grouped) {
    map.set(g.group, {
      group: g.group,
      label: modLabel(g.mods[0]),
      weight: g.weight,
    });
  }
  return map;
}

/* ----------------------------- cost model ----------------------------- */

// Fallback unit prices in Exalted Orbs, used when the live price for an apiId
// is unavailable. Deliberately conservative; clearly-approximate methods are
// flagged so the UI can label them.
export const FALLBACK_PRICE: Record<string, number> = {
  transmutation: 0.02,
  augmentation: 0.05,
  regal: 0.3,
  alch: 0.25,
  exalted: 1,
  "greater-exalted-orb": 6,
  "perfect-exalted-orb": 30,
  chaos: 0.5,
  "greater-chaos-orb": 4,
  "perfect-chaos-orb": 20,
  "greater-orb-of-transmutation": 0.5,
  "perfect-orb-of-transmutation": 3,
  "greater-orb-of-augmentation": 0.5,
  "perfect-orb-of-augmentation": 3,
  "greater-regal-orb": 4,
  "perfect-regal-orb": 20,
  annul: 2,
  "omen-of-sinistral-annulment": 5,
  "omen-of-dextral-annulment": 5,
  "omen-of-sinistral-exaltation": 10,
  "omen-of-dextral-exaltation": 10,
  "omen-of-whittling": 25,
  "omen-of-light": 15,
  "omen-of-abyssal-echoes": 20,
  "omen-of-sinistral-crystallisation": 6,
  "omen-of-dextral-crystallisation": 6,
  "omen-of-the-sovereign": 15,
  "omen-of-the-liege": 15,
  "omen-of-the-hunger": 15,
  divine: 200,
  vaal: 1.5,
  "fracturing-orb": 30,
  "essence-of-the-abyss": 80,
  "preserved-jawbone": 5,
  "ancient-jawbone": 25,
  "preserved-rib": 5,
  "ancient-rib": 25,
  "preserved-collarbone": 5,
  "ancient-collarbone": 25,
  "omen-of-sinistral-necromancy": 10,
  "omen-of-dextral-necromancy": 10,
  "omen-of-greater-exaltation": 8,
  "tuls-catalyst": 1,
  "xophs-catalyst": 1,
  "eshs-catalyst": 1,
  "uul-netols-catalyst": 1,
  // 0.5 Alloys aren't listed on poe2scout — conservative flat fallback so
  // alloy-led plans never price the guarantee at zero.
  "runic-alloy": 3,
  "adaptive-alloy": 3,
  "expansive-alloy": 3,
  "protective-alloy": 3,
  "cyclonic-alloy": 3,
  "mystic-alloy": 3,
  "prismatic-alloy": 3,
  "swift-alloy": 3,
  "celestial-alloy": 3,
  "sovereign-alloy": 3,
  "the-runebinders-alloy": 3,
  "the-runefathers-alloy": 3,
  "transcendent-alloy": 3,
  ...FLUX_FALLBACK_PRICE,
};

export function makePricer(priceMap: Map<string, number>) {
  return (apiId: string): number =>
    priceMap.get(apiId) ?? FALLBACK_PRICE[apiId] ?? 0;
}

function round(n: number): number {
  if (!Number.isFinite(n)) return n;
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

function oddsToAttempts(odds: number): number {
  return odds > 0 ? 1 / odds : Infinity;
}

/**
 * Expected Annul orbs to remove `count` specific mods when each Annul picks
 * uniformly at random from the current pool (no omen). Removing one mod from a
 * pool of k takes k attempts on average; sum over k = count..1.
 */
function expectedRandomAnnuls(count: number): number {
  if (count <= 0) return 0;
  return (count * (count + 1)) / 2;
}

/**
 * Expected Annul orbs to remove one specific mod among `poolSize` mods of the
 * same affix type when using a Sinistral/Dextral Annulment omen (random within
 * that side only).
 */
function expectedSideAnnuls(poolSize: number): number {
  return poolSize > 0 ? poolSize : 0;
}

/* ----------------------------- tier-aware odds ----------------------------- */

// Exalt orb tiers and the minimum modifier level each guarantees on the added
// mod. Greater = lvl 35, Perfect = lvl 50 (PoE2 "Rise of the Abyssal").
interface ExaltOrb {
  apiId: string;
  name: string;
  minLevel: number;
}
const EXALT_ORBS: ExaltOrb[] = [
  { apiId: "exalted", name: "Exalted Orb", minLevel: 0 },
  { apiId: "greater-exalted-orb", name: "Greater Exalted Orb", minLevel: 35 },
  { apiId: "perfect-exalted-orb", name: "Perfect Exalted Orb", minLevel: 50 },
];

// Tiered base-currency ladders (Normal / Greater / Perfect) with their
// guaranteed minimum modifier levels (poe2wiki): Transmute 55/70,
// Augmentation 44/70, Regal 35/50, Chaos 35/50 — same as Exalt for the
// Rare-item orbs, much higher for the Magic-item orbs.
type LadderOrb = { apiId: string; name: string; minLevel: number };
const TRANSMUTE_ORBS: LadderOrb[] = [
  { apiId: "transmutation", name: "Orb of Transmutation", minLevel: 0 },
  { apiId: "greater-orb-of-transmutation", name: "Greater Orb of Transmutation", minLevel: 55 },
  { apiId: "perfect-orb-of-transmutation", name: "Perfect Orb of Transmutation", minLevel: 70 },
];
const AUGMENT_ORBS: LadderOrb[] = [
  { apiId: "augmentation", name: "Orb of Augmentation", minLevel: 0 },
  { apiId: "greater-orb-of-augmentation", name: "Greater Orb of Augmentation", minLevel: 44 },
  { apiId: "perfect-orb-of-augmentation", name: "Perfect Orb of Augmentation", minLevel: 70 },
];
const REGAL_ORBS: LadderOrb[] = [
  { apiId: "regal", name: "Regal Orb", minLevel: 0 },
  { apiId: "greater-regal-orb", name: "Greater Regal Orb", minLevel: 35 },
  { apiId: "perfect-regal-orb", name: "Perfect Regal Orb", minLevel: 50 },
];
const CHAOS_ORBS: LadderOrb[] = [
  { apiId: "chaos", name: "Chaos Orb", minLevel: 0 },
  { apiId: "greater-chaos-orb", name: "Greater Chaos Orb", minLevel: 35 },
  { apiId: "perfect-chaos-orb", name: "Perfect Chaos Orb", minLevel: 50 },
];

/**
 * Picks the ladder orb with the lowest expected cost: unit price divided by
 * the hit odds at that orb's minimum modifier level. Higher-tier orbs cost
 * more per use but shrink the eligible pool (fewer junk tiers), often paying
 * for themselves on hard targets.
 */
function pickOrbByExpectedCost(
  ladder: LadderOrb[],
  price: (apiId: string) => number,
  oddsAtMin: (minLevel: number) => number,
): { orb: LadderOrb; odds: number } {
  let best: { orb: LadderOrb; odds: number; expCost: number } | null = null;
  for (const orb of ladder) {
    const odds = oddsAtMin(orb.minLevel);
    if (odds <= 0) continue;
    const unit = price(orb.apiId);
    const expCost = unit > 0 ? unit / odds : Number.MAX_SAFE_INTEGER / 2;
    if (!best || expCost < best.expCost) best = { orb, odds, expCost };
  }
  if (best) return { orb: best.orb, odds: best.odds };
  return { orb: ladder[0], odds: oddsAtMin(ladder[0].minLevel) };
}

type TierGroups = Map<string, EligibleMod[]>;

function toTierGroups(mods: EligibleMod[]): TierGroups {
  const m: TierGroups = new Map();
  for (const x of mods) {
    const g = x.groups[0] ?? x.id;
    const arr = m.get(g);
    if (arr) arr.push(x);
    else m.set(g, [x]);
  }
  return m;
}

/**
 * Eligible weight of a group at a given minimum modifier level: the summed
 * weight of its tiers at or above that level. If none qualify, the highest
 * tier still rolls (PoE2 fallback rule), so its weight is used.
 */
function groupWeightAtLevel(tiers: EligibleMod[], minLevel: number): number {
  if (tiers.length === 0) return 0;
  const q = tiers.filter((t) => t.requiredLevel >= minLevel);
  if (q.length) return q.reduce((s, t) => s + t.weight, 0);
  const top = tiers.reduce((a, b) => (b.requiredLevel > a.requiredLevel ? b : a));
  return top.weight;
}

function typeWeightAtLevel(groups: TierGroups, minLevel: number): number {
  let s = 0;
  for (const tiers of groups.values()) s += groupWeightAtLevel(tiers, minLevel);
  return s;
}

/**
 * Weight of the tiers of a group that BOTH roll under an orb's minimum
 * modifier level restriction AND satisfy the user's target tier. Respects the
 * fallback rule: when no tier reaches the orb minimum, the group's highest
 * tier stays rollable (but it must still meet the target tier to count).
 */
function targetWeightAtOrbLevel(
  tiers: EligibleMod[],
  targetLevel: number,
  orbMinLevel: number,
): number {
  if (tiers.length === 0) return 0;
  let rollable = tiers.filter((t) => t.requiredLevel >= orbMinLevel);
  if (rollable.length === 0) {
    rollable = [
      tiers.reduce((a, b) => (b.requiredLevel > a.requiredLevel ? b : a)),
    ];
  }
  return rollable
    .filter((t) => t.requiredLevel >= targetLevel)
    .reduce((s, t) => s + t.weight, 0);
}

/** All groups a target accepts: its own plus any Flux-convertible surrogates. */
function acceptedGroups(t: DesiredMod): string[] {
  return [t.group, ...(t.fluxGroups ?? [])];
}

/**
 * Flux-aware numerator: summed eligible weight across the target group and
 * its Flux surrogates, under both the orb minimum level and the target tier.
 */
function targetNumerator(
  groups: TierGroups,
  t: DesiredMod,
  orbMinLevel: number,
): number {
  let num = 0;
  for (const g of acceptedGroups(t)) {
    num += targetWeightAtOrbLevel(groups.get(g) ?? [], t.tierLevel ?? 0, orbMinLevel);
  }
  return num;
}

/* ----------------------------- target prep ----------------------------- */

/** Live base-listing quotes from the trade site (best-effort, may be absent). */
interface BasePriceBundle {
  /** A clean Normal base at the requested minimum item level. */
  normal: BasePriceQuote | null;
  /** A Magic base already carrying the two hardest target mods. */
  magicHard: BasePriceQuote | null;
  /** A base whose hardest target mod is already FRACTURED (locked). */
  fracturedKey: BasePriceQuote | null;
}

interface SolveInputs {
  baseId: string;
  baseName: string;
  itemClass: string;
  itemLevel: number;
  desiredPrefixes: DesiredMod[];
  desiredSuffixes: DesiredMod[];
  totalPre: number;
  totalSuf: number;
  /** Per-group tiers for the prefix/suffix pools (for tier-aware odds). */
  preGroups: TierGroups;
  sufGroups: TierGroups;
  determinism: Map<string, EssenceGuarantee[]>;
  alloys: Map<string, AlloyGuarantee[]>;
  price: (apiId: string) => number;
  basePrices?: BasePriceBundle;
}

/** The two hardest targets (lowest fresh odds) — used by buy-a-base paths. */
export function pickHardTargets(targets: DesiredMod[]): DesiredMod[] {
  return [...targets].sort((a, b) => a.oddsFresh - b.oddsFresh).slice(0, 2);
}

// Alloys aren't on poe2scout yet; use a conservative flat fallback price.
const ALLOY_FALLBACK_PRICE = 3;

/**
 * Best essence for a target: cheapest whose guaranteed tier/value reaches the
 * user's minimum. Returns null when a specific tier is requested but no essence
 * can hit it (e.g. Hysteria's fixed 30% ms can't reach T1 35%).
 */
function bestEssenceForTarget(
  inputs: SolveInputs,
  target: DesiredMod,
): EssenceGuarantee | null {
  // Flux-aware: an essence that guarantees a surrogate resistance group works
  // too — the Flux converts it to the wanted element at the end.
  const options = acceptedGroups(target).flatMap(
    (g) => inputs.determinism.get(g) ?? [],
  );
  if (options.length === 0) return null;
  const byPrice = [...options].sort(
    (a, b) => inputs.price(a.essenceApiId) - inputs.price(b.essenceApiId),
  );
  const reaches = byPrice.filter((e) => essenceReachesTarget(e, target));
  if (target.tierLevel != null) return reaches[0] ?? null;
  // No specific tier requested: any guaranteed roll of the mod sells, so
  // take the CHEAPEST essence (T2-3 results are perfectly marketable —
  // don't pay Greater/Perfect premiums nobody asked for). Tie-break by
  // higher guarantee.
  return [...options].sort((a, b) => {
    const ap = inputs.price(a.essenceApiId);
    const bp = inputs.price(b.essenceApiId);
    if (ap !== bp) return ap - bp;
    return (b.guaranteedLevel ?? 0) - (a.guaranteedLevel ?? 0);
  })[0];
}

function essenceGuaranteeable(inputs: SolveInputs, target: DesiredMod): boolean {
  return bestEssenceForTarget(inputs, target) != null;
}

function essenceStepDetail(
  essence: EssenceGuarantee,
  targetLabel: string,
): string {
  const tierBit = essence.guaranteedValue
    ? ` at ${essence.guaranteedValue}`
    : "";
  const fixedBit = essence.isFixedValue
    ? " The granted value is fixed — a Divine Orb cannot reroll it."
    : "";
  return `Applying an Essence upgrades the Magic item to Rare while guaranteeing "${targetLabel}"${tierBit}.${fixedBit}`;
}

/**
 * Odds a single Transmute lands a given mod on a fresh Magic item, under an
 * orb's minimum modifier level (Greater/Perfect shrink the whole pool).
 * Flux-aware: surrogate resistance groups count toward the numerator.
 */
function magicHitOdds(
  inputs: SolveInputs,
  target: DesiredMod,
  orbMinLevel = 0,
): number {
  const groups =
    target.generationType === "prefix" ? inputs.preGroups : inputs.sufGroups;
  const num = targetNumerator(groups, target, orbMinLevel);
  const den =
    orbMinLevel > 0
      ? typeWeightAtLevel(inputs.preGroups, orbMinLevel) +
        typeWeightAtLevel(inputs.sufGroups, orbMinLevel)
      : inputs.totalPre + inputs.totalSuf;
  return den > 0 ? Math.min(1, num / den) : 0;
}

/**
 * Odds a single Augmentation (at an orb minimum level) lands a target on a
 * 1-mod Magic item whose existing mod occupies `placedGroup` on `placedSide`.
 */
function augHitOdds(
  inputs: SolveInputs,
  target: DesiredMod,
  orbMinLevel: number,
  placed?: { group: string; side: "prefix" | "suffix" },
): number {
  const groups =
    target.generationType === "prefix" ? inputs.preGroups : inputs.sufGroups;
  const num = targetNumerator(groups, target, orbMinLevel);
  let den =
    typeWeightAtLevel(inputs.preGroups, orbMinLevel) +
    typeWeightAtLevel(inputs.sufGroups, orbMinLevel);
  if (placed) {
    const placedGroups =
      placed.side === "prefix" ? inputs.preGroups : inputs.sufGroups;
    den -= groupWeightAtLevel(placedGroups.get(placed.group) ?? [], orbMinLevel);
  }
  return den > 0 ? Math.min(1, num / den) : 0;
}

type BoneInfo = { bone: string; boneApi: string };

/** Abyss + directional desecrate-unveil for one target. */
function appendDesecrateSteps(
  inputs: SolveInputs,
  target: DesiredMod,
  boneInfo: BoneInfo,
  startN: number,
  steps: CraftStep[],
  opts?: { useEchoes?: boolean; includeAbyss?: boolean },
): { n: number; cost: number; odds: number } {
  let n = startN;
  let cost = 0;
  let odds = 1;
  const useEchoes = opts?.useEchoes ?? false;
  const includeAbyss = opts?.includeAbyss ?? true;

  if (includeAbyss) {
    const abyssEss = inputs.price("essence-of-the-abyss");
    steps.push({
      n: n++,
      title: "Essence of the Abyss → Mark of the Abyssal Lord",
      detail:
        "Removes a random non-fractured mod and adds the Mark of the Abyssal Lord. Fracture your seed mod first so the Mark replaces the other finished mod, not your key prefix.",
      currency: "Essence of the Abyss",
      costExalted: round(abyssEss),
    });
    cost += abyssEss;
  }

  const necroApi =
    target.generationType === "prefix"
      ? "omen-of-sinistral-necromancy"
      : "omen-of-dextral-necromancy";
  const necroName =
    target.generationType === "prefix"
      ? "Omen of Sinistral Necromancy"
      : "Omen of Dextral Necromancy";
  const ancientApi = `ancient-${boneInfo.boneApi}`;
  const pickOdds = useEchoes ? 1 / 2 : 1 / 3;
  const pickAttempts = Math.ceil(1 / pickOdds);
  const perDesec =
    inputs.price(ancientApi) +
    inputs.price(necroApi) +
    (useEchoes ? inputs.price("omen-of-abyssal-echoes") : 0);
  const desecCost = pickAttempts * perDesec;
  cost += desecCost;
  odds *= target.oddsFresh > 0 ? Math.min(1, 1 - Math.pow(1 - target.oddsFresh, useEchoes ? 5 : 3)) : pickOdds;
  steps.push({
    n: n++,
    title: `Desecrate-unveil "${target.label}" (${target.generationType})`,
    detail: `Apply an Ancient ${boneInfo.bone} with ${necroName} to add a hidden desecrated ${target.generationType}${
      useEchoes ? " and an Omen of Abyssal Echoes for more reveal options" : ""
    }, reveal at the Well of Souls, and pick "${target.label}". Re-roll with an Omen of Light if needed.`,
    currency: `Ancient ${boneInfo.bone}`,
    odds: pickOdds,
    expectedAttempts: pickAttempts,
    costExalted: round(desecCost),
  });
  return { n, cost, odds };
}

/**
 * Tier-aware odds for adding a single target via the best-matching exalt orb.
 * `placedPre`/`placedSuf` are groups already on the item, whose weight is
 * removed from the open pool. Returns the odds, the chosen orb, and the
 * effective open-pool denominator used.
 */
function targetExaltOdds(
  inputs: SolveInputs,
  t: DesiredMod,
  placedPre: Set<string>,
  placedSuf: Set<string>,
): { odds: number; orb: ExaltOrb } {
  const groups = t.generationType === "prefix" ? inputs.preGroups : inputs.sufGroups;
  const placed = t.generationType === "prefix" ? placedPre : placedSuf;
  // Odds at a given orb minimum level: flux-aware numerator over the open
  // pool of this affix type, minus the groups already occupying slots.
  const oddsAtMin = (minLevel: number): number => {
    const num = targetNumerator(groups, t, minLevel);
    let den = typeWeightAtLevel(groups, minLevel);
    for (const pg of placed) {
      den -= groupWeightAtLevel(groups.get(pg) ?? [], minLevel);
    }
    return den > 0 ? Math.min(1, num / den) : 0;
  };
  // Pick the orb tier with the lowest expected cost (price / odds) — a
  // pricier Greater/Perfect orb often wins by excluding junk tiers.
  const { orb, odds } = pickOrbByExpectedCost(EXALT_ORBS, inputs.price, oddsAtMin);
  return { odds, orb };
}

/**
 * Pushes Exalt+Omen steps that add each remaining target (tier-aware, picking
 * Greater/Perfect orbs when a high tier is targeted). Returns the combined
 * single-pass odds and estimated cost.
 */
function fillByExalt(
  inputs: SolveInputs,
  targets: DesiredMod[],
  startN: number,
  steps: CraftStep[],
  prePlaced?: { pre: Set<string>; suf: Set<string> },
  /** Groups that are fracture-/guarantee-locked and can't be Annulled away. */
  protect?: { pre: Set<string>; suf: Set<string> },
): { n: number; odds: number; cost: number } {
  let n = startN;
  let odds = 1;
  let cost = 0;
  const placedPre = new Set(prePlaced?.pre ?? []);
  const placedSuf = new Set(prePlaced?.suf ?? []);
  const protectPre = protect?.pre ?? new Set<string>();
  const protectSuf = protect?.suf ?? new Set<string>();
  const annul = inputs.price("annul");

  for (const t of targets) {
    const { odds: o, orb } = targetExaltOdds(inputs, t, placedPre, placedSuf);
    odds *= o;
    const attempts = oddsToAttempts(o);
    const omenId =
      t.generationType === "prefix"
        ? "omen-of-sinistral-exaltation"
        : "omen-of-dextral-exaltation";
    const omenName =
      t.generationType === "prefix"
        ? "Omen of Sinistral Exaltation"
        : "Omen of Dextral Exaltation";
    const annulOmenId =
      t.generationType === "prefix"
        ? "omen-of-sinistral-annulment"
        : "omen-of-dextral-annulment";
    const annulOmenName =
      t.generationType === "prefix"
        ? "Omen of Sinistral Annulment"
        : "Omen of Dextral Annulment";
    const orbPrice = inputs.price(orb.apiId);
    const omen = inputs.price(omenId);
    const annulOmen = inputs.price(annulOmenId);
    const placedSet = t.generationType === "prefix" ? placedPre : placedSuf;
    const protectSet =
      t.generationType === "prefix" ? protectPre : protectSuf;
    const placedSameType = placedSet.size;
    // Finished same-side mods that an Annul could actually strip (fractured /
    // locked mods are safe and excluded).
    let unprotectedSameType = 0;
    for (const g of placedSet) if (!protectSet.has(g)) unprotectedSameType++;
    // After a miss the wrong mod occupies one slot on this side; Annul (even
    // with a side omen) removes a random mod on that side — not guaranteed to
    // be the unwanted one.
    const annulsPerMiss = expectedSideAnnuls(placedSameType + 1);
    const perAttemptCost = orbPrice + omen;
    const failures = Number.isFinite(attempts) ? Math.max(0, attempts - 1) : 0;
    const cleanupPerMiss = annulsPerMiss * (annul + annulOmen);
    const stepCost = Number.isFinite(attempts)
      ? attempts * perAttemptCost + failures * cleanupPerMiss
      : 0;
    cost += stepCost;
    // Brick risk: when you Annul the wrong mod off this side, the Annul is
    // random within the side, so with `unprotectedSameType` strippable finished
    // mods present P(a good one goes first) = u/(u+1). Locking mods (fracture)
    // or leaving slots open (double-slam) avoids this.
    const brickOdds =
      unprotectedSameType > 0 && Number.isFinite(failures) && failures > 0
        ? unprotectedSameType / (unprotectedSameType + 1)
        : undefined;
    const tierBit = t.tierLevel
      ? ` at tier ${t.tierValue ?? `lvl ${t.tierLevel}`}`
      : "";
    const biasBit = orb.minLevel
      ? ` (biases the roll to modifier level ≥ ${orb.minLevel})`
      : "";
    steps.push({
      n: n++,
      title: `Add "${t.label}"${tierBit} (${t.generationType})`,
      detail: `Use ${orb.name} with an ${omenName} to force the new modifier onto a ${t.generationType} slot${biasBit}. On a miss, pair an ${annulOmenName} with Annul — it still removes a random ${t.generationType} (≈${annulsPerMiss} Annul${annulsPerMiss === 1 ? "" : "s"} per cleanup on average when ${placedSameType + 1} ${t.generationType}${placedSameType + 1 === 1 ? "" : "es"} are present); a bad Annul can strip a finished mod and force you to restart.`,
      currency: orb.name,
      odds: o,
      expectedAttempts: Number.isFinite(attempts)
        ? Math.max(1, Math.ceil(attempts))
        : undefined,
      costExalted: Number.isFinite(stepCost) ? round(stepCost) : undefined,
      brickOdds,
    });
    if (t.generationType === "prefix") placedPre.add(t.group);
    else placedSuf.add(t.group);
  }
  return { n, odds, cost };
}

/**
 * Per-mod chance a Divine reroll lands an acceptable value (the top ~half of
 * the tier's actual roll range). Tier-aware: a fixed-value mod (no range)
 * never needs the Divine (q = 1); a 2-value range is a coin flip; wide ranges
 * approach 1/2. Unknown ranges fall back to 1/2.
 */
function divineGoodRollChance(t: DesiredMod): number {
  const min = t.tierStatMin;
  const max = t.tierStatMax;
  if (min == null || max == null) return 0.5;
  if (max <= min) return 1; // fixed value — nothing to reroll
  const width = Math.round(max - min) + 1;
  return Math.ceil(width / 2) / width;
}

/**
 * The Divine step: Divine Orbs reroll ALL variable values on the item at once,
 * so reaching good values on several mods is geometric. Expected Divines =
 * 1 / prod(q_i) over the variable target mods, where each q_i comes from the
 * mod's actual roll range (`divineGoodRollChance`). Capped to stay sane.
 */
function divineStep(
  inputs: SolveInputs,
  targets: DesiredMod[],
  startN: number,
  fixedGroups: Set<string> = new Set(),
): { step: CraftStep; cost: number } | null {
  const variable = targets.filter(
    (t) => !fixedGroups.has(t.group) && divineGoodRollChance(t) < 1,
  );
  if (variable.length === 0) return null;
  const jointQ = variable.reduce((p, t) => p * divineGoodRollChance(t), 1);
  const raw = jointQ > 0 ? 1 / jointQ : 50;
  const attempts = Math.min(50, Math.max(1, Math.round(raw)));
  const divine = inputs.price("divine");
  const cost = attempts * divine;
  const variableMods = variable.length;
  return {
    step: {
      n: startN,
      title: "Divine to perfect the values",
      detail: `A Divine Orb rerolls ALL ${variableMods} variable value${variableMods === 1 ? "" : "s"} at once, so hitting high rolls on every mod is luck-based — expect roughly ${attempts} Divine${attempts === 1 ? "" : "s"} for good values across the board (more for near-perfect), based on each mod's actual roll range. Fracture or annul a finished mod first if you only need to reroll the rest. Note: Divines reroll values WITHIN a tier — they never upgrade the tier itself.`,
      currency: "Divine Orb",
      odds: undefined,
      expectedAttempts: attempts,
      costExalted: round(cost),
    },
    cost,
  };
}

/**
 * Greater/Perfect Chaos "replace a bad affix" step. Chaos removes one random
 * mod and adds one; with `goodMods` of `totalMods` worth protecting, each orb
 * has `goodMods/totalMods` chance to strip a good mod (the recipe's "2/3 to
 * brick"). Success = remove the one bad mod AND add the target.
 */
function chaosReplaceStep(
  inputs: SolveInputs,
  target: DesiredMod,
  goodMods: number,
  totalMods: number,
  startN: number,
): { step: CraftStep; cost: number } {
  const sideGroups =
    target.generationType === "prefix" ? inputs.preGroups : inputs.sufGroups;
  const pRemoveBad = totalMods > 0 ? 1 / totalMods : 0;
  const oddsAtMin = (minLevel: number): number => {
    const num = targetNumerator(sideGroups, target, minLevel);
    const den = typeWeightAtLevel(sideGroups, minLevel);
    return pRemoveBad * (den > 0 ? Math.min(1, num / den) : 0);
  };
  const { orb: chaosOrb, odds: pSuccess } = pickOrbByExpectedCost(
    CHAOS_ORBS,
    inputs.price,
    oddsAtMin,
  );
  const unit = inputs.price(chaosOrb.apiId) || inputs.price("chaos");
  const attempts = pSuccess > 0 ? 1 / pSuccess : Infinity;
  const brickOdds = totalMods > 0 ? goodMods / totalMods : 0;
  const cost = Number.isFinite(attempts) ? attempts * unit : 0;
  return {
    step: {
      n: startN,
      title: `${chaosOrb.name} to swap a bad affix for "${target.label}"`,
      detail: `${chaosOrb.name} removes one random mod and adds one. With ${goodMods} good mod${
        goodMods === 1 ? "" : "s"
      } of ${totalMods} on the item, each orb has ~${Math.round(
        brickOdds * 100,
      )}% to strip a good mod instead of the bad one — protect finished mods by Fracturing first.`,
      currency: chaosOrb.name,
      odds: pSuccess,
      expectedAttempts: Number.isFinite(attempts)
        ? Math.max(1, Math.ceil(attempts))
        : undefined,
      costExalted: Number.isFinite(cost) ? round(cost) : undefined,
      brickOdds,
    },
    cost: Number.isFinite(cost) ? cost : 0,
  };
}

/* ----------------------------- method builders ----------------------------- */

function methodEssenceLed(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes];
  // Find targets an essence can actually guarantee at the requested tier.
  const guaranteeable = allTargets
    .filter((t) => essenceGuaranteeable(inputs, t))
    .sort((a, b) => a.oddsFresh - b.oddsFresh);
  if (guaranteeable.length === 0) return null;

  const lead = guaranteeable[0];
  const essence = bestEssenceForTarget(inputs, lead)!;

  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;
  steps.push({
    n: n++,
    title: `Start with an item level ${inputs.itemLevel} ${inputs.baseName}`,
    detail:
      "Begin from a clean white (Normal) base of the highest item level you can use so every desired tier is unlocked.",
  });
  const transmute = inputs.price("transmutation");
  steps.push({
    n: n++,
    title: "Orb of Transmutation",
    detail: "Upgrade the Normal base to Magic so an Essence can be applied.",
    currency: "Orb of Transmutation",
    costExalted: round(transmute),
  });
  cost += transmute;

  const essCost = inputs.price(essence.essenceApiId);
  const tierBit = essence.guaranteedValue
    ? ` (guarantees ${essence.guaranteedValue})`
    : "";
  steps.push({
    n: n++,
    title: `Use ${essence.essenceName} to guarantee "${lead.label}"${tierBit}`,
    detail: essenceStepDetail(essence, lead.label),
    currency: essence.essenceName,
    odds: 1,
    costExalted: round(essCost),
  });
  cost += essCost;

  // Remaining targets via Exalt+Omen, with the essence mod pre-placed.
  const remaining = allTargets.filter((t) => t.group !== lead.group);
  const prePlaced = {
    pre: new Set(lead.generationType === "prefix" ? [lead.group] : []),
    suf: new Set(lead.generationType === "suffix" ? [lead.group] : []),
  };
  const fill = fillByExalt(inputs, remaining, n, steps, prePlaced);
  n = fill.n;
  cost += fill.cost;

  if (remaining.length >= 2) {
    steps.push({
      n: n++,
      title: "Optional: Omen of Greater Exaltation",
      detail:
        "If you still need two modifiers, an Omen of Greater Exaltation makes a single Exalted Orb add two random mods at once — handy when both remaining slots are open.",
      currency: "Omen of Greater Exaltation",
    });
    cost += inputs.price("omen-of-greater-exaltation");
  }

  const fixedGroups = essence.isFixedValue
    ? new Set([lead.group])
    : new Set<string>();
  const div = divineStep(inputs, allTargets, n, fixedGroups);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "essence-led",
    name: "Essence-led",
    summary: `Guarantee "${lead.label}" with ${essence.essenceName}, then Exalt the rest with Omens.`,
    steps,
    feasible: true,
    overallOdds: remaining.length ? fill.odds : 1,
    estCostExalted: round(cost),
    costApproximate: false,
    pros: [
      "Removes all randomness from the hardest modifier.",
      "Highest reliability of the cheap methods.",
    ],
    cons:
      remaining.length > 0
        ? ["Remaining mods still rely on Exalt+Omen RNG."]
        : [],
  };
}

/** Cheapest alloy (by fallback/live price) guaranteeing a group, if any. */
function cheapestAlloy(
  inputs: SolveInputs,
  group: string,
): AlloyGuarantee | null {
  const options = inputs.alloys.get(group);
  if (!options || options.length === 0) return null;
  return [...options].sort(
    (a, b) =>
      (inputs.price(a.alloyApiId) || ALLOY_FALLBACK_PRICE) -
      (inputs.price(b.alloyApiId) || ALLOY_FALLBACK_PRICE),
  )[0];
}

function methodAlloy(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes];
  const guaranteeable = allTargets
    .filter((t) => inputs.alloys.has(t.group))
    .sort((a, b) => a.oddsFresh - b.oddsFresh);
  if (guaranteeable.length === 0) return null;

  const lead = guaranteeable[0];
  const alloy = cheapestAlloy(inputs, lead.group)!;

  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;

  const alch = inputs.price("alch");
  steps.push({
    n: n++,
    title: `Get a Rare ${inputs.baseName}`,
    detail:
      "Alchemy (or Transmute → Regal) to a Rare with a couple of low-value mods — an Alloy removes a random mod, so keep the item lightly rolled first.",
    currency: "Orb of Alchemy",
    costExalted: round(alch),
  });
  cost += alch;

  const alloyPrice = inputs.price(alloy.alloyApiId) || ALLOY_FALLBACK_PRICE;
  steps.push({
    n: n++,
    title: `Use ${alloy.alloyName} to guarantee "${lead.label}"`,
    detail:
      "An Alloy (Runes of Aldur, 0.5) removes a random modifier and adds its fixed modifier — deterministic, like a Perfect Essence. Use it before adding your high-value mods.",
    currency: alloy.alloyName,
    odds: 1,
    costExalted: round(alloyPrice),
  });
  cost += alloyPrice;

  const remaining = allTargets.filter((t) => t.group !== lead.group);
  const prePlaced = {
    pre: new Set(lead.generationType === "prefix" ? [lead.group] : []),
    suf: new Set(lead.generationType === "suffix" ? [lead.group] : []),
  };
  const fill = fillByExalt(inputs, remaining, n, steps, prePlaced);
  n = fill.n;
  cost += fill.cost;

  if (isRuneforgeable(inputs.itemClass)) {
    const note = runeforgingNote(inputs.itemClass, inputs.itemLevel);
    if (note) {
      steps.push({
        n: n++,
        title: "Optional: add Runic Ward (Verisium Runeforging)",
        detail: note,
        currency: "Verisium",
      });
    }
  }

  const div = divineStep(inputs, allTargets, n);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "alloy-led",
    name: "Alloy-led (0.5)",
    summary: `Guarantee "${lead.label}" with ${alloy.alloyName}, then Exalt the rest.`,
    steps,
    feasible: true,
    overallOdds: remaining.length ? fill.odds : 1,
    estCostExalted: round(cost),
    costApproximate: true,
    pros: [
      "Deterministic key mod via a 0.5 Alloy (no RNG on that mod).",
      "Access to 0.5-exclusive modifiers other methods can't reach.",
    ],
    cons: [
      "Alloys are league-specific and removed at league end.",
      "Replaces a random mod — apply early, before high-value rolls.",
      "Uses the single 0.5 crafted-mod slot — no essence can be added on top.",
    ],
  };
}

/**
 * Flagship community recipe (bow/helmet): guarantee the hardest mod with a
 * Greater/Perfect Essence, desecrate-unveil a second strong mod on a chosen
 * side (directional Necromancy + bone, optionally Abyssal Echoes for more
 * reveal options), then fill the remaining OPEN slots with a Greater/Perfect
 * Exalt + Omen of Greater Exaltation double-slam. Open-slot adds avoid the
 * Annul-cleanup brick risk of the plain Exalt ladder.
 */
function methodEssenceDesecExalt(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  if (allTargets.length < 2) return null;
  const boneInfo = BONE_BY_CLASS.find((b) => b.test(inputs.itemClass));
  if (!boneInfo) return null;

  // Lead: hardest target an essence can guarantee at the requested tier.
  const lead = allTargets.find((t) => essenceGuaranteeable(inputs, t));
  if (!lead) return null;
  const essence = bestEssenceForTarget(inputs, lead)!;

  const afterLead = allTargets.filter((t) => t.group !== lead.group);
  const desecTarget = afterLead[0];
  const rest = afterLead.slice(1);

  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;

  // Plain Transmute — the essence guarantees the lead mod, so paying for a
  // Greater/Perfect roll on this throwaway Magic mod is wasted money.
  const transOrb = TRANSMUTE_ORBS[0];
  const transmute = inputs.price(transOrb.apiId);
  steps.push({
    n: n++,
    title: `${transOrb.name} on an item level ${inputs.itemLevel} ${inputs.baseName}`,
    detail:
      "Start from a clean Normal base and Transmute to Magic so an Essence can upgrade it to Rare.",
    currency: transOrb.name,
    costExalted: round(transmute),
  });
  cost += transmute;

  const essCost = inputs.price(essence.essenceApiId);
  const tierBit = essence.guaranteedValue
    ? ` (guarantees ${essence.guaranteedValue})`
    : "";
  steps.push({
    n: n++,
    title: `Use ${essence.essenceName} to guarantee "${lead.label}"${tierBit}`,
    detail: essenceStepDetail(essence, lead.label),
    currency: essence.essenceName,
    odds: 1,
    costExalted: round(essCost),
  });
  cost += essCost;

  // Desecrate-unveil the second mod on its own side.
  const useEchoes = allTargets.length >= 3;
  const necroApi =
    desecTarget.generationType === "prefix"
      ? "omen-of-sinistral-necromancy"
      : "omen-of-dextral-necromancy";
  const necroName =
    desecTarget.generationType === "prefix"
      ? "Omen of Sinistral Necromancy"
      : "Omen of Dextral Necromancy";
  const ancientApi = `ancient-${boneInfo.boneApi}`;
  const k = useEchoes ? 5 : 3;
  const do0 = desecTarget.oddsFresh;
  const desecOdds = do0 > 0 ? Math.min(1, 1 - Math.pow(1 - do0, k)) : 0;
  const desecAttempts = oddsToAttempts(desecOdds);
  const echoesPrice = useEchoes ? inputs.price("omen-of-abyssal-echoes") : 0;
  const perDesec =
    inputs.price(ancientApi) + inputs.price(necroApi) + echoesPrice;
  const desecCost = Number.isFinite(desecAttempts)
    ? desecAttempts * perDesec
    : 0;
  cost += desecCost;
  steps.push({
    n: n++,
    title: `Desecrate-unveil "${desecTarget.label}" (${desecTarget.generationType})`,
    detail: `Apply an Ancient ${boneInfo.bone} with ${necroName} to add a hidden desecrated ${desecTarget.generationType}${
      useEchoes
        ? ", and an Omen of Abyssal Echoes to reveal more options"
        : ""
    }, then reveal at the Well of Souls and pick "${desecTarget.label}" from the ${k} choices. Re-desecrate if it isn't offered.`,
    currency: `Ancient ${boneInfo.bone}`,
    odds: desecOdds,
    expectedAttempts: Number.isFinite(desecAttempts)
      ? Math.max(1, Math.ceil(desecAttempts))
      : undefined,
    costExalted: round(desecCost),
  });

  // Fill the remaining open slots with Exalt + Greater Exaltation double-slam.
  const prePlaced = {
    pre: new Set(
      [lead, desecTarget]
        .filter((t) => t.generationType === "prefix")
        .map((t) => t.group),
    ),
    suf: new Set(
      [lead, desecTarget]
        .filter((t) => t.generationType === "suffix")
        .map((t) => t.group),
    ),
  };
  // The essence + desecrated mods are placed before the last slots, and the
  // last two go into OPEN slots via a double-slam, so they aren't risked by
  // Annul cleanup — treat them as protected for brick modeling.
  const fill = fillByExalt(inputs, rest, n, steps, prePlaced, prePlaced);
  n = fill.n;
  cost += fill.cost;
  if (rest.length >= 2) {
    steps.push({
      n: n++,
      title: "Use Omen of Greater Exaltation for the last two",
      detail:
        "With two open slots left, an Omen of Greater Exaltation makes one Exalt add both at once (each high-tier biased), avoiding any Annul cleanup.",
      currency: "Omen of Greater Exaltation",
    });
    cost += inputs.price("omen-of-greater-exaltation");
  }

  const fixedGroups = essence.isFixedValue
    ? new Set([lead.group])
    : new Set<string>();
  const div = divineStep(inputs, allTargets, n, fixedGroups);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "essence-desec-exalt",
    name: "Essence + Desecrate + Double-Exalt",
    summary: `Guarantee "${lead.label}" with ${essence.essenceName}, desecrate-unveil "${desecTarget.label}", then double-Exalt the rest.`,
    steps,
    feasible: true,
    overallOdds: desecOdds * (rest.length ? fill.odds : 1),
    estCostExalted: round(cost),
    costApproximate: true,
    pros: [
      "Locks the hardest mod deterministically (right tier via Greater/Perfect essence).",
      "Desecrate gives a choice of options for the second mod.",
      "Open-slot double-slam avoids Annul-cleanup brick risk.",
    ],
    cons: [
      "Needs Abyss bones + omens.",
      "Desecrated reveal is still a choice among random options.",
    ],
  };
}

function methodTransmuteRegalExalt(inputs: SolveInputs): CraftMethod | null {
  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;
  steps.push({
    n: n++,
    title: `Start with an item level ${inputs.itemLevel} ${inputs.baseName}`,
    detail: "Begin from a clean white (Normal) base at the highest item level.",
  });
  // Treat the two opening mods as random; target everything via Exalt for a
  // conservative, easy-to-reason estimate. Since those opening mods are
  // junk by assumption, plain orbs — Greater/Perfect would buy nothing.
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  const transOrb = TRANSMUTE_ORBS[0];
  const regalOrb = REGAL_ORBS[0];
  const transmute = inputs.price(transOrb.apiId);
  const regal = inputs.price(regalOrb.apiId);
  steps.push({
    n: n++,
    title: `${transOrb.name} then ${regalOrb.name} to reach Rare`,
    detail: `${transOrb.name} makes it Magic (1 random mod); ${regalOrb.name} upgrades it to Rare and adds another.${
      regalOrb.minLevel
        ? ` The Greater/Perfect tiers bias both added mods to modifier level ≥ ${regalOrb.minLevel}.`
        : ""
    } These mods are random — you'll direct the rest with Exalts.`,
    currency: regalOrb.name,
    costExalted: round(transmute + regal),
  });
  cost += transmute + regal;

  // Desecrated-only mods can't be slammed with Exalts — use Desecration / Magic-seed methods.
  const exaltTargets = allTargets.filter((t) => !t.desecrated);
  if (exaltTargets.length === 0) return null;
  const fill = fillByExalt(inputs, exaltTargets, n, steps);
  n = fill.n;
  cost += fill.cost;

  const div = divineStep(inputs, exaltTargets, n);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "transmute-regal-exalt",
    name: "Transmute → Regal → Exalt",
    summary: "Classic Magic → Rare ladder, then Exalt+Omen each target.",
    steps,
    feasible: true,
    overallOdds: fill.odds,
    estCostExalted: round(cost),
    costApproximate: false,
    pros: ["No essences needed.", "Works for any combination of mods."],
    cons: ["Every target is RNG — can be expensive for rare mods."],
  };
}

/**
 * Perfect-seed ladder (0.5 Greater/Perfect Magic orbs): Transmute toward the
 * hardest target, Augment toward the hardest opposite-side target, Regal to
 * Rare, then omen-Exalt the rest. Greater (55/44) and Perfect (70/70)
 * Transmute/Augment restrict the WHOLE roll pool to high modifier levels —
 * the orb tier for each step is chosen by expected cost, so the method
 * shines when high tiers are targeted on a high-ilvl base.
 */
function methodPerfectSeed(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  if (allTargets.length < 2) return null;
  if (allTargets.some((t) => t.desecrated)) return null;

  const seed1 = allTargets[0];
  const seed2 = allTargets.find(
    (t) => t !== seed1 && t.generationType !== seed1.generationType,
  );

  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;
  let overallOdds = 1;

  // Step 1 — Transmute ladder toward seed1 (retry: re-Transmute fresh bases).
  const trans = pickOrbByExpectedCost(TRANSMUTE_ORBS, inputs.price, (minLevel) =>
    magicHitOdds(inputs, seed1, minLevel),
  );
  if (trans.odds <= 0) return null;
  const transAttempts = oddsToAttempts(trans.odds);
  const transCost = transAttempts * inputs.price(trans.orb.apiId);
  cost += transCost;
  overallOdds *= trans.odds;
  steps.push({
    n: n++,
    title: `${trans.orb.name} fresh bases until Magic with "${seed1.label}"`,
    detail: `Apply a ${trans.orb.name} to a white ${inputs.baseName}${
      trans.orb.minLevel
        ? ` — it only rolls modifiers of level ≥ ${trans.orb.minLevel}, cutting the junk tiers out of the pool`
        : ""
    }. ~${(trans.odds * 100).toFixed(1)}% per orb to land "${seed1.label}"; re-Transmute a fresh base on a miss (~${
      Number.isFinite(transAttempts) ? Math.ceil(transAttempts) : "?"
    } tries).`,
    currency: trans.orb.name,
    odds: trans.odds,
    expectedAttempts: Number.isFinite(transAttempts)
      ? Math.max(1, Math.ceil(transAttempts))
      : undefined,
    costExalted: Number.isFinite(transCost) ? round(transCost) : undefined,
  });

  // Step 2 — Augment ladder toward seed2 (a miss fills the second Magic slot
  // with junk: the item is wasted and the craft restarts from step 1).
  if (seed2) {
    const aug = pickOrbByExpectedCost(AUGMENT_ORBS, inputs.price, (minLevel) =>
      augHitOdds(inputs, seed2, minLevel, {
        group: seed1.group,
        side: seed1.generationType,
      }),
    );
    if (aug.odds > 0) {
      const augUnit = inputs.price(aug.orb.apiId);
      cost += augUnit;
      overallOdds *= aug.odds;
      steps.push({
        n: n++,
        title: `${aug.orb.name} toward "${seed2.label}"`,
        detail: `One ${aug.orb.name} adds the second Magic modifier${
          aug.orb.minLevel ? ` at modifier level ≥ ${aug.orb.minLevel}` : ""
        } — ~${(aug.odds * 100).toFixed(1)}% to be "${seed2.label}". There is no Scouring Orb in PoE2: a miss fills the slot with junk, so the item is recycled and you restart from the Transmute step.`,
        currency: aug.orb.name,
        odds: aug.odds,
        costExalted: round(augUnit),
        // A miss can't be retried in place — the pass restarts.
        brickOdds: 1,
      });
    }
  }

  // Step 3 — Regal to Rare. The added mod is random filler (remaining
  // targets land via Exalts), so the plain Regal is the right spend.
  const seeds = seed2 ? [seed1, seed2] : [seed1];
  const rest = allTargets.filter((t) => !seeds.includes(t));
  const regalOrb = REGAL_ORBS[0];
  const regalCost = inputs.price(regalOrb.apiId);
  cost += regalCost;
  steps.push({
    n: n++,
    title: `${regalOrb.name} to Rare`,
    detail: `Upgrades the Magic item to Rare, keeping both seeded mods and adding one random modifier${
      regalOrb.minLevel ? ` at modifier level ≥ ${regalOrb.minLevel}` : ""
    }.`,
    currency: regalOrb.name,
    costExalted: round(regalCost),
  });

  // Step 4 — remaining targets via Exalt + omens.
  const prePlaced = {
    pre: new Set(
      seeds.filter((t) => t.generationType === "prefix").map((t) => t.group),
    ),
    suf: new Set(
      seeds.filter((t) => t.generationType === "suffix").map((t) => t.group),
    ),
  };
  const fill = fillByExalt(inputs, rest, n, steps, prePlaced);
  n = fill.n;
  cost += fill.cost;
  overallOdds *= fill.odds;

  const div = divineStep(inputs, allTargets, n);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  const usedPerfect = [trans.orb.minLevel].some((l) => l >= 55);
  return {
    id: "perfect-seed",
    name: "Perfect seed (G/P Transmute + Augment)",
    summary: seed2
      ? `Seed "${seed1.label}" + "${seed2.label}" on Magic with high-tier orbs, Regal, then Exalt the rest.`
      : `Seed "${seed1.label}" on Magic with high-tier orbs, Regal, then Exalt the rest.`,
    steps,
    feasible: true,
    overallOdds,
    estCostExalted: round(cost),
    costApproximate: false,
    pros: [
      usedPerfect
        ? "Greater/Perfect Magic orbs roll ONLY high-level modifiers — far better odds per orb for top tiers."
        : "Cheap Magic-item setup before the expensive Rare steps.",
      "Both seed mods are settled before any Exalt is spent.",
    ],
    cons: [
      seed2
        ? "An Augmentation miss wastes the item (no Scouring Orb in PoE2)."
        : "Only one mod can be seeded — the rest is Exalt RNG.",
      "Perfect orbs are pricey; only worth it for genuinely high-tier targets.",
    ],
  };
}

function methodAlchemyChaos(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes];
  // Chaos removes one random mod and adds one random mod — any unprotected mod
  // can be wiped on the next Chaos, so this path only models a single target.
  if (allTargets.length !== 1) return null;

  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;
  const alch = inputs.price("alch");
  const chaos = inputs.price("chaos");
  steps.push({
    n: n++,
    title: `Orb of Alchemy on an item level ${inputs.itemLevel} ${inputs.baseName}`,
    detail:
      "Alchemy turns a Normal base straight into a Rare with several random mods.",
    currency: "Orb of Alchemy",
    costExalted: round(alch),
  });
  cost += alch;

  const t = allTargets[0];
  const sideGroups =
    t.generationType === "prefix" ? inputs.preGroups : inputs.sufGroups;
  const { orb: chaosOrb, odds: o } = pickOrbByExpectedCost(
    CHAOS_ORBS,
    inputs.price,
    (minLevel) => {
      const num = targetNumerator(sideGroups, t, minLevel);
      const den = typeWeightAtLevel(sideGroups, minLevel);
      return den > 0 ? Math.min(1, num / den) : 0;
    },
  );
  const chaosUnit = inputs.price(chaosOrb.apiId) || chaos;
  const attempts = oddsToAttempts(o);
  const stepCost = Number.isFinite(attempts) ? attempts * chaosUnit : 0;
  cost += stepCost;
  steps.push({
    n: n++,
    title: `${chaosOrb.name} toward "${t.label}"`,
    detail: `${chaosOrb.name} removes one random mod and adds one random mod${
      chaosOrb.minLevel ? ` (biased to modifier level ≥ ${chaosOrb.minLevel})` : ""
    }. It can land a single target, but every subsequent Chaos can overwrite it — use Fracture, Essence, or Exalt+Omen when you need more than one mod.`,
    currency: chaosOrb.name,
    odds: o,
    expectedAttempts: Number.isFinite(attempts)
      ? Math.max(1, Math.ceil(attempts))
      : undefined,
    costExalted: Number.isFinite(stepCost) ? round(stepCost) : undefined,
  });

  return {
    id: "alchemy-chaos",
    name: "Alchemy + Chaos",
    summary: `Alch to Rare then Chaos-cycle for a single mod ("${t.label}").`,
    steps,
    feasible: true,
    overallOdds: o,
    estCostExalted: round(cost),
    costApproximate: true,
    pros: ["Cheap to start.", "Good when you only need one common mod."],
    cons: [
      "Low control — Chaos swaps are random.",
      "Not viable for multi-mod goals — each Chaos can erase a finished mod.",
    ],
  };
}

/* Abyssal bone mapping moved to ./registry (shared with the simulator). */

function methodMagicSeedEssence(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  if (allTargets.length < 2) return null;

  const boneInfo = BONE_BY_CLASS.find((b) => b.test(inputs.itemClass));

  // Hardest mod that must be rolled on Magic (not essence-guaranteeable, not desecrated-only).
  const rollTargets = allTargets.filter(
    (t) => !t.desecrated && !essenceGuaranteeable(inputs, t),
  );
  const essenceTargets = allTargets.filter(
    (t) => !t.desecrated && essenceGuaranteeable(inputs, t),
  );
  if (rollTargets.length === 0 || essenceTargets.length === 0) return null;

  const seed = rollTargets[0];
  const essenceTarget =
    essenceTargets.find((t) => t.generationType !== seed.generationType) ??
    essenceTargets.sort((a, b) => a.oddsFresh - b.oddsFresh)[0];
  const essence = bestEssenceForTarget(inputs, essenceTarget)!;

  // 0.5: an item can carry at most one Desecrated modifier.
  const desecTargets = allTargets
    .filter(
      (t) =>
        t.desecrated &&
        t.group !== seed.group &&
        t.group !== essenceTarget.group,
    )
    .slice(0, MAX_DESECRATED_MODS);
  const normalRest = allTargets.filter(
    (t) =>
      !t.desecrated &&
      t.group !== seed.group &&
      t.group !== essenceTarget.group,
  );
  if (desecTargets.length > 0 && !boneInfo) return null;

  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;
  let overallOdds = 1;

  // Orb tier chosen by expected cost: Greater/Perfect Transmutes restrict the
  // pool to high modifier levels, often hitting the seed far more cheaply.
  const { orb: transOrb, odds: magicOdds } = pickOrbByExpectedCost(
    TRANSMUTE_ORBS,
    inputs.price,
    (minLevel) => magicHitOdds(inputs, seed, minLevel),
  );
  const magicAttempts = oddsToAttempts(magicOdds);
  const transUnit = inputs.price(transOrb.apiId);
  const magicCost = Number.isFinite(magicAttempts)
    ? magicAttempts * transUnit
    : 0;
  cost += magicCost;
  overallOdds *= magicOdds;
  steps.push({
    n: n++,
    title: `${transOrb.name} until Magic with "${seed.label}"`,
    detail: `Transmute a white ${inputs.baseName} until Magic with "${seed.label}" (~${Math.round(
      magicOdds * 1000,
    ) / 10}% per orb, expect ~${Number.isFinite(magicAttempts) ? Math.ceil(magicAttempts) : "?"} tries). Or buy a Magic item that already has this mod — often cheaper for rare prefixes like T1 movement speed.`,
    currency: transOrb.name,
    odds: magicOdds,
    expectedAttempts: Number.isFinite(magicAttempts)
      ? Math.max(1, Math.ceil(magicAttempts))
      : undefined,
    costExalted: Number.isFinite(magicCost) ? round(magicCost) : undefined,
  });

  const essCost = inputs.price(essence.essenceApiId);
  const tierBit = essence.guaranteedValue
    ? ` (guarantees ${essence.guaranteedValue})`
    : "";
  steps.push({
    n: n++,
    title: `Use ${essence.essenceName} on the Magic item${tierBit}`,
    detail: `${essence.essenceName} upgrades Magic → Rare while keeping "${seed.label}" and adding "${essenceTarget.label}" deterministically — two of your targets done before any Exalt slams.`,
    currency: essence.essenceName,
    odds: 1,
    costExalted: round(essCost),
  });
  cost += essCost;

  const prePlaced = {
    pre: new Set<string>(),
    suf: new Set<string>(),
  };
  const protect = {
    pre: new Set<string>(),
    suf: new Set<string>(),
  };
  if (seed.generationType === "prefix") prePlaced.pre.add(seed.group);
  else prePlaced.suf.add(seed.group);
  if (essenceTarget.generationType === "prefix") prePlaced.pre.add(essenceTarget.group);
  else prePlaced.suf.add(essenceTarget.group);

  // Before Abyss desecration, fracture the seed so Abyss can't strip it (only
  // the essence mod is removable). With 2 mods this is 1/2 per orb.
  let reslamEssence = false;
  if (desecTargets.length > 0) {
    const fracture = inputs.price("fracturing-orb");
    const fractureOdds = 1 / 2;
    const fractureAttempts = Math.ceil(1 / fractureOdds);
    const fractureCost = fractureAttempts * fracture;
    cost += fractureCost;
    overallOdds *= fractureOdds;
    steps.push({
      n: n++,
      title: `Fracture "${seed.label}" (~50% per orb)`,
      detail: `With "${seed.label}" + "${essenceTarget.label}" on the item, a Fracturing Orb has a 1-in-2 chance to lock your seed mod. Once fractured, Essence of the Abyss can only remove the essence-added mod — not your movement speed.`,
      currency: "Fracturing Orb",
      odds: fractureOdds,
      expectedAttempts: fractureAttempts,
      costExalted: round(fractureCost),
    });
    if (seed.generationType === "prefix") protect.pre.add(seed.group);
    else protect.suf.add(seed.group);
    reslamEssence = true;
  }

  for (const dt of desecTargets) {
    const desec = appendDesecrateSteps(
      inputs,
      dt,
      boneInfo!,
      n,
      steps,
      { useEchoes: allTargets.length >= 3, includeAbyss: true },
    );
    n = desec.n;
    cost += desec.cost;
    overallOdds *= desec.odds;
    if (dt.generationType === "prefix") prePlaced.pre.add(dt.group);
    else prePlaced.suf.add(dt.group);
  }

  const exaltTargets = [
    ...normalRest,
    ...(reslamEssence ? [essenceTarget] : []),
  ];
  const fill = fillByExalt(
    inputs,
    exaltTargets,
    n,
    steps,
    prePlaced,
    protect,
  );
  n = fill.n;
  cost += fill.cost;
  overallOdds *= fill.odds;

  const fixedGroups = essence.isFixedValue
    ? new Set([essenceTarget.group])
    : new Set<string>();
  const div = divineStep(inputs, allTargets, n, fixedGroups);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "magic-seed-essence",
    name: "Magic seed + Essence finish",
    summary: `Roll Magic "${seed.label}", ${essence.essenceName} for "${essenceTarget.label}", then ${desecTargets.length ? "desecrate + " : ""}fill the rest.`,
    steps,
    feasible: true,
    overallOdds,
    estCostExalted: round(cost),
    costApproximate: true,
    pros: [
      "Front-loads the hardest RNG on a cheap Magic base.",
      "Essence deterministically adds a second target before Exalt/Desecrate.",
      desecTargets.length
        ? "Fracturing the seed before Abyss keeps your key mod safe."
        : "Avoids blind Exalt slams for essence-guaranteeable mods.",
    ],
    cons: [
      "Magic rolling can take many Transmutes for ultra-rare mods.",
      desecTargets.length ? "Fracturing before desecration still has ~50% miss odds." : "Needs a suitable essence for one target.",
    ],
  };
}

function methodBuyMagicBase(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  if (allTargets.length < 2) return null;
  // Buy a Magic item already carrying the two hardest mods (one prefix + one
  // suffix ideally), then Regal + Exalt the rest.
  const hard = allTargets.slice(0, 2);
  const rest = allTargets.slice(2);
  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;

  const quote = inputs.basePrices?.magicHard ?? null;
  steps.push({
    n: n++,
    title: `Buy a Magic ${inputs.baseName} with ${hard
      .map((t) => `"${t.label}"`)
      .join(" + ")}`,
    detail: quote
      ? `Trade for a Magic item that already rolls your hardest mods — this sidesteps the rarest RNG. ${quote.sampleCount} priced listing${quote.sampleCount === 1 ? "" : "s"} found; cheapest go for ~${round(quote.priceExalted)} ex.`
      : "Trade for a Magic item that already rolls your hardest mods. This sidesteps the rarest RNG. No live listing price was available, so this cost is approximate.",
    costExalted: quote ? round(quote.priceExalted) : undefined,
    link: quote
      ? { href: quote.tradeUrl, label: "View listings on trade" }
      : undefined,
  });
  if (quote) cost += quote.priceExalted;

  const regal = inputs.price("regal");
  steps.push({
    n: n++,
    title: "Regal Orb to Rare",
    detail: "Upgrade the bought Magic item to Rare, preserving the hard mods.",
    currency: "Regal Orb",
    costExalted: round(regal),
  });
  cost += regal;

  // Hard mods already present; fill the rest by Exalt.
  const prePlaced = {
    pre: new Set(hard.filter((t) => t.generationType === "prefix").map((t) => t.group)),
    suf: new Set(hard.filter((t) => t.generationType === "suffix").map((t) => t.group)),
  };
  const fill = fillByExalt(inputs, rest, n, steps, prePlaced);
  n = fill.n;
  cost += fill.cost;

  const div = divineStep(inputs, allTargets, n);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "buy-magic-base",
    name: "Buy Magic base + Regal",
    summary: `Buy a Magic ${inputs.baseName} with the hard mods, Regal, then Exalt the rest.`,
    steps,
    feasible: true,
    overallOdds: rest.length ? fill.odds : 1,
    estCostExalted: round(cost),
    costApproximate: true,
    excludesMarketPrice: !quote,
    pros: [
      "Skips the rarest RNG entirely.",
      "Great when a key mod is hard to hit.",
      ...(quote ? ["Live listing price from the trade site included."] : []),
    ],
    cons: [
      "Relies on a suitable Magic item being for sale.",
      ...(quote
        ? []
        : ["Listing price not included — true cost is higher."]),
    ],
  };
}

/**
 * Fractured-base deterministic recipe (amulet/quiver style): start from a base
 * with the key mod already fractured, Whittle-annul down to isolate it, then
 * finish the open slots deterministically — Essence + Crystallisation for
 * guaranteeable mods, directional Exalts for the rest, then catalyst/Vaal.
 */
function methodFracturedBase(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  if (allTargets.length < 2) return null;

  const key = allTargets[0];
  const rest = allTargets.slice(1);
  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;

  const fracturedQuote = inputs.basePrices?.fracturedKey ?? null;
  const fracture = inputs.price("fracturing-orb");
  const acquireCost = fracturedQuote?.priceExalted ?? fracture;
  steps.push({
    n: n++,
    title: `Buy or fracture a ${inputs.baseName} with "${key.label}" fractured`,
    detail: fracturedQuote
      ? `Acquire a base whose key mod is already fractured (locked, can't be removed). ${fracturedQuote.sampleCount} priced listing${fracturedQuote.sampleCount === 1 ? "" : "s"} found — cheapest go for ~${round(fracturedQuote.priceExalted)} ex on trade.`
      : "Acquire a base whose key mod is already fractured (locked, can't be removed). Buying a ready fractured base is often cheaper than rolling + fracturing yourself; no live listing price was available, so only the Fracturing Orb is costed.",
    currency: fracturedQuote ? undefined : "Fracturing Orb",
    costExalted: round(acquireCost),
    link: fracturedQuote
      ? { href: fracturedQuote.tradeUrl, label: "View fractured bases on trade" }
      : undefined,
  });
  cost += acquireCost;

  const annul = inputs.price("annul");
  const whittle = inputs.price("omen-of-whittling");
  const junk = 3;
  const whittleCost = junk * (annul + whittle);
  steps.push({
    n: n++,
    title: "Whittle-annul down to the fractured mod",
    detail: `Pair Orb of Annulment with an Omen of Whittling so each Annul removes the LOWEST modifier level on the item — near-deterministically stripping junk while the fractured "${key.label}" is safe. Clear down to the fractured mod + open slots (~${junk} Annuls).`,
    currency: "Omen of Whittling",
    expectedAttempts: junk,
    costExalted: round(whittleCost),
  });
  cost += whittleCost;

  const prePlaced = {
    pre: new Set(key.generationType === "prefix" ? [key.group] : []),
    suf: new Set(key.generationType === "suffix" ? [key.group] : []),
  };
  // The fractured key can't be Annulled away.
  const protect = {
    pre: new Set(key.generationType === "prefix" ? [key.group] : []),
    suf: new Set(key.generationType === "suffix" ? [key.group] : []),
  };

  // Deterministic add first (Essence + directional Crystallisation), then the
  // remaining targets via directional Exalt. 0.5 caps items at ONE crafted
  // modifier, so only a single essence may be used — the hardest
  // essence-guaranteeable target gets the crafted slot, the rest are Exalted.
  const essAble = rest.filter((t) => essenceGuaranteeable(inputs, t));
  const essTargets = essAble.slice(0, 1);
  const exaltTargets = rest.filter((t) => !essTargets.includes(t));
  const fixedGroups = new Set<string>();
  for (const t of essTargets) {
    const ess = bestEssenceForTarget(inputs, t)!;
    if (ess.isFixedValue) fixedGroups.add(t.group);
    const essCost = inputs.price(ess.essenceApiId);
    const cs = crystallisationStep(t.generationType, ess.essenceName, n, inputs.price);
    steps.push(cs.step);
    n++;
    cost += cs.cost + essCost;
    // Crystallisation adds to an open side deterministically; treat as safe.
    if (t.generationType === "prefix") {
      prePlaced.pre.add(t.group);
      protect.pre.add(t.group);
    } else {
      prePlaced.suf.add(t.group);
      protect.suf.add(t.group);
    }
  }

  const fill = fillByExalt(inputs, exaltTargets, n, steps, prePlaced, protect);
  n = fill.n;
  cost += fill.cost;

  const cat = catalystStep(inputs.itemClass, allTargets, n, inputs.price);
  if (cat) {
    steps.push(cat.step);
    n++;
    cost += cat.cost;
  }

  const corr = corruptionStep(n, inputs.price);
  steps.push(corr.step);
  n++;
  cost += corr.cost;

  const div = divineStep(inputs, allTargets, n, fixedGroups);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "fractured-base",
    name: "Fractured base (deterministic)",
    summary: `Start from a fractured "${key.label}", Whittle down, then finish slots with Essence+Crystallisation and Exalts.`,
    steps,
    feasible: true,
    overallOdds: exaltTargets.length ? fill.odds : 1,
    estCostExalted: round(cost),
    costApproximate: true,
    excludesMarketPrice: !fracturedQuote,
    pros: [
      ...(fracturedQuote
        ? ["Live fractured-base listing price from the trade site included."]
        : []),
      "Key mod is fractured — safe from every later Annul/Chaos.",
      "Whittling makes the annul-down near-deterministic.",
      "Essence + Crystallisation adds a mod to a chosen side with no brick.",
    ],
    cons: [
      "Needs a suitable fractured base (buy or roll one first).",
      "Fracturing Orbs and directional omens are expensive.",
      RULE_05_SUMMARY,
    ],
  };
}

function methodFractureChaos(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  if (allTargets.length < 2) return null;
  const key = allTargets[0];
  const rest = allTargets.slice(1);

  const boneInfo = BONE_BY_CLASS.find((b) => b.test(inputs.itemClass));

  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;

  const alch = inputs.price("alch");
  steps.push({
    n: n++,
    title: `Roll a Rare ${inputs.baseName} holding "${key.label}" + 3 filler mods`,
    detail:
      "Alchemy/Chaos to a Rare with your key mod present and 4 modifiers total (the minimum a Fracturing Orb needs).",
    currency: "Orb of Alchemy",
    costExalted: round(alch),
  });
  cost += alch;

  // Fracturing hits a random non-desecrated mod. Converting one filler into an
  // unrevealed desecrated mod (Essence of the Abyss -> Mark -> Desecrate, left
  // unrevealed) makes it non-fracturable but still count to 4, so a 4-mod item
  // has only 3 fracturable mods -> 1/3 to hit the key mod instead of 1/4.
  let fractureOdds = 1 / 4;
  const useAbyssMark = Boolean(boneInfo);
  if (useAbyssMark && boneInfo) {
    const abyssEss = inputs.price("essence-of-the-abyss");
    steps.push({
      n: n++,
      title: "Essence of the Abyss → Mark of the Abyssal Lord",
      detail:
        "Removes a random mod (ideally a filler) and adds the Mark of the Abyssal Lord, which becomes a desecrated mod next.",
      currency: "Essence of the Abyss",
      costExalted: round(abyssEss),
    });
    cost += abyssEss;

    const preservedApi = `preserved-${boneInfo.boneApi}`;
    const bonePrice = inputs.price(preservedApi);
    steps.push({
      n: n++,
      title: `Desecrate with a Preserved ${boneInfo.bone} — DO NOT reveal it`,
      detail:
        "The Preserved bone removes the Mark first and adds an UNREVEALED desecrated mod. Leave it unrevealed: desecrated mods can't be fractured but still count toward the 4-mod minimum, so only your 3 normal mods are fracturable.",
      currency: `Preserved ${boneInfo.bone}`,
      costExalted: round(bonePrice),
    });
    cost += bonePrice;
    fractureOdds = 1 / 3;
  }

  const fracture = inputs.price("fracturing-orb");
  const fractureAttempts = Math.ceil(1 / fractureOdds);
  const fractureCost = fractureAttempts * fracture;
  steps.push({
    n: n++,
    title: `Fracture "${key.label}" (~${Math.round(fractureOdds * 100)}% per orb)`,
    detail: `A Fracturing Orb locks one RANDOM fracturable mod. With ${
      useAbyssMark ? "the unrevealed desecrated mod present (3 fracturable)" : "4 fracturable mods"
    }, each orb has a ~1/${Math.round(1 / fractureOdds)} chance to hit the key mod. If it locks the wrong mod, start over.`,
    currency: "Fracturing Orb",
    odds: fractureOdds,
    expectedAttempts: fractureAttempts,
    costExalted: round(fractureCost),
  });
  cost += fractureCost;

  const annul = inputs.price("annul");
  const fillerCount = 3;
  const expectedAnnuls = expectedRandomAnnuls(fillerCount);
  steps.push({
    n: n++,
    title: "Annul filler mods, then Exalt+Omen for the rest",
    detail: useAbyssMark
      ? `With "${key.label}" fractured (safe from Annul/Chaos), clear the ${fillerCount} filler mods — Annul removes a random non-fractured mod unless you use Sinistral/Dextral Annulment omens (still random within that side). Expect ~${expectedAnnuls} Annuls to clear ${fillerCount} fillers. Then Exalt+Omen the remaining targets. Finally, reveal the desecrated mod at the Well of Souls (choice of 3).`
      : `With "${key.label}" fractured (safe from Annul/Chaos), clear the ${fillerCount} filler mods — Annul removes a random non-fractured mod unless you use Sinistral/Dextral Annulment omens (still random within that side). Expect ~${expectedAnnuls} Annuls to clear ${fillerCount} fillers, then Exalt+Omen the remaining targets.`,
    currency: "Orb of Annulment",
    expectedAttempts: Math.ceil(expectedAnnuls),
    costExalted: round(expectedAnnuls * annul),
  });
  cost += expectedAnnuls * annul;

  // Remaining targets via Exalt+Omen, key already fracture-locked (protected).
  const prePlaced = {
    pre: new Set(key.generationType === "prefix" ? [key.group] : []),
    suf: new Set(key.generationType === "suffix" ? [key.group] : []),
  };
  const fill = fillByExalt(
    inputs,
    rest.filter((t) => t.group !== key.group),
    n,
    steps,
    prePlaced,
    prePlaced,
  );
  n = fill.n;
  cost += fill.cost;

  const div = divineStep(inputs, allTargets, n);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "fracture-chaos",
    name: useAbyssMark ? "Abyss-Mark Fracture (1/3)" : "Fracture + Exalt",
    summary: useAbyssMark
      ? `Add an unrevealed desecrated mod so fracturing "${key.label}" is 1/3 instead of 1/4, lock it, then finish freely.`
      : `Lock "${key.label}" with a Fracturing Orb, then finish the rest safely.`,
    steps,
    feasible: true,
    overallOdds: (rest.length ? fill.odds : 1) * fractureOdds,
    estCostExalted: round(cost),
    costApproximate: true,
    pros: [
      "Protects your best mod permanently (can't be removed or Divine-rerolled).",
      ...(useAbyssMark
        ? ["Desecrated mod raises fracture odds to 1/3 and adds a non-craftable mod."]
        : []),
    ],
    cons: [
      "Fracturing Orbs are expensive; expect multiple attempts.",
      useAbyssMark
        ? "Fracture still targets a random mod (~1/3) — not guaranteed."
        : "Fracture targets a random mod (~1/4 with 4 mods) — not guaranteed.",
    ],
  };
}

/* ----------------------------- desecration ----------------------------- */

function methodDesecration(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  if (allTargets.length === 0) return null;
  const boneInfo = BONE_BY_CLASS.find((b) => b.test(inputs.itemClass));
  if (!boneInfo) return null;

  const lead = allTargets[0];
  const rest = allTargets.slice(1);
  const steps: CraftStep[] = [];
  let n = 1;
  let cost = 0;

  const alch = inputs.price("alch");
  steps.push({
    n: n++,
    title: `Get a Rare ${inputs.baseName} with your easy mods`,
    detail:
      "Alchemy (or Transmute → Regal) to a Rare, ideally already holding the cheaper desired mods.",
    currency: "Orb of Alchemy",
    costExalted: round(alch),
  });
  cost += alch;

  const abyssEss = inputs.price("essence-of-the-abyss");
  steps.push({
    n: n++,
    title: "Essence of the Abyss → Mark of the Abyssal Lord",
    detail:
      "Removes a random mod and adds the Mark of the Abyssal Lord. The next desecration converts the Mark into a higher-tier desecrated modifier.",
    currency: "Essence of the Abyss",
    costExalted: round(abyssEss),
  });
  cost += abyssEss;

  const necroApi =
    lead.generationType === "prefix"
      ? "omen-of-sinistral-necromancy"
      : "omen-of-dextral-necromancy";
  const necroName =
    lead.generationType === "prefix"
      ? "Omen of Sinistral Necromancy"
      : "Omen of Dextral Necromancy";
  // Prefer Ancient bone (min mod level 40) for a stronger desecrated tier.
  const ancientApi = `ancient-${boneInfo.boneApi}`;
  const bonePrice = inputs.price(ancientApi);
  const necroPrice = inputs.price(necroApi);
  // Omen of Abyssal Echoes reveals more options (better than 1-of-3); Omen of
  // Light lets you re-roll the revealed choices if none is good.
  const useEchoes = rest.length >= 1;
  const echoesPrice = useEchoes ? inputs.price("omen-of-abyssal-echoes") : 0;
  const pickOdds = useEchoes ? 1 / 2 : 1 / 3;
  const pickAttempts = Math.ceil(1 / pickOdds);
  const desecUnit = bonePrice + necroPrice + echoesPrice;
  steps.push({
    n: n++,
    title: `Desecrate with an Ancient ${boneInfo.bone} (+ ${necroName})`,
    detail: `Apply the Ancient ${boneInfo.bone} to add a hidden desecrated ${lead.generationType} (the Necromancy omen forces the ${lead.generationType}; Ancient guarantees modifier level ≥ 40)${
      useEchoes
        ? ", and add an Omen of Abyssal Echoes to reveal more options"
        : ""
    }, then reveal at the Well of Souls and pick "${lead.label}". If none of the revealed options is good, an Omen of Light re-rolls the choices.`,
    currency: `Ancient ${boneInfo.bone}`,
    odds: pickOdds,
    expectedAttempts: pickAttempts,
    costExalted: round(desecUnit * pickAttempts),
  });
  cost += desecUnit * pickAttempts;

  const prePlaced = {
    pre: new Set(lead.generationType === "prefix" ? [lead.group] : []),
    suf: new Set(lead.generationType === "suffix" ? [lead.group] : []),
  };
  const fill = fillByExalt(inputs, rest, n, steps, prePlaced);
  n = fill.n;
  cost += fill.cost;

  const div = divineStep(inputs, allTargets, n);
  if (div) {
    steps.push(div.step);
    n++;
    cost += div.cost;
  }

  return {
    id: "desecration",
    name: "Desecration (Well of Souls)",
    summary: `Use Essence of the Abyss + an Ancient ${boneInfo.bone} to desecrate "${lead.label}" (choose 1 of 3), then Exalt the rest.`,
    steps,
    feasible: true,
    overallOdds: rest.length ? fill.odds : 1,
    estCostExalted: round(cost),
    costApproximate: true,
    pros: [
      "Access to powerful desecrated-only modifiers.",
      "The Well of Souls gives a choice of 3 — far better than a blind slam.",
      "Desecrated mods can be higher tier than normal crafting allows.",
    ],
    cons: [
      "Needs Abyss content for bones; Ancient bones are pricey.",
      "Revealed options are a choice of 3, not a guaranteed specific mod.",
    ],
  };
}

/**
 * Mass-slam: buy/roll many cheap bases and Exalt-slam each, keeping the winner.
 * Best for 1–2 mod goals on otherwise-open items. With two targets, an Omen of
 * Greater Exaltation adds both mods in a single slam (joint odds).
 */
function methodMassSlam(inputs: SolveInputs): CraftMethod | null {
  const EMPTY = new Set<string>();
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].sort(
    (a, b) => a.oddsFresh - b.oddsFresh,
  );
  // Mass-slam only makes sense for a small open-slot goal.
  if (allTargets.length === 0 || allTargets.length > 2) return null;

  // Per-target expected-cost orb choice (not "most restrictive allowed") —
  // the slam uses the orb picked for the hardest target.
  let joint = 1;
  let orb = EXALT_ORBS[0];
  for (const t of allTargets) {
    const r = targetExaltOdds(inputs, t, EMPTY, EMPTY);
    joint *= r.odds;
    if (r.orb.minLevel > orb.minLevel) orb = r.orb;
  }
  if (joint <= 0) return null;
  const orbPrice = inputs.price(orb.apiId);
  const double = allTargets.length === 2;
  const omenPrice = double ? inputs.price("omen-of-greater-exaltation") : 0;
  const perBaseCurrency = double ? orbPrice + omenPrice : orbPrice;
  const N = Math.min(2000, Math.max(1, Math.ceil(1 / joint)));
  const totalCurrency = N * perBaseCurrency;

  const steps: CraftStep[] = [];
  let n = 1;

  const quote = inputs.basePrices?.normal ?? null;
  const basesCost = quote ? N * quote.priceExalted : 0;
  steps.push({
    n: n++,
    title: `Acquire ~${N} cheap ${inputs.baseName} bases`,
    detail: quote
      ? `Buy a stack of white bases with the relevant slot(s) open — cheapest listings go for ~${round(quote.priceExalted)} ex each (~${round(basesCost)} ex for ${N}). Expected bases ≈ 1 / per-base odds; most will fail, so buy in bulk.`
      : "Buy or roll a stack of cheap white/magic bases with the relevant slot(s) open. Expected bases ≈ 1 / per-base odds; most will fail, so buy in bulk.",
    costExalted: quote ? round(basesCost) : undefined,
    link: quote
      ? { href: quote.tradeUrl, label: "Buy bases on trade" }
      : undefined,
  });

  if (double) {
    steps.push({
      n: n++,
      title: `Double-slam each with a ${orb.name} + Omen of Greater Exaltation`,
      detail: `The Omen makes one Exalt add TWO modifiers at once, both biased toward modifier level ≥ ${orb.minLevel}. Per base, the chance both targeted mods land is ~${(joint * 100).toFixed(2)}%.`,
      currency: "Omen of Greater Exaltation",
      odds: joint,
      expectedAttempts: N,
      costExalted: round(totalCurrency),
    });
  } else {
    steps.push({
      n: n++,
      title: `Slam each base with a ${orb.name}`,
      detail: `Each ${orb.name} adds one random mod (biased to modifier level ≥ ${orb.minLevel}); per base the targeted mod lands ~${(joint * 100).toFixed(2)}% of the time.`,
      currency: orb.name,
      odds: joint,
      expectedAttempts: N,
      costExalted: round(totalCurrency),
    });
  }

  steps.push({
    n: n++,
    title: "Keep the winner, recycle the rest",
    detail:
      "Statistically ~1 base in the batch lands the target(s). Salvage/vendor the failures or sell them on as rolled bases.",
  });

  return {
    id: "mass-slam",
    name: double ? "Mass double-slam" : "Mass slam",
    summary: `Slam ~${N} cheap bases with ${orb.name}${double ? " + Greater Exaltation" : ""} and keep the hit.`,
    steps,
    feasible: true,
    overallOdds: joint,
    estCostExalted: round(totalCurrency + basesCost),
    costApproximate: true,
    excludesMarketPrice: !quote,
    pros: [
      "Simple and parallel — no fragile multi-step sequence per item.",
      double
        ? "One double-slam lands two mods at once with high-tier bias."
        : "Cheapest per-attempt currency for a single open-slot mod.",
    ],
    cons: [
      "Throughput-heavy: you burn many bases to land one good item.",
      "Only practical for 1–2 mod goals on open slots.",
    ],
  };
}

/**
 * Remnant / Runic Recipe (0.5 league) — a high-level, fuzzy option for crafting
 * a chosen base via a high-slot Remnant. Presented as guidance, not exact math.
 */
function methodRemnant(inputs: SolveInputs): CraftMethod | null {
  const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes];
  if (allTargets.length === 0) return null;

  const steps: CraftStep[] = [
    {
      n: 1,
      title: "Find a high-slot Remnant",
      detail:
        "Remnants (0.5 Runes of Aldur) hold Runic Recipe slots. Higher-slot Remnants let you stack more recipes/rewards but spawn tougher waves.",
    },
    {
      n: 2,
      title: "Inscribe Runic Recipes toward your target",
      detail: `Slot recipes that bias rewards toward ${inputs.baseName} / your desired mods and toward Verisium and Alloys, which you then use to finish the item deterministically.`,
      currency: "Runic Recipe",
    },
    {
      n: 3,
      title: "Clear the encounter and collect",
      detail:
        "Survive the waves to bank the rewards (bases, Verisium, Alloys), then apply Alloys/Essences for the guaranteed mods.",
    },
  ];

  return {
    id: "remnant",
    name: "Remnant / Runic Recipe (0.5)",
    summary:
      "League encounter that funnels Verisium + Alloys toward a chosen base/mods. Fuzzy odds, league-only.",
    steps,
    feasible: true,
    overallOdds: 0,
    estCostExalted: null,
    costApproximate: true,
    excludesMarketPrice: true,
    pros: [
      "Generates the 0.5 crafting currencies (Verisium, Alloys) you need.",
      "Can be steered toward a specific base/mod via recipes.",
    ],
    cons: [
      "League-specific and removed at league end.",
      "Reward odds are fuzzy — treat cost as time/effort, not a precise number.",
    ],
  };
}

/* ----------------------------- public solver ----------------------------- */

async function buildInputs(
  baseId: string,
  itemLevel: number,
  desiredGroups: string[],
  priceMap: Map<string, number>,
): Promise<{
  inputs: SolveInputs;
  warnings: string[];
  feasible: boolean;
  poolMods: EligibleMod[];
} | null> {
  const pool = await getModPool(baseId, itemLevel);
  if (!pool) return null;

  const preMap = buildGroupMap(pool.prefixes);
  const sufMap = buildGroupMap(pool.suffixes);
  const preGroups = toTierGroups(pool.prefixes);
  const sufGroups = toTierGroups(pool.suffixes);
  const totalPre = pool.prefixTotalWeight;
  const totalSuf = pool.suffixTotalWeight;

  const warnings: string[] = [];
  const desiredPrefixes: DesiredMod[] = [];
  const desiredSuffixes: DesiredMod[] = [];

  for (const raw of desiredGroups) {
    // Entries may target a specific tier as "Group@<minLevel>" or "Group@<minLevel>~d".
    const [g, levelPart] = raw.split("@");
    const desecrated = levelPart?.endsWith("~d") ?? false;
    const tierLevel = levelPart
      ? Number.parseInt(levelPart.replace(/~d$/, ""), 10)
      : undefined;

    if (preMap.has(g)) {
      const info = preMap.get(g)!;
      const tiers = preGroups.get(g) ?? [];
      const num = groupWeightAtLevel(tiers, tierLevel ?? 0);
      const tierMod =
        tierLevel != null
          ? tiers.find((t) => t.requiredLevel === tierLevel) ??
            [...tiers]
              .filter((t) => t.requiredLevel >= tierLevel)
              .sort((a, b) => a.requiredLevel - b.requiredLevel)[0] ??
            tiers[0]
          : undefined;
      const tierValueStr = tierMod ? tierValue(tierMod) : undefined;
      desiredPrefixes.push({
        group: g,
        label: info.label,
        generationType: "prefix",
        weight: info.weight,
        oddsFresh: totalPre ? num / totalPre : 0,
        tierLevel,
        tierValue: tierValueStr,
        tierStatMax: tierMod?.stats[0]?.max,
        tierStatMin: tierMod?.stats[0]?.min,
        desecrated,
      });
    } else if (sufMap.has(g)) {
      const info = sufMap.get(g)!;
      const tiers = sufGroups.get(g) ?? [];
      const num = groupWeightAtLevel(tiers, tierLevel ?? 0);
      const tierMod =
        tierLevel != null
          ? tiers.find((t) => t.requiredLevel === tierLevel) ??
            [...tiers]
              .filter((t) => t.requiredLevel >= tierLevel)
              .sort((a, b) => a.requiredLevel - b.requiredLevel)[0] ??
            tiers[0]
          : undefined;
      const tierValueStr = tierMod ? tierValue(tierMod) : undefined;
      desiredSuffixes.push({
        group: g,
        label: info.label,
        generationType: "suffix",
        weight: info.weight,
        oddsFresh: totalSuf ? num / totalSuf : 0,
        tierLevel,
        tierValue: tierValueStr,
        tierStatMax: tierMod?.stats[0]?.max,
        tierStatMin: tierMod?.stats[0]?.min,
        desecrated,
      });
    } else {
      warnings.push(
        `"${g}" cannot roll on this base at item level ${itemLevel}.`,
      );
    }
  }

  // Flux conversion (0.5): when the targets include exactly one resistance
  // type, ANY elemental resistance roll is acceptable — a cheap Flux converts
  // it at the end (same tier, value rerolls). Annotate the target and fold
  // the surrogate groups' weight into its odds.
  const fluxPlan = resolveFlux(
    [...desiredPrefixes, ...desiredSuffixes].map((t) => t.group),
  );
  if (fluxPlan) {
    const t = [...desiredPrefixes, ...desiredSuffixes].find(
      (x) => x.group === fluxPlan.targetGroup,
    );
    if (t) {
      const groups = t.generationType === "prefix" ? preGroups : sufGroups;
      const total = t.generationType === "prefix" ? totalPre : totalSuf;
      const surrogates = fluxPlan.surrogateGroups.filter((g) => groups.has(g));
      if (surrogates.length > 0) {
        t.fluxGroups = surrogates;
        t.fluxApiId = fluxPlan.fluxApiId;
        t.fluxName = fluxPlan.fluxName;
        const num = targetNumerator(groups, t, 0);
        t.weight = num;
        t.oddsFresh = total ? Math.min(1, num / total) : 0;
      }
    }
  }

  let feasible = true;
  if (desiredPrefixes.length > MAX_AFFIXES_PER_TYPE) {
    warnings.push(
      `You selected ${desiredPrefixes.length} prefixes, but an item can have at most ${MAX_AFFIXES_PER_TYPE}.`,
    );
    feasible = false;
  }
  if (desiredSuffixes.length > MAX_AFFIXES_PER_TYPE) {
    warnings.push(
      `You selected ${desiredSuffixes.length} suffixes, but an item can have at most ${MAX_AFFIXES_PER_TYPE}.`,
    );
    feasible = false;
  }
  if (desiredPrefixes.length + desiredSuffixes.length === 0) {
    warnings.push("No valid target modifiers were selected for this base.");
    feasible = false;
  }

  // 0.5 per-item caps (1 crafted mod, 1 desecrated mod).
  const rule05 = validateTargets05([...desiredPrefixes, ...desiredSuffixes]);
  warnings.push(...rule05.warnings);
  if (!rule05.feasible) feasible = false;

  const determinism = resolveDeterminism(pool.base.itemClass, [
    ...pool.prefixes,
    ...pool.suffixes,
  ]);
  const alloys = resolveAlloys(pool.base.itemClass, [
    ...pool.prefixes,
    ...pool.suffixes,
  ]);

  for (const t of [...desiredPrefixes, ...desiredSuffixes]) {
    if (t.tierLevel == null) continue;
    const options = determinism.get(t.group);
    if (!options?.length) continue;
    if (options.some((e) => essenceReachesTarget(e, t))) continue;
    const best = [...options].sort(
      (a, b) => (b.guaranteedLevel ?? 0) - (a.guaranteedLevel ?? 0),
    )[0];
    const bestVal = best.guaranteedValue ?? best.modLabel;
    const targetVal = t.tierValue ?? `modifier level ${t.tierLevel}`;
    warnings.push(
      `No essence guarantees ${targetVal} on "${t.label}" — the best available is ${best.essenceName} (${bestVal}${best.isFixedValue ? ", fixed value" : ""}). Use Exalt/Chaos instead.`,
    );
  }

  const inputs: SolveInputs = {
    baseId,
    baseName: pool.base.name,
    itemClass: pool.base.itemClass,
    itemLevel,
    desiredPrefixes,
    desiredSuffixes,
    totalPre,
    totalSuf,
    preGroups,
    sufGroups,
    determinism,
    alloys,
    price: makePricer(priceMap),
  };

  return {
    inputs,
    warnings,
    feasible,
    poolMods: [...pool.prefixes, ...pool.suffixes],
  };
}

/**
 * Best-effort live base quotes from the trade site: a clean white base, and a
 * Magic base already carrying the two hardest target mods. Bounded by
 * timeouts and never throws — when trade is unreachable the solver simply
 * keeps its old "price not included" behavior.
 */
async function fetchBasePrices(
  inputs: SolveInputs,
  statMap: ModStatMap | null,
  priceMap: Map<string, number>,
  league: string | null,
): Promise<BasePriceBundle | undefined> {
  try {
    if (!league) return undefined;

    const allTargets = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes];
    const hard = pickHardTargets(allTargets);

    // Map the hard targets to trade stat ids (needed for the Magic search).
    let hardStatIds: string[] = [];
    if (allTargets.length >= 2 && statMap) {
      const perTarget = hard.map(
        (t) => statMap.groupToStats.get(t.group) ?? [],
      );
      if (perTarget.every((ids) => ids.length > 0)) {
        hardStatIds = perTarget.flat();
      }
    }

    // Fractured-base search: the hardest target's FRACTURED-type stat ids.
    const fracturedIds =
      statMap?.groupToFracturedStats.get(hard[0]?.group ?? "") ?? [];

    const [normal, magicHard, fracturedKey] = await Promise.all([
      withTimeout(
        getBasePrice({
          league,
          baseType: inputs.baseName,
          rarity: "normal",
          ilvlMin: inputs.itemLevel,
          priceMap,
        }),
        20000,
      ),
      hardStatIds.length > 0
        ? withTimeout(
            getBasePrice({
              league,
              baseType: inputs.baseName,
              rarity: "magic",
              ilvlMin: inputs.itemLevel,
              statIds: hardStatIds,
              priceMap,
            }),
            20000,
          )
        : Promise.resolve(null),
      fracturedIds.length > 0
        ? withTimeout(
            getBasePrice({
              league,
              baseType: inputs.baseName,
              rarity: "nonunique",
              ilvlMin: inputs.itemLevel,
              statIds: fracturedIds,
              priceMap,
            }),
            20000,
          )
        : Promise.resolve(null),
    ]);
    if (!normal && !magicHard && !fracturedKey) return undefined;
    return {
      normal: normal ?? null,
      magicHard: magicHard ?? null,
      fracturedKey: fracturedKey ?? null,
    };
  } catch {
    return undefined;
  }
}

// Methods that consume one clean white base per pass (its market price is
// added when a live quote is available, before risk inflation so restarts
// re-buy the base too).
const WHITE_BASE_METHODS = new Set([
  "magic-seed-essence",
  "essence-led",
  "essence-desec-exalt",
  "alloy-led",
  "transmute-regal-exalt",
  "perfect-seed",
  "alchemy-chaos",
  "fracture-chaos",
  "desecration",
]);

/**
 * When a target relies on Flux conversion, append the conversion step (before
 * the Divine step when present — Flux rerolls the value within the tier, so
 * Divine last). Costed at one Flux; it's only consumed when the resistance
 * landed as a different element.
 */
function appendFluxStep(method: CraftMethod, inputs: SolveInputs): CraftMethod {
  const fluxTarget = [
    ...inputs.desiredPrefixes,
    ...inputs.desiredSuffixes,
  ].find((t) => t.fluxApiId && t.fluxGroups?.length);
  if (!fluxTarget || method.steps.length === 0) return method;
  // Advisory-only methods (no cost model) don't get a flux line.
  if (method.estCostExalted == null) return method;

  const fluxPrice = inputs.price(fluxTarget.fluxApiId!);
  const fluxStep: CraftStep = {
    n: 0, // renumbered below
    title: `${fluxTarget.fluxName} if the resistance landed as another element`,
    detail: `Any elemental resistance counts while crafting — a ${fluxTarget.fluxName} converts every elemental resistance mod on the item to ${fluxTarget.label} at the SAME tier (the value rerolls within the tier). Skip this step if "${fluxTarget.label}" landed directly.`,
    currency: fluxTarget.fluxName,
    costExalted: round(fluxPrice),
  };
  const divIdx = method.steps.findIndex((s) =>
    s.title.startsWith("Divine to perfect"),
  );
  const steps =
    divIdx >= 0
      ? [
          ...method.steps.slice(0, divIdx),
          fluxStep,
          ...method.steps.slice(divIdx),
        ]
      : [...method.steps, fluxStep];
  return {
    ...method,
    steps: steps.map((s, i) => ({ ...s, n: i + 1 })),
    estCostExalted: round(method.estCostExalted + fluxPrice),
    pros: [
      ...method.pros,
      `Flux conversion: any elemental res counts (~${fluxTarget.fluxGroups!.length + 1}x the spawn weight for "${fluxTarget.label}").`,
    ],
  };
}

function includeWhiteBaseCost(
  method: CraftMethod,
  quote: BasePriceQuote | null | undefined,
): CraftMethod {
  if (!quote || !WHITE_BASE_METHODS.has(method.id)) return method;
  const first = method.steps[0];
  if (!first) return method;
  const steps = [
    {
      ...first,
      detail: `${first.detail} A white base goes for ~${round(quote.priceExalted)} ex on trade.`,
      costExalted: round((first.costExalted ?? 0) + quote.priceExalted),
      link: first.link ?? { href: quote.tradeUrl, label: "Buy a base on trade" },
    },
    ...method.steps.slice(1),
  ];
  return {
    ...method,
    steps,
    estCostExalted:
      method.estCostExalted == null
        ? method.estCostExalted
        : round(method.estCostExalted + quote.priceExalted),
  };
}

function buildMethods(inputs: SolveInputs): CraftMethod[] {
  const methods: (CraftMethod | null)[] = [
    methodMagicSeedEssence(inputs),
    methodEssenceLed(inputs),
    methodEssenceDesecExalt(inputs),
    methodAlloy(inputs),
    methodTransmuteRegalExalt(inputs),
    methodPerfectSeed(inputs),
    methodAlchemyChaos(inputs),
    methodBuyMagicBase(inputs),
    methodFracturedBase(inputs),
    methodFractureChaos(inputs),
    methodDesecration(inputs),
    methodMassSlam(inputs),
    methodRemnant(inputs),
  ];
  const feasible = methods
    .filter((m): m is CraftMethod => m !== null)
    .map((m) => appendFluxStep(m, inputs))
    .map((m) => includeWhiteBaseCost(m, inputs.basePrices?.normal))
    // Fold luck/brick risk into cost and annotate success/brick fields.
    .map((m) => withRisk(m));
  // Rank by estimated cost ascending. Methods whose estimate omits an unknown
  // market price (buying a base) sort last so they don't claim "cheapest".
  feasible.sort((a, b) => {
    const am = a.excludesMarketPrice ? 1 : 0;
    const bm = b.excludesMarketPrice ? 1 : 0;
    if (am !== bm) return am - bm;
    return (a.estCostExalted ?? Infinity) - (b.estCostExalted ?? Infinity);
  });
  return feasible;
}

/**
 * Builds several cost-ranked crafting methods to reach the desired modifier
 * groups on a specific base. Odds are approximate; costs are expected
 * attempts x live unit price (with conservative fallbacks).
 */
export async function solveFromBase(
  baseId: string,
  itemLevel: number,
  desiredGroups: string[],
): Promise<CraftPlan | null> {
  let priceMap: Map<string, number>;
  let divinePriceExalted = FALLBACK_PRICE.divine;
  try {
    const prices = await getPrices();
    priceMap = new Map(prices.items.map((i) => [i.apiId, i.priceExalted]));
    divinePriceExalted = prices.divinePrice || FALLBACK_PRICE.divine;
  } catch {
    priceMap = await getPriceByApiId();
  }
  // Alloys can be Runeforged from cheap runes — price them at min(buy, forge).
  applyForgeCosts(priceMap);
  const built = await buildInputs(baseId, itemLevel, desiredGroups, priceMap);
  if (!built) return null;
  const { inputs, warnings, feasible, poolMods } = built;

  let estimatedSale: CraftPlan["estimatedSale"] = null;
  if (feasible) {
    const league = await withTimeout(getCurrentLeagueName(), 5000);
    const statMap = league
      ? await withTimeout(buildModStatMap(poolMods), 10000)
      : null;
    inputs.basePrices = await fetchBasePrices(inputs, statMap, priceMap, league);

    // Estimated sale value of the finished item, from market samples.
    if (league && statMap) {
      try {
        const desired = [...inputs.desiredPrefixes, ...inputs.desiredSuffixes];
        const minLevelPerGroup = new Map<string, number>();
        for (const t of desired) {
          if (t.tierLevel != null && t.tierLevel > 0)
            minLevelPerGroup.set(t.group, t.tierLevel);
        }
        estimatedSale = await estimateSaleValue({
          league,
          itemClass: inputs.itemClass,
          groups: desired.map((t) => t.group),
          statIdsPerGroup: statMap.groupToStats,
          minLevelPerGroup,
        });
      } catch {
        /* sale estimate is optional */
      }
    }
  }

  const methods = (feasible ? buildMethods(inputs) : []).map((m) => ({
    ...m,
    expectedProfitExalted:
      estimatedSale && m.estCostExalted != null
        ? Math.round(estimatedSale.priceExalted - m.estCostExalted)
        : null,
  }));
  const cheapest = methods[0];

  // 0.5 league-system alternatives (Genesis Tree, Liquid Emotions,
  // Verisium Runeforging) that the orb cost model can't price directly.
  if (feasible) {
    warnings.push(
      ...leagueAdvice(
        inputs.itemClass,
        [...inputs.desiredPrefixes, ...inputs.desiredSuffixes].map(
          (t) => t.group,
        ),
      ),
    );
  }

  return {
    baseId,
    baseName: inputs.baseName,
    itemClass: inputs.itemClass,
    itemLevel,
    desiredPrefixes: inputs.desiredPrefixes,
    desiredSuffixes: inputs.desiredSuffixes,
    methods,
    warnings,
    feasible,
    steps: cheapest?.steps ?? [],
    overallOdds: cheapest?.overallOdds ?? 0,
    divinePriceExalted,
    estimatedSale,
  };
}

/**
 * Re-prices a saved plan's methods at today's currency prices, without any
 * trade calls (base purchase quotes are skipped). Returns method id ->
 * estimated cost; used to show cost drift on the Saved Plans page.
 */
export async function repriceMethods(
  baseId: string,
  itemLevel: number,
  desiredGroups: string[],
): Promise<Map<string, number | null> | null> {
  let priceMap: Map<string, number>;
  try {
    const prices = await getPrices();
    priceMap = new Map(prices.items.map((i) => [i.apiId, i.priceExalted]));
  } catch {
    priceMap = await getPriceByApiId();
  }
  const built = await buildInputs(baseId, itemLevel, desiredGroups, priceMap);
  if (!built || !built.feasible) return null;
  const methods = buildMethods(built.inputs);
  return new Map(methods.map((m) => [m.id, m.estCostExalted]));
}

/**
 * Computes the union of modifier groups available to an item class, for
 * populating the goal-first selector.
 */
export async function getClassPool(
  itemClass: string,
  itemLevel: number,
): Promise<ClassPool> {
  const bases = await searchBases({ itemClass, limit: 500 });
  const tagSet = new Set<string>();
  for (const b of bases) for (const t of b.tags) tagSet.add(t);

  const mods = await getEligibleMods([...tagSet], itemLevel);
  const prefixes = buildGroupChoices(
    mods.filter((m) => m.generationType === "prefix"),
    "prefix",
  );
  const suffixes = buildGroupChoices(
    mods.filter((m) => m.generationType === "suffix"),
    "suffix",
  );
  return { itemClass, itemLevel, prefixes, suffixes };
}

function buildGroupChoices(
  mods: EligibleMod[],
  generationType: "prefix" | "suffix",
): GroupChoice[] {
  const grouped = groupByModGroup(mods);
  return grouped.map((g) => ({
    group: g.group,
    label: modLabel(g.mods[0]),
    generationType,
    weight: g.weight,
    // g.mods is sorted highest-required-level first (best tier first).
    tiers: g.mods.map((m) => ({
      level: m.requiredLevel,
      value: tierValue(m),
      weight: m.weight,
    })),
    tags: notableTags(g.mods[0].implicitTags),
  }));
}

/**
 * Ranks the bases of an item class by how easily the desired modifier groups
 * can be hit, and attaches the cheapest feasible method cost per base.
 */
export async function recommendBases(
  itemClass: string,
  itemLevel: number,
  desiredGroups: string[],
  limit = 8,
): Promise<BaseRecommendation[]> {
  if (desiredGroups.length === 0) return [];
  const bases = await searchBases({ itemClass, limit: 500 });
  const priceMap = await getPriceByApiId();

  const recs: BaseRecommendation[] = [];
  for (const b of bases) {
    const pool = await getModPool(b.id, itemLevel);
    if (!pool) continue;
    const preMap = buildGroupMap(pool.prefixes);
    const sufMap = buildGroupMap(pool.suffixes);
    const totalPre = pool.prefixTotalWeight;
    const totalSuf = pool.suffixTotalWeight;

    let score = 1;
    const perGroup: { group: string; label: string; odds: number }[] = [];
    const missing: string[] = [];

    for (const g of desiredGroups) {
      if (preMap.has(g)) {
        const info = preMap.get(g)!;
        const odds = totalPre ? info.weight / totalPre : 0;
        score *= odds || 0.0001;
        perGroup.push({ group: g, label: info.label, odds });
      } else if (sufMap.has(g)) {
        const info = sufMap.get(g)!;
        const odds = totalSuf ? info.weight / totalSuf : 0;
        score *= odds || 0.0001;
        perGroup.push({ group: g, label: info.label, odds });
      } else {
        missing.push(g);
        score *= 0.0001;
      }
    }

    // Cheapest feasible method cost for this base (only when fully rollable).
    let cheapestCostExalted: number | null = null;
    let cheapestMethod: string | null = null;
    if (missing.length === 0) {
      const built = await buildInputs(b.id, itemLevel, desiredGroups, priceMap);
      if (built && built.feasible) {
        const methods = buildMethods(built.inputs);
        if (methods[0]) {
          cheapestCostExalted = methods[0].estCostExalted;
          cheapestMethod = methods[0].name;
        }
      }
    }

    recs.push({
      baseId: b.id,
      baseName: b.name,
      score,
      perGroup,
      missing,
      cheapestCostExalted,
      cheapestMethod,
    });
  }

  recs.sort((a, b) => {
    if (a.missing.length !== b.missing.length)
      return a.missing.length - b.missing.length;
    return b.score - a.score;
  });
  return recs.slice(0, limit);
}
