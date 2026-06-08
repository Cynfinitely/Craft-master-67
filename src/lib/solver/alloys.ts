import "server-only";
import type { EligibleMod } from "@/lib/data/types";
import { normalizeStat, labelAppliesToClass } from "./determinism";

/**
 * PoE2 0.5 "Return of the Ancients" Alloy currencies. Each Alloy removes a
 * random modifier and adds a guaranteed, class-specific modifier (like a
 * Perfect Essence). Data curated from the poe2 wiki (Runes of Aldur league).
 *
 * Each effect line is "<Class label>: <stat text>"; one Alloy lists several
 * class targets. Many of these mods are 0.5-exclusive (Runic Ward, league
 * utility) and won't exist in the standard mod pool — those are surfaced as
 * advisory guarantees rather than matched to a craftable group.
 */
export interface Alloy {
  apiId: string;
  name: string;
  dropLevel: number;
  /** Effect lines, each "Class label: stat text". */
  effects: string[];
}

export const ALLOYS: Alloy[] = [
  {
    apiId: "runic-alloy",
    name: "Runic Alloy",
    dropLevel: 13,
    effects: [
      "Ring: +(37-49) to maximum Runic Ward",
      "Amulet: (6-10)% increased maximum Runic Ward",
      "Belt: (15-20)% increased Runic Ward Regeneration Rate",
    ],
  },
  {
    apiId: "adaptive-alloy",
    name: "Adaptive Alloy",
    dropLevel: 23,
    effects: [
      "Staff: Gain (42-52)% of Damage as Extra Fire Damage while you are missing Runic Ward",
      "Wand: Gain (21-26)% of Damage as Extra Fire Damage while you are missing Runic Ward",
      "Sceptre: (30-50)% Surpassing Chance to gain a Puppet Master stack whenever you use a Command Skill",
      "Gloves: (10-15)% increased Attack Speed while missing Runic Ward",
    ],
  },
  {
    apiId: "expansive-alloy",
    name: "Expansive Alloy",
    dropLevel: 23,
    effects: [
      "Gloves: Remnants can be collected from (35-50)% further away",
      "Body Armour: (35-50)% increased Presence Area of Effect",
      "Helmet: (18-29)% increased Mana Cost Efficiency",
      "Boots: Temporary Minion Skills have +(1-2) to Limit of Minions summoned",
    ],
  },
  {
    apiId: "protective-alloy",
    name: "Protective Alloy",
    dropLevel: 23,
    effects: [
      "Belt: Recover (32-45) Runic Ward when a Charm is used",
      "Weapons: +(51-74) to maximum Runic Ward",
      "Shield: Recover (10-15) Runic Ward when you Block",
    ],
  },
  {
    apiId: "cyclonic-alloy",
    name: "Cyclonic Alloy",
    dropLevel: 45,
    effects: [
      "Body Armour: (15-30)% reduced Slowing Potency of Debuffs on You",
      "Boots: (15-19)% increased Skill Effect Duration",
      "Gloves: (20-25)% increased Duration of Damaging Ailments on Enemies",
      "Helmet: (35-42)% increased Archon Buff duration",
    ],
  },
  {
    apiId: "mystic-alloy",
    name: "Mystic Alloy",
    dropLevel: 45,
    effects: [
      "Helmet: Spell Skills have (10-15)% increased Area of Effect",
      "Gloves: (10-15)% increased Area of Effect for Attacks",
      "Boots: +(10-15) to Spirit",
      "Quiver: (25-35)% chance to Chain an additional time",
      "Caster Weapon: +1 to maximum number of Elemental Infusions",
    ],
  },
  {
    apiId: "prismatic-alloy",
    name: "Prismatic Alloy",
    dropLevel: 45,
    effects: [
      "Gloves: Damage Penetrates (9-15)% Elemental Resistances",
      "Martial Weapon: (20-30)% increased Magnitude of Ailments you inflict",
      "Focus, Staff or Wand: (40-50)% increased Exposure Effect",
      "Sceptre: Minions have (40-49)% increased Magnitude of Damaging Ailments",
    ],
  },
  {
    apiId: "swift-alloy",
    name: "Swift Alloy",
    dropLevel: 45,
    effects: [
      "Gloves: (9-12)% increased Cast Speed",
      "Ring: (7-9)% increased Attack Speed",
      "Belt: Flasks gain (0.75-1) charges per Second",
      "Shield or Focus: (30-49)% increased Totem Placement speed",
    ],
  },
  {
    apiId: "celestial-alloy",
    name: "Celestial Alloy",
    dropLevel: 65,
    effects: [
      "Staff or Wand: +(142-188) to maximum Mana",
      "Martial Weapon: +(327-427) to Accuracy Rating",
    ],
  },
  {
    apiId: "sovereign-alloy",
    name: "Sovereign Alloy",
    dropLevel: 65,
    effects: [
      "Weapons: (20-30)% increased effect of Socketed Augment Items",
      "Armour: (24-30)% increased Runic Ward",
      "Jewellery or Belt: (20-30)% increased Explicit Resistance Modifier magnitudes",
    ],
  },
  {
    apiId: "the-runebinders-alloy",
    name: "The Runebinder's Alloy",
    dropLevel: 65,
    effects: [
      "Staff: (25-50)% chance to gain Nature's Archon when your Plants Overgrow",
      "Wand: +1 to Limit for Elemental Skills",
      "Sceptre: +(4-5) maximum stacks of Puppet Master",
      "Crossbow: +2 to maximum number of Summoned Ballista Totems",
      "Bow: (40-50)% increased Effect of your Mark Skills",
    ],
  },
  {
    apiId: "the-runefathers-alloy",
    name: "The Runefather's Alloy",
    dropLevel: 65,
    effects: [
      "Spear: +(8-10) to Weapon Range",
      "Talisman: Lightning Damage from Hits also Contributes to Flammability and Ignite Magnitudes",
    ],
  },
  {
    apiId: "transcendent-alloy",
    name: "Transcendent Alloy",
    dropLevel: 65,
    effects: [
      "Focus, Staff or Wand: (39-47)% increased Cast Speed",
      "Martial Weapon: (15-20)% increased Physical Damage",
      "Martial Weapon: +(7-10) to all Attributes",
    ],
  },
];

export interface AlloyGuarantee {
  alloyApiId: string;
  alloyName: string;
  group: string;
  modLabel: string;
  generationType: "prefix" | "suffix";
}

/** Effect lines an Alloy can apply to a given item class (display/advisory). */
export function alloysForClass(
  itemClass: string,
): { alloy: Alloy; effects: string[] }[] {
  const out: { alloy: Alloy; effects: string[] }[] = [];
  for (const alloy of ALLOYS) {
    const applicable: string[] = [];
    for (const raw of alloy.effects) {
      const idx = raw.indexOf(":");
      if (idx <= 0) continue;
      if (labelAppliesToClass(raw.slice(0, idx), itemClass)) {
        applicable.push(raw.slice(idx + 1).trim());
      }
    }
    if (applicable.length) out.push({ alloy, effects: applicable });
  }
  return out;
}

/**
 * Like resolveDeterminism for essences: maps each reachable mod group to the
 * Alloys that guarantee it on this item class (only fires when the Alloy's mod
 * exists in the standard pool).
 */
export function resolveAlloys(
  itemClass: string,
  mods: EligibleMod[],
): Map<string, AlloyGuarantee[]> {
  const byNorm = new Map<
    string,
    { group: string; label: string; generationType: "prefix" | "suffix" }
  >();
  for (const m of mods) {
    const norm = normalizeStat(m.text);
    if (!norm || byNorm.has(norm)) continue;
    byNorm.set(norm, {
      group: m.groups[0] ?? m.id,
      label: m.text ?? m.name ?? m.id,
      generationType: m.generationType === "suffix" ? "suffix" : "prefix",
    });
  }

  const result = new Map<string, AlloyGuarantee[]>();
  for (const alloy of ALLOYS) {
    for (const raw of alloy.effects) {
      const idx = raw.indexOf(":");
      if (idx <= 0) continue;
      if (!labelAppliesToClass(raw.slice(0, idx), itemClass)) continue;
      const hit = byNorm.get(normalizeStat(raw.slice(idx + 1)));
      if (!hit) continue;
      const entry: AlloyGuarantee = {
        alloyApiId: alloy.apiId,
        alloyName: alloy.name,
        group: hit.group,
        modLabel: hit.label,
        generationType: hit.generationType,
      };
      const arr = result.get(hit.group) ?? [];
      if (!arr.some((e) => e.alloyApiId === entry.alloyApiId)) {
        arr.push(entry);
        result.set(hit.group, arr);
      }
    }
  }
  return result;
}
