import type { DesiredMod } from "./types";

/**
 * PoE2 0.5 "Return of the Ancients" crafting constraints.
 *
 * Patch notes: "All crafted modifiers are now guaranteed, but items can only
 * have 1 crafted modifier at a time. Desecrated modifiers no longer count as
 * crafted modifiers, but items are limited to 1 Desecrated modifier."
 *
 * "Crafted modifier" covers every deterministic guarantee source: Essences,
 * Alloys, and Distills (Liquid Emotions). They all compete for the single
 * crafted slot — essence + alloy stacking, double-essence, etc. are illegal.
 */
export const MAX_CRAFTED_MODS = 1;
export const MAX_DESECRATED_MODS = 1;

/** Human-readable summary for UI copy / method cons. */
export const RULE_05_SUMMARY =
  "0.5 rule: only 1 crafted modifier (Essence/Alloy/Distill) and 1 Desecrated modifier per item.";

/**
 * Validates a target set against the hard 0.5 per-item caps. Returns
 * warnings; `feasible: false` when the targets are impossible on any item.
 */
export function validateTargets05(targets: DesiredMod[]): {
  warnings: string[];
  feasible: boolean;
} {
  const warnings: string[] = [];
  let feasible = true;
  const desecrated = targets.filter((t) => t.desecrated);
  if (desecrated.length > MAX_DESECRATED_MODS) {
    warnings.push(
      `You selected ${desecrated.length} desecrated-only modifiers, but in 0.5 an item can carry at most ${MAX_DESECRATED_MODS} Desecrated modifier.`,
    );
    feasible = false;
  }
  return { warnings, feasible };
}

/**
 * Caps a list of would-be deterministic guarantees (essences/alloys/distills)
 * to the single crafted-mod slot. The first entry keeps the slot; the rest
 * must be reached by other means (Exalt, desecration, ...).
 */
export function splitCraftedBudget<T>(guarantees: T[]): {
  crafted: T | null;
  overflow: T[];
} {
  if (guarantees.length === 0) return { crafted: null, overflow: [] };
  return {
    crafted: guarantees[0],
    overflow: guarantees.slice(MAX_CRAFTED_MODS),
  };
}
