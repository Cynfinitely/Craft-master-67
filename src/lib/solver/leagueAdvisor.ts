/**
 * 0.5 "Runes of Aldur" league-system advisories — deterministic crafting
 * alternatives the orb-based planner can't price directly because they run
 * on farm-gated resources (Hiveblood, Wombgifts, Liquid Emotions, Verisium).
 * They surface as plan notes so the user knows when a league system beats
 * (or complements) the orb route.
 */

const RES_GROUPS = new Set([
  "FireResistance",
  "ColdResistance",
  "LightningResistance",
  "ChaosResistance",
  "AllResistances",
]);

const DEFENCE_GROUPS = new Set([
  "IncreasedLife",
  "IncreasedMana",
  "IncreasedEnergyShield",
  "EnergyShieldPercent",
  "IncreasedArmour",
  "IncreasedEvasion",
]);

const GENESIS_CLASSES = new Set(["Ring", "Amulet", "Belt"]);

/**
 * Genesis Tree (Breach): births rare rings/amulets/belts from Wombgifts +
 * Hiveblood, with tree nodes that GUARANTEE outcomes (e.g. "Imbue the Body"
 * forces a chosen elemental resistance on amulets, with a follow-up node
 * raising its minimum modifier level). Free respec, but Hiveblood is
 * untradeable — advisory only.
 */
export function genesisAdvice(
  itemClass: string,
  targetGroups: string[],
): string | null {
  if (!GENESIS_CLASSES.has(itemClass)) return null;
  const wantsRes = targetGroups.some((g) => RES_GROUPS.has(g));
  const wantsDefence = targetGroups.some((g) => DEFENCE_GROUPS.has(g));
  if (!wantsRes && !wantsDefence) return null;
  const guarantee =
    itemClass === "Amulet" && wantsRes
      ? ' "Imbue the Body" guarantees your chosen elemental resistance (a second node raises its minimum tier).'
      : "";
  return (
    `Genesis Tree alternative: birthed ${itemClass.toLowerCase()}s always roll a resistance, a defence and life/mana, and tree nodes bias base/mods/tiers.${guarantee} ` +
    `Costs Hiveblood + a ${itemClass} Wombgift (Breach-farmed, Wombgifts tradeable) — if you run Breach, compare before paying the orb cost below.`
  );
}

/**
 * Liquid Emotions (Distilled, 0.5): deterministically replace a modifier on
 * a JEWEL with a guaranteed one — and the result counts as the single
 * crafted modifier an item may carry in 0.5.
 */
export function liquidEmotionAdvice(itemClass: string): string | null {
  if (!/jewel/i.test(itemClass)) return null;
  return (
    "Liquid Emotions: distilled emotions deterministically replace a jewel modifier with a guaranteed one — " +
    "it counts as the item's single crafted modifier (0.5 rule), so it competes with Essences/Alloys for that slot."
  );
}

const ARMOUR_CLASSES = new Set([
  "Body Armour",
  "Helmet",
  "Gloves",
  "Boots",
  "Shield",
  "Buckler",
  "Focus",
]);

/**
 * Verisium Runeforging: spend Verisium at the Anvil to add Runic Ward and
 * extra rune sockets to armour — pure post-craft value-add (doesn't consume
 * an affix slot), so finished items can be upgraded before selling.
 */
export function runeforgingAdvice(itemClass: string): string | null {
  if (!ARMOUR_CLASSES.has(itemClass)) return null;
  return (
    "Verisium Runeforging: after finishing this craft, Verisium at the Anvil adds Runic Ward / extra rune sockets " +
    "to armour without touching the affixes — a cheap sale-value boost before listing."
  );
}

/** All applicable 0.5 league-system notes for a craft. */
export function leagueAdvice(
  itemClass: string,
  targetGroups: string[],
): string[] {
  return [
    genesisAdvice(itemClass, targetGroups),
    liquidEmotionAdvice(itemClass),
    runeforgingAdvice(itemClass),
  ].filter((s): s is string => s != null);
}
