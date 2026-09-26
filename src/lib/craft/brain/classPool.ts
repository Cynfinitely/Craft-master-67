import "server-only";
import { groupByModGroup, modLabel, tierValue } from "@/lib/data/format";
import { getEligibleMods, getModPool, searchBases } from "@/lib/data/queries";
import { notableTags } from "@/lib/data/tags";
import type { BaseDetail, EligibleMod } from "@/lib/data/types";
import type { ClassPool, GroupChoice, Side } from "../types";

function buildGroupChoices(mods: EligibleMod[], side: Side): GroupChoice[] {
  return groupByModGroup(mods).map((g) => ({
    group: g.group,
    label: modLabel(g.mods[0]),
    generationType: side,
    weight: g.weight,
    // Highest required level first (best tier first).
    tiers: g.mods.map((m) => ({ level: m.requiredLevel, value: tierValue(m), weight: m.weight })),
    tags: notableTags(g.mods[0].implicitTags),
  }));
}

/** Union of modifier groups available to an item class, for the goal-first selector. */
export async function getClassPool(itemClass: string, itemLevel: number): Promise<ClassPool> {
  const bases = await searchBases({ itemClass, limit: 500 });
  const tagSet = new Set<string>();
  for (const b of bases) for (const t of b.tags) tagSet.add(t);
  const mods = await getEligibleMods([...tagSet], itemLevel);
  return {
    itemClass,
    itemLevel,
    prefixes: buildGroupChoices(mods.filter((m) => m.generationType === "prefix"), "prefix"),
    suffixes: buildGroupChoices(mods.filter((m) => m.generationType === "suffix"), "suffix"),
  };
}

export interface BaseGroups {
  base: BaseDetail;
  /** Each choice's `weight` is its share of the side's total weight (fresh-roll odds). */
  prefixes: GroupChoice[];
  suffixes: GroupChoice[];
  /** Desecrated-only groups (Well of Souls), not rollable by orbs. */
  desecrated: GroupChoice[];
}

/** Selectable modifier groups of one base, with fresh-roll odds. */
export async function getBaseGroups(baseId: string, itemLevel: number): Promise<BaseGroups | null> {
  const pool = await getModPool(baseId, itemLevel);
  if (!pool) return null;
  const asOdds = (choices: GroupChoice[], total: number) =>
    choices.map((c) => ({ ...c, weight: total ? c.weight / total : 0 }));
  const prefixes = asOdds(buildGroupChoices(pool.prefixes, "prefix"), pool.prefixTotalWeight);
  const suffixes = asOdds(buildGroupChoices(pool.suffixes, "suffix"), pool.suffixTotalWeight);

  let desecrated: GroupChoice[] = [];
  try {
    const mods = await getEligibleMods(pool.base.tags, itemLevel, { domains: ["desecrated"] });
    const normal = new Set([...prefixes, ...suffixes].map((c) => c.group));
    const pre = mods.filter((m) => m.generationType === "prefix");
    const suf = mods.filter((m) => m.generationType === "suffix");
    const preTotal = pre.reduce((s, m) => s + m.weight, 0);
    const sufTotal = suf.reduce((s, m) => s + m.weight, 0);
    desecrated = [
      ...asOdds(buildGroupChoices(pre, "prefix"), preTotal),
      ...asOdds(buildGroupChoices(suf, "suffix"), sufTotal),
    ].filter((c) => !normal.has(c.group));
  } catch {
    desecrated = [];
  }
  return { base: pool.base, prefixes, suffixes, desecrated };
}
