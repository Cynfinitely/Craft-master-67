/**
 * URL helpers for deep-linking into the crafting planner with tier-aware
 * mod-group encoding (`Group@requiredLevel`).
 */

import { recommendBases } from "@/lib/solver";

export function encodeGroupsParam(
  groups: string[],
  minLevelPerGroup?: Map<string, number> | Record<string, number>,
): string {
  const levelOf = (g: string): number | undefined => {
    if (!minLevelPerGroup) return undefined;
    if (minLevelPerGroup instanceof Map) return minLevelPerGroup.get(g);
    return minLevelPerGroup[g];
  };
  return groups
    .map((g) => {
      const level = levelOf(g);
      return level != null && level > 0 ? `${g}@${level}` : g;
    })
    .join(",");
}

export function buildBasePlanHref(opts: {
  itemClass: string;
  baseId: string;
  itemLevel?: number;
  groups: string[];
  minLevelPerGroup?: Map<string, number> | Record<string, number>;
  methodSort?: string;
}): string {
  const p = new URLSearchParams();
  p.set("mode", "base");
  p.set("class", opts.itemClass);
  p.set("base", opts.baseId);
  p.set("ilvl", String(opts.itemLevel ?? 82));
  p.set("groups", encodeGroupsParam(opts.groups, opts.minLevelPerGroup));
  if (opts.methodSort && opts.methodSort !== "cost") {
    p.set("msort", opts.methodSort);
  }
  return `/craft?${p.toString()}`;
}

export function buildRecommendHref(opts: {
  itemClass: string;
  itemLevel?: number;
  groups: string[];
  minLevelPerGroup?: Map<string, number> | Record<string, number>;
}): string {
  const p = new URLSearchParams();
  p.set("mode", "recommend");
  p.set("class", opts.itemClass);
  p.set("ilvl", String(opts.itemLevel ?? 82));
  p.set("groups", encodeGroupsParam(opts.groups, opts.minLevelPerGroup));
  return `/craft?${p.toString()}`;
}

/** Best-effort deep link: pinned base when rollable, else recommend mode. */
export async function resolveCraftPlanHref(opts: {
  itemClass: string;
  groups: string[];
  league?: string;
  itemLevel?: number;
  baseId?: string;
}): Promise<string> {
  const itemLevel = opts.itemLevel ?? 82;
  if (opts.baseId) {
    return buildBasePlanHref({
      itemClass: opts.itemClass,
      baseId: opts.baseId,
      itemLevel,
      groups: opts.groups,
    });
  }
  const recs = await recommendBases(
    opts.itemClass,
    itemLevel,
    opts.groups,
    1,
    { league: opts.league, useMarketScore: !!opts.league },
  );
  const best = recs[0];
  if (best && best.missing.length === 0) {
    return buildBasePlanHref({
      itemClass: opts.itemClass,
      baseId: best.baseId,
      itemLevel,
      groups: opts.groups,
    });
  }
  return buildRecommendHref({
    itemClass: opts.itemClass,
    itemLevel,
    groups: opts.groups,
  });
}
