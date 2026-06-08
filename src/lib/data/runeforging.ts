/**
 * PoE2 0.5 Verisium Runeforging / Runic Ward.
 *
 * Runic Ward is a new defensive layer (kicks in at 1 life, regenerates
 * independently). It is added to armour at the Verisium Anvil by spending
 * Verisium:
 *  - Armour below item level 55 gains Runic Ward with NO downside.
 *  - Armour at/above level 55 trades some Armour/Evasion/Energy Shield for it.
 * Curated from the 0.5 "Return of the Ancients" patch notes.
 */

export const RUNEFORGING_MIN_LEVEL_FREE = 55;

const ARMOUR_CLASSES = new Set([
  "Body Armour",
  "Helmet",
  "Gloves",
  "Boots",
  "Shield",
  "Buckler",
  "Focus",
]);

export function isRuneforgeable(itemClass: string | null | undefined): boolean {
  return Boolean(itemClass && ARMOUR_CLASSES.has(itemClass));
}

/** A short advisory note about adding Runic Ward to an item class at a level. */
export function runeforgingNote(
  itemClass: string | null | undefined,
  itemLevel: number,
): string | null {
  if (!isRuneforgeable(itemClass)) {
    return itemClass
      ? "Runic Ward is added to armour via the Verisium Anvil; this item class can't be runeforged for Runic Ward."
      : null;
  }
  if (itemLevel < RUNEFORGING_MIN_LEVEL_FREE) {
    return `Add Runic Ward at the Verisium Anvil with Verisium — at item level ${itemLevel} (< ${RUNEFORGING_MIN_LEVEL_FREE}) it is added with no downside.`;
  }
  return `Add Runic Ward at the Verisium Anvil with Verisium — at item level ${itemLevel} (>= ${RUNEFORGING_MIN_LEVEL_FREE}) it trades some Armour/Evasion/Energy Shield for Runic Ward.`;
}
