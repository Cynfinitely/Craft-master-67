import "server-only";
import { cleanModText } from "@/lib/data/format";
import { getEssences, type Material, type MaterialTier } from "@/lib/materials/source";
import type { EligibleMod } from "@/lib/data/types";

/**
 * Bridges materials and the mod pool: works out which mod groups an essence can
 * deterministically guarantee on a given item class, by normalizing the
 * essence's effect text (e.g. "+(30-39) to maximum Life" -> "# to maximum
 * life") and matching it against normalized mod text.
 */

export interface EssenceGuarantee {
  essenceApiId: string;
  essenceName: string;
  tier: MaterialTier | null;
  /** Mod group the essence guarantees on this item class. */
  group: string;
  /** Human label of the guaranteed mod. */
  modLabel: string;
  generationType: "prefix" | "suffix";
}

/* ----------------------------- text normalization ----------------------------- */

/**
 * Collapses a stat line to a comparable shape: lowercased, wiki-links removed,
 * every numeric value or range replaced with "#", and "# to #" (added-damage
 * style) folded to a single "#".
 */
export function normalizeStat(text: string | null | undefined): string {
  if (!text) return "";
  let s = cleanModText(text).toLowerCase();
  s = s.replace(/\+/g, " ");
  s = s.replace(/\([^)]*\)/g, "#"); // (10-15) -> #
  s = s.replace(/\d+(\.\d+)?/g, "#"); // bare numbers -> #
  s = s.replace(/#\s*to\s*#/g, "#"); // "adds # to # damage" -> "adds # damage"
  s = s.replace(/#+/g, "#");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/* ----------------------------- class label matching ----------------------------- */

const ARMOUR_PIECES = new Set(["Body Armour", "Helmet", "Gloves", "Boots"]);
const ONE_HAND_MELEE = new Set([
  "One Hand Mace",
  "One Hand Sword",
  "One Hand Axe",
  "Dagger",
  "Claw",
  "Spear",
  "Flail",
]);
const TWO_HAND_MELEE = new Set([
  "Two Hand Mace",
  "Two Hand Sword",
  "Two Hand Axe",
  "Warstaff",
]);
const RANGED = new Set(["Bow", "Crossbow"]);
const CASTER_WEAPON = new Set(["Wand", "Sceptre", "Staff"]);

function tokenMatchesClass(token: string, itemClass: string): boolean {
  const t = token.trim().toLowerCase();
  const ic = itemClass.toLowerCase();
  switch (t) {
    case "equipment":
      return true;
    case "armour":
      return ARMOUR_PIECES.has(itemClass) || itemClass === "Shield" || itemClass === "Buckler";
    case "jewellery":
      return itemClass === "Ring" || itemClass === "Amulet";
    case "martial weapon":
      return (
        ONE_HAND_MELEE.has(itemClass) ||
        TWO_HAND_MELEE.has(itemClass) ||
        RANGED.has(itemClass)
      );
    case "caster weapon":
      return CASTER_WEAPON.has(itemClass);
    case "weapon":
    case "weapons":
      return (
        ONE_HAND_MELEE.has(itemClass) ||
        TWO_HAND_MELEE.has(itemClass) ||
        RANGED.has(itemClass) ||
        CASTER_WEAPON.has(itemClass)
      );
    case "melee weapon":
      return ONE_HAND_MELEE.has(itemClass) || TWO_HAND_MELEE.has(itemClass);
    case "one handed melee weapon":
      return ONE_HAND_MELEE.has(itemClass);
    case "two handed melee weapon":
      return TWO_HAND_MELEE.has(itemClass);
    case "shield":
      return itemClass === "Shield" || itemClass === "Buckler";
    default:
      return t === ic;
  }
}

export function labelAppliesToClass(label: string, itemClass: string): boolean {
  // Labels look like "Amulet, Boots, Gloves or Ring" or "Armour or Belt".
  const tokens = label.split(/,| or /i).map((s) => s.trim()).filter(Boolean);
  return tokens.some((tok) => tokenMatchesClass(tok, itemClass));
}

/* ----------------------------- essence effect parsing ----------------------------- */

interface EssenceLine {
  /** Normalized stat the essence guarantees for the matched class. */
  normalized: string;
}

function parseEssenceLines(essence: Material, itemClass: string): EssenceLine[] {
  const out: EssenceLine[] = [];
  for (const raw of essence.effect) {
    const idx = raw.indexOf(":");
    // Header lines ("Upgrades a Magic item...", "Removes a random modifier...")
    // have no class-prefixed colon within the first ~40 chars.
    if (idx <= 0 || idx > 40) continue;
    const label = raw.slice(0, idx);
    if (!labelAppliesToClass(label, itemClass)) continue;
    const stat = raw.slice(idx + 1);
    out.push({ normalized: normalizeStat(stat) });
  }
  return out;
}

/* ----------------------------- resolver ----------------------------- */

/**
 * For a given item class and its eligible mod pool, returns the essences that
 * can guarantee each reachable mod group. Keyed by mod group; a group may be
 * guaranteeable by several essence tiers.
 */
export function resolveDeterminism(
  itemClass: string,
  mods: EligibleMod[],
): Map<string, EssenceGuarantee[]> {
  // Map normalized mod text -> { group, label, generationType } (first tier wins).
  const byNorm = new Map<
    string,
    { group: string; label: string; generationType: "prefix" | "suffix" }
  >();
  for (const m of mods) {
    const norm = normalizeStat(m.text);
    if (!norm || byNorm.has(norm)) continue;
    byNorm.set(norm, {
      group: m.groups[0] ?? m.id,
      label: cleanModText(m.text) || m.name || m.id,
      generationType: m.generationType === "suffix" ? "suffix" : "prefix",
    });
  }

  const result = new Map<string, EssenceGuarantee[]>();
  for (const ess of getEssences()) {
    for (const line of parseEssenceLines(ess, itemClass)) {
      const hit = byNorm.get(line.normalized);
      if (!hit) continue;
      const entry: EssenceGuarantee = {
        essenceApiId: ess.apiId,
        essenceName: ess.name,
        tier: ess.tier,
        group: hit.group,
        modLabel: hit.label,
        generationType: hit.generationType,
      };
      const arr = result.get(hit.group) ?? [];
      // Avoid duplicate essence entries for the same group.
      if (!arr.some((e) => e.essenceApiId === entry.essenceApiId)) {
        arr.push(entry);
        result.set(hit.group, arr);
      }
    }
  }
  return result;
}

/** Convenience: the set of mod groups guaranteeable by some essence. */
export function guaranteedGroups(
  itemClass: string,
  mods: EligibleMod[],
): Set<string> {
  return new Set(resolveDeterminism(itemClass, mods).keys());
}

/* ----------------------------- tag helpers ----------------------------- */

export { NOTABLE_TAGS } from "@/lib/data/tags";

export function modHasTag(mod: EligibleMod, tag: string): boolean {
  return mod.implicitTags.includes(tag);
}
