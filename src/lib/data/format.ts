import type { EligibleMod, ModStat } from "./types";

/**
 * Cleans repoe mod text for display. The export uses a wiki-link syntax like
 * "[Strength|Strength]" or "[Physical Damage|Physical]" where the part before
 * the pipe is the display text. Plain "[text]" is shown as-is.
 */
export function cleanModText(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\[([^\]]+)\]/g, (_m, inner: string) => {
    const pipe = inner.indexOf("|");
    return pipe >= 0 ? inner.slice(0, pipe) : inner;
  });
}

/** A short label for a mod (its display text, falling back to name/type). */
export function modLabel(mod: EligibleMod): string {
  const t = cleanModText(mod.text);
  if (t) return t;
  return mod.name || mod.type || mod.id;
}

/** Human-readable value range across a mod's stats, e.g. "5 to 8". */
export function statRange(stat: ModStat): string {
  if (stat.min === stat.max) return `${stat.min}`;
  return `${stat.min} to ${stat.max}`;
}

/**
 * A concise per-tier value string for a mod: the cleaned mod text (which
 * already embeds its range, e.g. "+(30-40) to maximum Life"), falling back to
 * a single stat range.
 */
export function tierValue(mod: EligibleMod): string {
  const t = cleanModText(mod.text);
  if (t) return t;
  if (mod.stats.length === 1) return statRange(mod.stats[0]);
  return mod.name || mod.id;
}

/** Formats a weight as a percentage of a total pool weight. */
export function weightPct(weight: number, total: number): string {
  if (!total) return "0%";
  const pct = (weight / total) * 100;
  if (pct < 0.1) return "<0.1%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

/**
 * Groups eligible mods by their primary mod group (only one mod per group can
 * roll), with the highest-tier (highest required level) first within a group.
 */
export function groupByModGroup(modsList: EligibleMod[]): {
  group: string;
  mods: EligibleMod[];
  weight: number;
}[] {
  const map = new Map<string, EligibleMod[]>();
  for (const m of modsList) {
    const group = m.groups[0] ?? m.id;
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(m);
  }
  const groups = [...map.entries()].map(([group, list]) => {
    list.sort((a, b) => b.requiredLevel - a.requiredLevel);
    // Probability of rolling *some* tier from this group equals the combined
    // weight of all its eligible tiers relative to the whole pool.
    const weight = list.reduce((s, m) => s + m.weight, 0);
    return { group, mods: list, weight };
  });
  groups.sort((a, b) => b.weight - a.weight);
  return groups;
}
