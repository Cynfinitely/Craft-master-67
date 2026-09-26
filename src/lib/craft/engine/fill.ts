import type { Side, Target } from "../types";
import type { OrbTier, Trial } from "./actions";
import { isNeeded, openSlots, targetSatisfied } from "./state";
import type { SimPool } from "./pool";

/** Guard so degenerate pools can't spin forever inside one attempt. */
export const MAX_ACTIONS_PER_ATTEMPT = 60;

export interface FillOptions {
  exaltTier: OrbTier;
  /** Annul junk (with side omen) when the target side is full; else give up. */
  cleanup: boolean;
  /** Use Omen of Greater Exaltation when open slots equal the remaining targets. */
  double: boolean;
  /** Also chase optional targets once the required ones are in. */
  chaseOptional?: boolean;
}

/** Target can roll from the normal pool (desecrated-only groups cannot be slammed). */
export function rollable(pool: SimPool, t: Target): boolean {
  if (t.desecrated) return false;
  for (const g of [t.group, ...(t.altGroups ?? [])]) {
    const pg = pool.byGroup.get(g);
    if (pg && pg.side === t.side) return true;
  }
  return false;
}

function other(side: Side): Side {
  return side === "prefix" ? "suffix" : "prefix";
}

/**
 * Directional-omen fill: per unsatisfied target, slam Exalts forced to its
 * side. A full side of junk is cleared with Annul + side omen (random within
 * the side, so it can strip a finished mod — the real brick risk). With
 * `double`, an Omen of Greater Exaltation fills two slots when the open
 * slots exactly match the remaining targets.
 */
export function directedFill(t: Trial, targets: Target[], opts: FillOptions): void {
  const item = t.item;
  const chase = targets.filter(
    (x) => (opts.chaseOptional || !x.optional) && rollable(t.pool, x),
  );
  const start = t.actions;
  while (t.actions - start < MAX_ACTIONS_PER_ATTEMPT) {
    const remaining = chase.filter((x) => !targetSatisfied(item, x));
    if (remaining.length === 0) return;

    const open = openSlots(item, "prefix") + openSlots(item, "suffix");
    if (opts.double && remaining.length >= 2 && open === remaining.length) {
      if (!t.exalt({ tier: opts.exaltTier, double: true })) return;
      continue;
    }

    const target = remaining[0];
    if (openSlots(item, target.side) === 0) {
      if (!opts.cleanup) return;
      const strippable = item.mods.some(
        (m) => m.side === target.side && !m.fractured && !isNeeded(m, targets),
      );
      if (!strippable) return;
      const otherHasMods = item.mods.some((m) => m.side === other(target.side) && !m.fractured);
      if (!t.annul(otherHasMods ? target.side : undefined)) return;
      continue;
    }

    const otherOpen = openSlots(item, other(target.side)) > 0;
    const otherNeeded = remaining.some((r) => r.side !== target.side);
    // Junk on the other side only matters when that side still needs a target.
    const side = otherOpen && otherNeeded ? target.side : undefined;
    if (!t.exalt({ tier: opts.exaltTier, side })) return;
  }
}

/** Blind Exalt slams until the item is full. */
export function slamToFull(t: Trial, tier: OrbTier = 0): void {
  while (t.item.mods.length < 6) {
    const before = t.item.mods.length;
    if (!t.exalt({ tier })) return;
    if (t.item.mods.length === before) return;
  }
}
