/** Ancient bone used for Abyss desecration, by item class. */
const BONE_BY_CLASS: { test: (ic: string) => boolean; apiId: string }[] = [
  {
    test: (ic) => ic === "Ring" || ic === "Amulet" || ic === "Belt",
    apiId: "ancient-collarbone",
  },
  {
    test: (ic) =>
      ic === "Quiver" ||
      /Mace|Sword|Axe|Dagger|Claw|Bow|Crossbow|Wand|Sceptre|Staff|Warstaff|Spear|Flail|Talisman/.test(ic),
    apiId: "ancient-jawbone",
  },
  {
    test: (ic) =>
      ["Body Armour", "Helmet", "Gloves", "Boots", "Shield", "Buckler", "Focus"].includes(ic),
    apiId: "ancient-rib",
  },
];

export function boneForClass(itemClass: string): string | null {
  return BONE_BY_CLASS.find((b) => b.test(itemClass))?.apiId ?? null;
}
