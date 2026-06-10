import "server-only";
import { cleanModText, normalizeStat } from "@/lib/data/format";
import { getEssences, type Material, type MaterialTier } from "@/lib/materials/source";
import type { EligibleMod } from "@/lib/data/types";

export { normalizeStat };

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
  /** Required modifier level of the tier this essence guarantees, if resolved. */
  guaranteedLevel?: number;
  /** Display value of the guaranteed tier (e.g. "+(30-39) to maximum Life"). */
  guaranteedValue?: string;
  /** Top rolled value the essence guarantees (for comparing against a target tier). */
  guaranteedStatMax?: number;
  /** True when the essence grants a single fixed value (no roll range) — can't Divine it. */
  isFixedValue?: boolean;
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
  /** Raw stat text (with the rolled range), used to resolve the granted tier. */
  raw: string;
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
    out.push({ normalized: normalizeStat(stat), raw: stat });
  }
  return out;
}

function magnitudes(text: string): number[] {
  return (text.match(/\d+(\.\d+)?/g) ?? []).map(Number);
}

function isFixedStat(raw: string): boolean {
  // Ranges like "(30-32)%" or "(64-97) to (97-145)" roll; a lone "30%" does not.
  return !/\(\s*\d+(\.\d+)?\s*-\s*\d+(\.\d+)?\s*\)/.test(raw);
}

/** Finds the tier of `tiers` whose top stat value best matches `raw`. */
function matchTier(tiers: EligibleMod[], raw: string): EligibleMod | null {
  const nums = magnitudes(raw);
  if (!nums.length || !tiers.length) return null;
  const target = nums[nums.length - 1]; // the max of the essence's granted range
  let best: EligibleMod | null = null;
  let bestDiff = Infinity;
  for (const t of tiers) {
    const ref = t.stats[0]?.max;
    if (ref == null) continue;
    const diff = Math.abs(ref - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best;
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
  // Map normalized mod text -> group info + all tiers (first match wins).
  const byNorm = new Map<
    string,
    {
      group: string;
      label: string;
      generationType: "prefix" | "suffix";
      tiers: EligibleMod[];
    }
  >();
  const tiersByGroup = new Map<string, EligibleMod[]>();
  for (const m of mods) {
    const g = m.groups[0] ?? m.id;
    const arr = tiersByGroup.get(g) ?? [];
    arr.push(m);
    tiersByGroup.set(g, arr);
  }
  for (const m of mods) {
    const norm = normalizeStat(m.text);
    if (!norm || byNorm.has(norm)) continue;
    const group = m.groups[0] ?? m.id;
    byNorm.set(norm, {
      group,
      label: cleanModText(m.text) || m.name || m.id,
      generationType: m.generationType === "suffix" ? "suffix" : "prefix",
      tiers: tiersByGroup.get(group) ?? [m],
    });
  }

  const result = new Map<string, EssenceGuarantee[]>();
  for (const ess of getEssences()) {
    for (const line of parseEssenceLines(ess, itemClass)) {
      const hit = byNorm.get(line.normalized);
      if (!hit) continue;
      const grantedTier = matchTier(hit.tiers, line.raw);
      const fixed = isFixedStat(line.raw);
      const entry: EssenceGuarantee = {
        essenceApiId: ess.apiId,
        essenceName: ess.name,
        tier: ess.tier,
        group: hit.group,
        modLabel: hit.label,
        generationType: hit.generationType,
        guaranteedLevel: grantedTier?.requiredLevel,
        guaranteedValue: grantedTier
          ? cleanModText(grantedTier.text) || undefined
          : cleanModText(line.raw) || undefined,
        guaranteedStatMax:
          grantedTier?.stats[0]?.max ??
          (magnitudes(line.raw).at(-1) ?? undefined),
        isFixedValue: fixed,
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

/** True when an essence guarantee meets the user's targeted minimum tier/value. */
export function essenceReachesTarget(
  g: EssenceGuarantee,
  target: { tierLevel?: number; tierStatMax?: number },
): boolean {
  if (target.tierLevel == null) return true;
  if (g.guaranteedLevel == null || g.guaranteedLevel < target.tierLevel) {
    return false;
  }
  if (
    target.tierStatMax != null &&
    g.guaranteedStatMax != null &&
    g.guaranteedStatMax < target.tierStatMax
  ) {
    return false;
  }
  return true;
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
