import type { Side } from "../types";
import {
  MAX_CRAFTED_MODS,
  MAX_DESECRATED_MODS,
  hasGroup,
  openSlots,
  type Item,
  type Mod,
} from "./state";
import { eligibleAt, type PoolGroup, type SimPool } from "./pool";
import type { Rng } from "./rng";

/** Orb strength: 0 = regular, 1 = Greater, 2 = Perfect. */
export type OrbTier = 0 | 1 | 2;
export type OrbKind = "transmute" | "augment" | "regal" | "exalt" | "chaos";

/** Minimum modifier level the added mod must have, per orb and tier (0.5). */
export const ORB_MIN_LEVEL: Record<OrbKind, [number, number, number]> = {
  transmute: [0, 55, 70],
  augment: [0, 44, 70],
  regal: [0, 35, 50],
  exalt: [0, 35, 50],
  chaos: [0, 35, 50],
};

const ORB_API: Record<OrbKind, [string, string, string]> = {
  transmute: ["transmute", "greater-orb-of-transmutation", "perfect-orb-of-transmutation"],
  augment: ["aug", "greater-orb-of-augmentation", "perfect-orb-of-augmentation"],
  regal: ["regal", "greater-regal-orb", "perfect-regal-orb"],
  exalt: ["exalted", "greater-exalted-orb", "perfect-exalted-orb"],
  chaos: ["chaos", "greater-chaos-orb", "perfect-chaos-orb"],
};

export function orbApiId(kind: OrbKind, tier: OrbTier): string {
  return ORB_API[kind][tier];
}

export const OMEN = {
  sinistralExalt: "omen-of-sinistral-exaltation",
  dextralExalt: "omen-of-dextral-exaltation",
  greaterExalt: "omen-of-greater-exaltation",
  sinistralAnnul: "omen-of-sinistral-annulment",
  dextralAnnul: "omen-of-dextral-annulment",
  sinistralNecro: "omen-of-sinistral-necromancy",
  dextralNecro: "omen-of-dextral-necromancy",
  echoes: "omen-of-abyssal-echoes",
} as const;

export const CURRENCY = {
  alchemy: "alch",
  annul: "annul",
  fracture: "fracturing-orb",
  abyss: "essence-of-the-abyss",
} as const;

export function exaltSideOmen(side: Side): string {
  return side === "prefix" ? OMEN.sinistralExalt : OMEN.dextralExalt;
}
export function annulSideOmen(side: Side): string {
  return side === "prefix" ? OMEN.sinistralAnnul : OMEN.dextralAnnul;
}
export function necroSideOmen(side: Side): string {
  return side === "prefix" ? OMEN.sinistralNecro : OMEN.dextralNecro;
}

export interface EssenceUse {
  apiId: string;
  group: string;
  side: Side;
  /** Modifier level of the guaranteed tier. */
  level: number;
  /** Perfect essences apply to rares (remove one mod, add the guarantee). */
  perfect: boolean;
}

export interface AlloyUse {
  apiId: string;
  group: string;
  side: Side;
  level: number;
}

export interface DesecrateUse {
  /** Bone api id (ancient-jawbone / -rib / -collarbone). */
  bone: string;
  side: Side;
  /** When the side is full, Essence of the Abyss marks (replaces) a random mod on it first. */
  abyss: boolean;
  /** Omen of Abyssal Echoes: 5 reveal options instead of 3. */
  echoes: boolean;
  /** Groups we want from the reveal; picks the best of these if offered. */
  want: (m: Mod) => boolean;
}

export type SpendSink = (apiId: string, n: number) => void;

/**
 * One attempt's mutable context: the item, the pools, the RNG and the
 * spend sink. Actions return false (without spending) when illegal.
 */
export class Trial {
  item: Item;
  cost = 0;
  actions = 0;

  constructor(
    readonly pool: SimPool,
    readonly desecPool: SimPool | null,
    readonly rng: Rng,
    private readonly priceOf: (apiId: string) => number,
    private readonly sink: SpendSink | null,
    start?: Item,
  ) {
    this.item = start ?? { rarity: "normal", mods: [] };
  }

  spend(apiId: string, n = 1): void {
    this.cost += this.priceOf(apiId) * n;
    this.actions += n;
    this.sink?.(apiId, n);
  }

  /** Adds a random mod under `minLevel` to one of the sides with room. */
  addRandom(minLevel: number, forceSide?: Side): Mod | null {
    return rollInto(this.item, this.pool, this.rng, minLevel, forceSide);
  }

  // ---- orbs ------------------------------------------------------------

  transmute(tier: OrbTier = 0): boolean {
    if (this.item.rarity !== "normal") return false;
    this.spend(orbApiId("transmute", tier));
    this.item.rarity = "magic";
    this.addRandom(ORB_MIN_LEVEL.transmute[tier]);
    return true;
  }

  augment(tier: OrbTier = 0): boolean {
    if (this.item.rarity !== "magic" || this.item.mods.length >= 2) return false;
    this.spend(orbApiId("augment", tier));
    this.addRandom(ORB_MIN_LEVEL.augment[tier]);
    return true;
  }

  regal(tier: OrbTier = 0): boolean {
    if (this.item.rarity !== "magic") return false;
    this.spend(orbApiId("regal", tier));
    this.item.rarity = "rare";
    this.addRandom(ORB_MIN_LEVEL.regal[tier]);
    return true;
  }

  alchemy(): boolean {
    if (this.item.rarity !== "normal") return false;
    this.spend(CURRENCY.alchemy);
    this.item.rarity = "rare";
    for (let i = 0; i < 4; i++) this.addRandom(0);
    return true;
  }

  exalt(opts: { tier?: OrbTier; side?: Side; double?: boolean } = {}): boolean {
    const it = this.item;
    if (it.rarity !== "rare" || it.mods.length >= 6) return false;
    if (opts.side && openSlots(it, opts.side) === 0) return false;
    const tier = opts.tier ?? 0;
    this.spend(orbApiId("exalt", tier));
    if (opts.side) this.spend(exaltSideOmen(opts.side));
    if (opts.double) this.spend(OMEN.greaterExalt);
    const min = ORB_MIN_LEVEL.exalt[tier];
    this.addRandom(min, opts.side);
    if (opts.double) this.addRandom(min, opts.side);
    return true;
  }

  chaos(tier: OrbTier = 0): boolean {
    const it = this.item;
    if (it.rarity !== "rare") return false;
    const idx = pickRemovable(it, this.rng);
    if (idx < 0) return false;
    this.spend(orbApiId("chaos", tier));
    it.mods.splice(idx, 1);
    this.addRandom(ORB_MIN_LEVEL.chaos[tier]);
    return true;
  }

  annul(side?: Side): boolean {
    const it = this.item;
    if (it.rarity === "normal") return false;
    const idx = pickRemovable(it, this.rng, side);
    if (idx < 0) return false;
    this.spend(CURRENCY.annul);
    if (side) this.spend(annulSideOmen(side));
    it.mods.splice(idx, 1);
    return true;
  }

  fracture(): boolean {
    const it = this.item;
    if (it.rarity !== "rare" || it.mods.length < 4) return false;
    if (it.mods.some((m) => m.fractured)) return false;
    const pool = it.mods.filter((m) => !m.desecrated);
    if (pool.length === 0) return false;
    this.spend(CURRENCY.fracture);
    pool[Math.floor(this.rng() * pool.length)].fractured = true;
    return true;
  }

  // ---- deterministic crafts -------------------------------------------

  essence(e: EssenceUse): boolean {
    const it = this.item;
    if (craftedCount(it) >= MAX_CRAFTED_MODS) return false;
    if (e.perfect) {
      if (it.rarity !== "rare") return false;
      const idx = pickRemovable(it, this.rng);
      if (idx < 0 && it.mods.length >= 6) return false;
      this.spend(e.apiId);
      if (idx >= 0) it.mods.splice(idx, 1);
    } else {
      if (it.rarity !== "magic") return false;
      this.spend(e.apiId);
      it.rarity = "rare";
    }
    const same = it.mods.findIndex((m) => m.group === e.group && !m.fractured);
    if (same >= 0) it.mods.splice(same, 1);
    if (hasGroup(it, e.group) || openSlots(it, e.side) === 0) return true;
    it.mods.push({ group: e.group, side: e.side, level: e.level, crafted: true });
    return true;
  }

  alloy(a: AlloyUse): boolean {
    const it = this.item;
    if (it.rarity !== "rare" || craftedCount(it) >= MAX_CRAFTED_MODS) return false;
    const idx = pickRemovable(it, this.rng);
    if (idx < 0) return false;
    this.spend(a.apiId);
    it.mods.splice(idx, 1);
    if (hasGroup(it, a.group) || openSlots(it, a.side) === 0) return true;
    it.mods.push({ group: a.group, side: a.side, level: a.level, crafted: true });
    return true;
  }

  /**
   * Bone + Necromancy omen, then reveal at the Well of Souls: pick the best
   * wanted option among 3 (5 with Echoes), else the first offered.
   */
  desecrate(d: DesecrateUse): boolean {
    const it = this.item;
    const pool = this.desecPool;
    if (!pool || it.rarity !== "rare") return false;
    if (desecratedCount(it) >= MAX_DESECRATED_MODS) return false;
    if (openSlots(it, d.side) === 0) {
      if (!d.abyss) return false;
      // The Mark of the Abyssal Lord replaces a random non-fractured mod on the side.
      const idx = pickRemovable(it, this.rng, d.side);
      if (idx < 0) return false;
      this.spend(CURRENCY.abyss);
      it.mods.splice(idx, 1);
    }
    this.spend(d.bone);
    this.spend(necroSideOmen(d.side));
    if (d.echoes) this.spend(OMEN.echoes);
    if (openSlots(it, d.side) === 0) return true;
    const offers = revealOptions(it, pool, this.rng, d.side, d.echoes ? 5 : 3);
    if (offers.length === 0) return true;
    const wanted = offers.filter(d.want).sort((a, b) => b.level - a.level);
    const pick = wanted[0] ?? offers[0];
    it.mods.push({ ...pick, desecrated: true });
    return true;
  }
}

export function craftedCount(item: Item): number {
  let n = 0;
  for (const m of item.mods) if (m.crafted) n++;
  return n;
}

export function desecratedCount(item: Item): number {
  let n = 0;
  for (const m of item.mods) if (m.desecrated) n++;
  return n;
}

/** Index of a random non-fractured mod (optionally on one side), or -1. */
export function pickRemovable(item: Item, rng: Rng, side?: Side): number {
  let n = 0;
  for (const m of item.mods) if (!m.fractured && (!side || m.side === side)) n++;
  if (n === 0) return -1;
  let k = Math.floor(rng() * n);
  for (let i = 0; i < item.mods.length; i++) {
    const m = item.mods[i];
    if (m.fractured || (side && m.side !== side)) continue;
    if (k-- === 0) return i;
  }
  return -1;
}

function sideGroups(pool: SimPool, side: Side): PoolGroup[] {
  return side === "prefix" ? pool.prefixes : pool.suffixes;
}

/** Weighted pick of a group + tier the item can still take; mutates the item. */
export function rollInto(
  item: Item,
  pool: SimPool,
  rng: Rng,
  minLevel: number,
  forceSide?: Side,
): Mod | null {
  const sides: Side[] = forceSide ? [forceSide] : ["prefix", "suffix"];
  let total = 0;
  const cands: { g: PoolGroup; w: number }[] = [];
  for (const side of sides) {
    if (openSlots(item, side) === 0) continue;
    for (const g of sideGroups(pool, side)) {
      if (hasGroup(item, g.group)) continue;
      const w = eligibleAt(g, minLevel).weight;
      if (w <= 0) continue;
      cands.push({ g, w });
      total += w;
    }
  }
  if (total <= 0) return null;
  let r = rng() * total;
  let chosen = cands[cands.length - 1];
  for (const c of cands) {
    r -= c.w;
    if (r <= 0) {
      chosen = c;
      break;
    }
  }
  const el = eligibleAt(chosen.g, minLevel);
  let rt = rng() * el.weight;
  let tier = el.tiers[el.tiers.length - 1];
  for (const t of el.tiers) {
    rt -= t.weight;
    if (rt <= 0) {
      tier = t;
      break;
    }
  }
  const mod: Mod = { group: chosen.g.group, side: chosen.g.side, level: tier.level };
  item.mods.push(mod);
  return mod;
}

/** Up to `n` distinct desecrated options for one side (no mutation). */
function revealOptions(item: Item, pool: SimPool, rng: Rng, side: Side, n: number): Mod[] {
  const cands = sideGroups(pool, side)
    .filter((g) => !hasGroup(item, g.group))
    .map((g) => ({ g, w: eligibleAt(g, 0).weight }))
    .filter((c) => c.w > 0);
  const out: Mod[] = [];
  while (out.length < n && cands.length) {
    const total = cands.reduce((s, c) => s + c.w, 0);
    let r = rng() * total;
    let i = cands.length - 1;
    for (let j = 0; j < cands.length; j++) {
      r -= cands[j].w;
      if (r <= 0) {
        i = j;
        break;
      }
    }
    const { g } = cands[i];
    cands.splice(i, 1);
    const el = eligibleAt(g, 0);
    let rt = rng() * el.weight;
    let tier = el.tiers[el.tiers.length - 1];
    for (const t of el.tiers) {
      rt -= t.weight;
      if (rt <= 0) {
        tier = t;
        break;
      }
    }
    out.push({ group: g.group, side: g.side, level: tier.level });
  }
  return out;
}
