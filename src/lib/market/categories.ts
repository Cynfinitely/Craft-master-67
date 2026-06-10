/**
 * repoe item-class name -> trade-site category option id
 * (verified against /api/trade2/data/filters).
 */
export const CLASS_TO_TRADE_CATEGORY: Record<string, string> = {
  "One Hand Mace": "weapon.onemace",
  "Two Hand Mace": "weapon.twomace",
  "One Hand Sword": "weapon.onesword",
  "Two Hand Sword": "weapon.twosword",
  "One Hand Axe": "weapon.oneaxe",
  "Two Hand Axe": "weapon.twoaxe",
  Dagger: "weapon.dagger",
  Claw: "weapon.claw",
  Bow: "weapon.bow",
  Crossbow: "weapon.crossbow",
  Wand: "weapon.wand",
  Sceptre: "weapon.sceptre",
  Staff: "weapon.staff",
  Warstaff: "weapon.warstaff",
  Spear: "weapon.spear",
  Flail: "weapon.flail",
  "Body Armour": "armour.chest",
  Helmet: "armour.helmet",
  Gloves: "armour.gloves",
  Boots: "armour.boots",
  Shield: "armour.shield",
  Buckler: "armour.buckler",
  Focus: "armour.focus",
  Ring: "accessory.ring",
  Amulet: "accessory.amulet",
  Belt: "accessory.belt",
  Quiver: "armour.quiver",
};

export function tradeCategoryForClass(itemClass: string): string | null {
  return CLASS_TO_TRADE_CATEGORY[itemClass] ?? null;
}
