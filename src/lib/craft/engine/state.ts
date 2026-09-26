import type { Side, Target } from "../types";

export type Rarity = "normal" | "magic" | "rare";

export interface Mod {
  group: string;
  side: Side;
  level: number;
  /** Locked by a Fracturing Orb: immune to Annul / Chaos / Essence removal. */
  fractured?: boolean;
  /** Added through desecration (0.5: at most one per item). */
  desecrated?: boolean;
  /** Essence / Alloy guarantee (0.5: at most one per item). */
  crafted?: boolean;
}

export interface Item {
  rarity: Rarity;
  mods: Mod[];
}

export const MAX_RARE_PER_SIDE = 3;
export const MAX_MAGIC_PER_SIDE = 1;
export const MAX_CRAFTED_MODS = 1;
export const MAX_DESECRATED_MODS = 1;

export function sideCap(item: Item): number {
  return item.rarity === "magic" ? MAX_MAGIC_PER_SIDE : item.rarity === "rare" ? MAX_RARE_PER_SIDE : 0;
}

export function sideCount(item: Item, side: Side): number {
  let n = 0;
  for (const m of item.mods) if (m.side === side) n++;
  return n;
}

export function openSlots(item: Item, side: Side): number {
  return Math.max(0, sideCap(item) - sideCount(item, side));
}

export function hasGroup(item: Item, group: string): boolean {
  for (const m of item.mods) if (m.group === group) return true;
  return false;
}

export function cloneItem(item: Item): Item {
  return { rarity: item.rarity, mods: item.mods.map((m) => ({ ...m })) };
}

export function modSatisfies(m: Mod, t: Target): boolean {
  if (m.side !== t.side || m.level < t.minLevel) return false;
  if (m.group === t.group) return true;
  return t.altGroups?.includes(m.group) ?? false;
}

export function targetSatisfied(item: Item, t: Target): boolean {
  for (const m of item.mods) if (modSatisfies(m, t)) return true;
  return false;
}

/** True when the mod fills any target (so cleanup must not strip it). */
export function isNeeded(m: Mod, targets: Target[]): boolean {
  for (const t of targets) if (modSatisfies(m, t)) return true;
  return false;
}

export function requiredDone(item: Item, targets: Target[]): boolean {
  for (const t of targets) if (!t.optional && !targetSatisfied(item, t)) return false;
  return true;
}

export function countRequiredHits(item: Item, targets: Target[]): number {
  let n = 0;
  for (const t of targets) if (!t.optional && targetSatisfied(item, t)) n++;
  return n;
}
