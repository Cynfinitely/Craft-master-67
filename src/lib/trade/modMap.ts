import { normalizeStat } from "@/lib/data/format";
import type { EligibleMod } from "@/lib/data/types";
import { getTradeStats } from "./stats";
import { GROUP_STAT_OVERRIDES } from "./overrides";

/**
 * Bridges repoe mod groups and trade-site stat hashes by normalizing both
 * texts to the same shape ("+(20-25)% to Fire Resistance" and
 * "+#% to Fire Resistance" both become "#% to fire resistance").
 *
 * A mod group maps to one stat id per text line (hybrid mods map to several,
 * combined as an AND filter on trade searches).
 */

export interface ModStatMap {
  /** Mod group -> trade stat ids (all lines of the mod's text). */
  groupToStats: Map<string, string[]>;
  /** Mod group -> FRACTURED-type stat ids (for fractured-base searches). */
  groupToFracturedStats: Map<string, string[]>;
  /** Trade stat id -> mod groups whose text contains that stat line. */
  statToGroups: Map<string, string[]>;
  /** Trade stat id -> display text. */
  statText: Map<string, string>;
}

const MATCHABLE_TYPES = new Set(["explicit", "desecrated", "fractured"]);

let catalogMemo: {
  byNorm: Map<string, string>;
  byNormFractured: Map<string, string>;
  statText: Map<string, string>;
} | null = null;

async function getCatalogIndex() {
  if (catalogMemo) return catalogMemo;
  const stats = await getTradeStats();
  const byNorm = new Map<string, string>();
  const byNormFractured = new Map<string, string>();
  const statText = new Map<string, string>();
  for (const s of stats) {
    statText.set(s.id, s.text);
    if (!MATCHABLE_TYPES.has(s.type)) continue;
    const norm = normalizeStat(s.text);
    if (!norm) continue;
    if (s.type === "fractured") byNormFractured.set(norm, s.id);
    // Prefer plain explicit stats over desecrated/fractured duplicates.
    const existing = byNorm.get(norm);
    if (!existing || (s.type === "explicit" && !existing.startsWith("explicit."))) {
      byNorm.set(norm, s.id);
    }
  }
  catalogMemo = { byNorm, byNormFractured, statText };
  return catalogMemo;
}

/**
 * Builds the group <-> stat mapping for a mod pool (e.g. all eligible mods of
 * a base or item class). Groups whose text can't be matched are omitted from
 * `groupToStats` unless covered by a manual override.
 */
export async function buildModStatMap(mods: EligibleMod[]): Promise<ModStatMap> {
  const { byNorm, byNormFractured, statText } = await getCatalogIndex();

  const groupToStats = new Map<string, string[]>();
  const groupToFracturedStats = new Map<string, string[]>();
  const statToGroups = new Map<string, string[]>();

  const link = (group: string, statIds: string[]) => {
    if (!groupToStats.has(group)) groupToStats.set(group, statIds);
    for (const id of statIds) {
      const arr = statToGroups.get(id) ?? [];
      if (!arr.includes(group)) arr.push(group);
      statToGroups.set(id, arr);
    }
  };

  const seenGroups = new Set<string>();
  for (const m of mods) {
    const group = m.groups[0] ?? m.id;
    if (seenGroups.has(group)) continue;
    seenGroups.add(group);

    const override = GROUP_STAT_OVERRIDES[group];
    if (override?.length) {
      link(group, override);
      continue;
    }
    if (!m.text) continue;
    const lines = m.text.split("\n").map((l) => normalizeStat(l)).filter(Boolean);
    if (lines.length === 0) continue;
    const ids: string[] = [];
    const fracturedIds: string[] = [];
    for (const norm of lines) {
      const id = byNorm.get(norm);
      if (!id) {
        ids.length = 0;
        break; // partial mapping would produce wrong trade filters
      }
      ids.push(id);
      const fid = byNormFractured.get(norm);
      if (fid) fracturedIds.push(fid);
    }
    if (ids.length > 0) link(group, ids);
    if (fracturedIds.length === lines.length && fracturedIds.length > 0) {
      groupToFracturedStats.set(group, fracturedIds);
    }
  }

  return { groupToStats, groupToFracturedStats, statToGroups, statText };
}

/** Display text for a trade stat id, falling back to the id itself. */
export async function tradeStatText(id: string): Promise<string> {
  const { statText } = await getCatalogIndex();
  return statText.get(id) ?? id;
}
