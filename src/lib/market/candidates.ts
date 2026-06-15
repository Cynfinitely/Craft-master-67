import "server-only";
import { groupByModGroup, modLabel } from "@/lib/data/format";
import type { EligibleMod } from "@/lib/data/types";
import { buildModStatMap } from "@/lib/trade/modMap";
import { getComboStats } from "./analytics";
import { encodeGroupsParam } from "./craftLinks";
import { getMetaCombos } from "./meta";
import { comboKeyFromGroups, getProbes, META_TEMPLATES } from "./probes";

export type TierVariant = "practical" | "premium" | "budget";

export interface TierCandidate {
  groups: string[];
  labels: string[];
  statIds: string[];
  key: string;
  minLevelPerGroup: Map<string, number>;
  tierGroupsEncoded: string;
  variant: TierVariant;
  priority: number;
  statMins?: Map<string, number>;
}

const KEY_MOD_GROUPS = new Set([
  "IncreasedLife",
  "IncreasedEnergyShield",
  "EnergyShieldPercent",
  "MovementVelocity",
  "LocalPhysicalDamagePercent",
  "IncreasedAttackSpeed",
  "IncreasedCastSpeed",
  "FireResistance",
  "ColdResistance",
  "LightningResistance",
  "ChaosResistance",
  "AllResistances",
]);

function tierLadder(mods: EligibleMod[]): EligibleMod[] {
  return [...mods].sort((a, b) => b.requiredLevel - a.requiredLevel).slice(0, 3);
}

function levelForVariant(
  mods: EligibleMod[],
  variant: TierVariant,
  isKey: boolean,
): number {
  const ladder = tierLadder(mods);
  if (ladder.length === 0) return 0;
  if (variant === "premium" && isKey) return ladder[0].requiredLevel;
  if (variant === "budget") return ladder[ladder.length - 1].requiredLevel;
  // practical: T2 when available, else best
  return ladder.length >= 2 ? ladder[1].requiredLevel : ladder[0].requiredLevel;
}

function buildStatMins(
  groups: string[],
  minLevelPerGroup: Map<string, number>,
  statMap: Awaited<ReturnType<typeof buildModStatMap>>,
): Map<string, number> | undefined {
  const statMins = new Map<string, number>();
  for (const g of groups) {
    const minLevel = minLevelPerGroup.get(g);
    if (!minLevel) continue;
    for (const id of statMap.groupToStats.get(g) ?? []) {
      statMins.set(id, minLevel);
    }
  }
  return statMins.size > 0 ? statMins : undefined;
}

function expandVariants(
  seed: { groups: string[]; labels: string[] },
  classMods: EligibleMod[],
  statMap: Awaited<ReturnType<typeof buildModStatMap>>,
  variant: TierVariant,
): Omit<TierCandidate, "priority"> | null {
  const byGroup = groupByModGroup(classMods);
  const groupMods = new Map(byGroup.map((g) => [g.group, g.mods]));
  const minLevelPerGroup = new Map<string, number>();
  for (const g of seed.groups) {
    const mods = groupMods.get(g);
    if (!mods) return null;
    minLevelPerGroup.set(
      g,
      levelForVariant(mods, variant, KEY_MOD_GROUPS.has(g)),
    );
  }
  const statMins = buildStatMins(seed.groups, minLevelPerGroup, statMap);
  const keyed = comboKeyFromGroups(
    seed.groups,
    statMap.groupToStats,
    statMins,
  );
  if (!keyed) return null;
  return {
    groups: seed.groups,
    labels: seed.labels,
    statIds: keyed.statIds,
    key: keyed.key,
    minLevelPerGroup,
    tierGroupsEncoded: encodeGroupsParam(seed.groups, minLevelPerGroup),
    variant,
    statMins,
  };
}

async function scoreCandidate(
  c: Omit<TierCandidate, "priority">,
  opts: {
    league: string;
    itemClass: string;
    probeByKey: Map<string, { listingCount: number; fetchedAt: number; recentCount: number | null; medianAskExalted: number | null }>;
    sampleMedianByKey: Map<string, { count: number; median: number }>;
    metaUses: number;
  },
): Promise<number> {
  const probe = opts.probeByKey.get(c.key);
  const sample = opts.sampleMedianByKey.get(c.key);
  let priority = opts.metaUses * 3;
  if (sample) {
    priority += sample.count * Math.log(Math.max(sample.median, 1));
  }
  if (probe) {
    const ageH = (Date.now() - probe.fetchedAt) / (60 * 60 * 1000);
    if (ageH > 24) priority += 5;
    if (probe.listingCount >= 5) priority += 3;
    if (probe.recentCount != null && probe.recentCount > 0) priority += 2;
    if (probe.listingCount >= 200 && (probe.recentCount ?? 0) < 2) {
      priority -= 4;
    }
  }
  if (c.variant === "premium") priority += 2;
  if (c.variant === "budget") priority -= 1;
  for (const g of c.groups) {
    if (KEY_MOD_GROUPS.has(g) && (c.minLevelPerGroup.get(g) ?? 0) > 0) {
      priority += 1;
    }
  }
  return priority;
}

/**
 * Enumerates tier-aware combo candidates for market scanning. Seeds from meta
 * templates, ladder imports, and sample co-occurrence; expands each seed into
 * at most three tier variants (practical / premium / budget).
 */
export async function buildTierCandidates(opts: {
  league: string;
  itemClass: string;
  classMods: EligibleMod[];
  maxCandidates?: number;
}): Promise<TierCandidate[]> {
  const maxCandidates = opts.maxCandidates ?? 200;
  const statMap = await buildModStatMap(opts.classMods);
  const labelByGroup = new Map<string, string>();
  for (const g of groupByModGroup(opts.classMods)) {
    labelByGroup.set(g.group, modLabel(g.mods[0]));
  }

  const seeds: { groups: string[]; labels: string[]; metaUses: number }[] = [];
  const seenSeed = new Set<string>();

  const addSeed = (groups: string[], metaUses = 0) => {
    const key = [...groups].sort().join("+");
    if (seenSeed.has(key)) return;
    seenSeed.add(key);
    if (!groups.every((g) => labelByGroup.has(g))) return;
    seeds.push({
      groups,
      labels: groups.map((g) => labelByGroup.get(g) ?? g),
      metaUses,
    });
  };

  try {
    const metaCombos = await getMetaCombos(opts.league, opts.itemClass);
    for (const combo of metaCombos) {
      addSeed(combo.groups, combo.uses);
    }
  } catch {
    /* optional */
  }

  for (const template of META_TEMPLATES) {
    addSeed(template);
  }

  try {
    const combosBySize = await getComboStats({
      league: opts.league,
      itemClass: opts.itemClass,
      sizes: [2, 3, 4, 5, 6],
      minCount: 3,
      limitPerSize: 8,
    });
    for (const size of [6, 5, 4, 3, 2]) {
      for (const combo of combosBySize.get(size) ?? []) {
        const groups: string[] = [];
        let ok = true;
        for (const id of combo.statIds) {
          const g = statMap.statToGroups.get(id)?.[0];
          if (!g) {
            ok = false;
            break;
          }
          if (!groups.includes(g)) groups.push(g);
        }
        if (ok && groups.length > 0) addSeed(groups);
      }
    }
  } catch {
    /* optional */
  }

  const variants: TierCandidate[] = [];
  const seenKey = new Set<string>();
  for (const seed of seeds) {
    for (const variant of ["practical", "premium", "budget"] as const) {
      const expanded = expandVariants(seed, opts.classMods, statMap, variant);
      if (!expanded || seenKey.has(expanded.key)) continue;
      seenKey.add(expanded.key);
      variants.push({ ...expanded, priority: 0 });
    }
  }

  const probes = await getProbes(opts.league, opts.itemClass).catch(() => []);
  const probeByKey = new Map(
    probes.map((p) => [
      p.comboKey,
      {
        listingCount: p.listingCount,
        fetchedAt: p.fetchedAt,
        recentCount: p.recentCount,
        medianAskExalted: p.medianAskExalted,
      },
    ]),
  );

  const sampleMedianByKey = new Map<string, { count: number; median: number }>();
  try {
    const combosBySize = await getComboStats({
      league: opts.league,
      itemClass: opts.itemClass,
      sizes: [2, 3, 4, 5, 6],
      minCount: 2,
      limitPerSize: 30,
    });
    for (const combos of combosBySize.values()) {
      for (const c of combos) {
        sampleMedianByKey.set(c.key, { count: c.count, median: c.medianExalted });
      }
    }
  } catch {
    /* optional */
  }

  const metaUsesBySeed = new Map(
    seeds.map((s) => [[...s.groups].sort().join("+"), s.metaUses] as const),
  );

  for (const c of variants) {
    const seedKey = [...c.groups].sort().join("+");
    c.priority = await scoreCandidate(c, {
      league: opts.league,
      itemClass: opts.itemClass,
      probeByKey,
      sampleMedianByKey,
      metaUses: metaUsesBySeed.get(seedKey) ?? 0,
    });
  }

  variants.sort((a, b) => b.priority - a.priority);
  return variants.slice(0, maxCandidates);
}

/** Whether probe-backed data meets the "good sample" gate for dashboard promotion. */
export function passesGoodSampleGate(opts: {
  listingCount: number | null;
  recentCount: number | null;
  sellThroughPerDay: number | null;
  sampleCount: number;
  saleSource: "probe" | "sample";
}): boolean {
  if (opts.saleSource === "probe") {
    const supply = opts.listingCount ?? 0;
    if (supply >= 5) return true;
    if (
      supply >= 1 &&
      (opts.recentCount ?? 0) >= 2 &&
      (opts.sellThroughPerDay ?? 0) > 0
    ) {
      return true;
    }
    return false;
  }
  return opts.sampleCount >= 5;
}
