import type { EligibleMod } from "@/lib/data/types";
import type { Side } from "../types";

export interface Tier {
  level: number;
  weight: number;
}

export interface PoolGroup {
  group: string;
  side: Side;
  /** Highest modifier level first. */
  tiers: Tier[];
  /** Eligible tiers per orb minimum level (memoized). */
  byMin: Map<number, { tiers: Tier[]; weight: number }>;
}

export interface SimPool {
  prefixes: PoolGroup[];
  suffixes: PoolGroup[];
  byGroup: Map<string, PoolGroup>;
}

export function makeGroup(group: string, side: Side, tiers: Tier[]): PoolGroup {
  return {
    group,
    side,
    tiers: [...tiers].sort((a, b) => b.level - a.level),
    byMin: new Map(),
  };
}

export function makePool(groups: PoolGroup[]): SimPool {
  const byGroup = new Map<string, PoolGroup>();
  for (const g of groups) byGroup.set(g.group, g);
  return {
    prefixes: groups.filter((g) => g.side === "prefix"),
    suffixes: groups.filter((g) => g.side === "suffix"),
    byGroup,
  };
}

/** Builds a simulation pool from the DB's eligible mods (one group per mod group). */
export function buildSimPool(prefixes: EligibleMod[], suffixes: EligibleMod[]): SimPool {
  const collect = (mods: EligibleMod[], side: Side): PoolGroup[] => {
    const map = new Map<string, Tier[]>();
    for (const m of mods) {
      if (m.weight <= 0) continue;
      const g = m.groups[0] ?? m.id;
      const arr = map.get(g) ?? [];
      arr.push({ level: m.requiredLevel, weight: m.weight });
      map.set(g, arr);
    }
    return [...map.entries()].map(([g, tiers]) => makeGroup(g, side, tiers));
  };
  return makePool([...collect(prefixes, "prefix"), ...collect(suffixes, "suffix")]);
}

/**
 * Tiers of a group that can roll under an orb's minimum modifier level. When
 * none reach it, the group's highest tier still rolls (PoE2 fallback rule).
 */
export function eligibleAt(g: PoolGroup, minLevel: number): { tiers: Tier[]; weight: number } {
  const hit = g.byMin.get(minLevel);
  if (hit) return hit;
  let tiers = minLevel > 0 ? g.tiers.filter((t) => t.level >= minLevel) : g.tiers;
  if (tiers.length === 0 && g.tiers.length) tiers = [g.tiers[0]];
  const out = { tiers, weight: tiers.reduce((s, t) => s + t.weight, 0) };
  g.byMin.set(minLevel, out);
  return out;
}

/** P(a roll on `side` under `minLevel` lands `group` at >= `targetLevel`), empty item. */
export function freshOdds(
  pool: SimPool,
  groups: string[],
  side: Side,
  targetLevel: number,
  minLevel = 0,
): number {
  const sideGroups = side === "prefix" ? pool.prefixes : pool.suffixes;
  let total = 0;
  for (const g of sideGroups) total += eligibleAt(g, minLevel).weight;
  if (total <= 0) return 0;
  let hit = 0;
  for (const name of groups) {
    const g = pool.byGroup.get(name);
    if (!g || g.side !== side) continue;
    for (const t of eligibleAt(g, minLevel).tiers) if (t.level >= targetLevel) hit += t.weight;
  }
  return hit / total;
}
