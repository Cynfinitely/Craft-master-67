import { and, eq } from "drizzle-orm";
import { getClient, getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { comboProbes } from "@/db/schema";
import { groupByModGroup, modLabel } from "@/lib/data/format";
import type { EligibleMod } from "@/lib/data/types";
import {
  searchAndFetch,
  tradeSearch,
  tradeSiteUrl,
} from "@/lib/trade/client";
import { getCachedPriceMap, tradePriceToExalted } from "@/lib/trade/currency";
import { buildModStatMap } from "@/lib/trade/modMap";
import { tradeCategoryForClass } from "./categories";
import { getComboStats } from "./analytics";

/**
 * Targeted combo probing — the precise side of market intelligence.
 *
 * Instead of inferring combo value from whatever random listings the sampler
 * happened to collect, a probe runs ONE stat-filtered trade search per
 * explicit-mod combination and records the exact supply (listing count),
 * cheapest/median asks, and how many were listed in the last day (a
 * demand/velocity proxy). Probes are persisted in `combo_probes` and
 * refreshed lazily within a strict per-run budget.
 *
 * Candidate combos come from:
 *  1. meta archetype templates intersected with the class's real mod pool,
 *  2. high-value combos discovered by the random sampler,
 *  3. ad-hoc user requests (the /craft target set).
 */

export interface ComboProbe {
  id: string;
  league: string;
  itemClass: string;
  comboKey: string;
  groups: string[];
  labels: string[];
  listingCount: number;
  minAskExalted: number | null;
  medianAskExalted: number | null;
  recentCount: number | null;
  tradeUrl: string | null;
  fetchedAt: number;
}

/** Meta archetype templates (repoe mod-group names, verified against the DB).
 * Templates not fully present in a class's pool are skipped automatically. */
const META_TEMPLATES: string[][] = [
  // Armour / jewellery staples
  ["IncreasedLife", "FireResistance"],
  ["IncreasedLife", "ColdResistance"],
  ["IncreasedLife", "LightningResistance"],
  ["IncreasedLife", "ChaosResistance"],
  ["IncreasedLife", "FireResistance", "ColdResistance"],
  ["IncreasedLife", "FireResistance", "LightningResistance"],
  ["IncreasedLife", "ColdResistance", "LightningResistance"],
  ["IncreasedLife", "AllResistances"],
  ["IncreasedLife", "AllAttributes"],
  ["IncreasedLife", "ItemFoundRarityIncrease"],
  ["IncreasedLife", "BaseSpirit"],
  ["IncreasedEnergyShield", "EnergyShieldPercent"],
  ["EnergyShieldPercent", "IncreasedLife"],
  ["EnergyShieldPercent", "FireResistance"],
  ["IncreasedLife", "LifeRegeneration"],
  // Boots
  ["MovementVelocity", "IncreasedLife"],
  ["MovementVelocity", "FireResistance"],
  ["MovementVelocity", "IncreasedLife", "FireResistance"],
  ["MovementVelocity", "IncreasedLife", "ChaosResistance"],
  // Attack weapons
  ["LocalPhysicalDamagePercent", "IncreasedAttackSpeed"],
  ["LocalPhysicalDamagePercent", "AddedPhysicalDamage"],
  ["LocalPhysicalDamagePercent", "IncreasedAttackSpeed", "AddedPhysicalDamage"],
  ["IncreasedWeaponElementalDamagePercent", "IncreasedAttackSpeed"],
  ["CriticalStrikeChanceIncrease", "CriticalStrikeMultiplier"],
  // Caster
  ["IncreasedCastSpeed", "IncreasedMana"],
  ["IncreaseSocketedGemLevel", "IncreasedCastSpeed"],
  // 4-6 mod archetypes — finished items carry up to 6 explicits, and these
  // full builds are what actually changes hands at high prices.
  ["IncreasedLife", "FireResistance", "ColdResistance", "LightningResistance"],
  ["IncreasedLife", "FireResistance", "ColdResistance", "ChaosResistance"],
  ["IncreasedLife", "BaseSpirit", "FireResistance", "ColdResistance"],
  [
    "IncreasedLife",
    "FireResistance",
    "ColdResistance",
    "LightningResistance",
    "ChaosResistance",
  ],
  [
    "IncreasedLife",
    "BaseSpirit",
    "FireResistance",
    "ColdResistance",
    "LightningResistance",
  ],
  ["MovementVelocity", "IncreasedLife", "FireResistance", "ColdResistance"],
  [
    "MovementVelocity",
    "IncreasedLife",
    "FireResistance",
    "ColdResistance",
    "LightningResistance",
  ],
  [
    "EnergyShieldPercent",
    "IncreasedEnergyShield",
    "IncreasedLife",
    "FireResistance",
  ],
  [
    "EnergyShieldPercent",
    "IncreasedEnergyShield",
    "FireResistance",
    "ColdResistance",
    "LightningResistance",
  ],
  [
    "LocalPhysicalDamagePercent",
    "AddedPhysicalDamage",
    "IncreasedAttackSpeed",
    "CriticalStrikeChanceIncrease",
  ],
  [
    "LocalPhysicalDamagePercent",
    "AddedPhysicalDamage",
    "IncreasedAttackSpeed",
    "CriticalStrikeChanceIncrease",
    "CriticalStrikeMultiplier",
  ],
  [
    "IncreaseSocketedGemLevel",
    "IncreasedCastSpeed",
    "IncreasedMana",
    "CriticalStrikeChanceIncrease",
  ],
];

/** Canonical probe key: every group's stat ids, deduped and sorted. When a
 * min VALUE floor applies to a stat (tier-aware probes), it's part of the
 * key — "70% total res" and "30% total res" are different markets. */
export function comboKeyFromGroups(
  groups: string[],
  statIdsPerGroup: Map<string, string[]>,
  statMins?: Map<string, number>,
): { key: string; statIds: string[] } | null {
  const ids = new Set<string>();
  for (const g of groups) {
    const mapped = statIdsPerGroup.get(g);
    if (!mapped || mapped.length === 0) return null;
    for (const id of mapped) ids.add(id);
  }
  const sorted = [...ids].sort();
  const key = sorted
    .map((id) => {
      const min = statMins?.get(id);
      return min != null && min > 0 ? `${id}>=${Math.round(min)}` : id;
    })
    .join("+");
  return { key, statIds: sorted };
}

function probeId(league: string, itemClass: string, key: string): string {
  return `${league}|${itemClass}|${key}`;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildProbeQuery(
  category: string | null,
  statIds: string[],
  opts: { recentOnly?: boolean; statMins?: Map<string, number> } = {},
): Record<string, unknown> {
  return {
    query: {
      status: { option: "online" },
      stats: [
        {
          type: "and",
          filters: statIds.map((id) => {
            const min = opts.statMins?.get(id);
            return min != null && min > 0
              ? { id, value: { min: Math.round(min) }, disabled: false }
              : { id, disabled: false };
          }),
        },
      ],
      filters: {
        type_filters: {
          filters: {
            rarity: { option: "rare" },
            ...(category ? { category: { option: category } } : {}),
          },
        },
        ...(opts.recentOnly
          ? {
              trade_filters: {
                filters: { indexed: { option: "1day" } },
              },
            }
          : {}),
      },
    },
    sort: { price: "asc" },
  };
}

/**
 * Runs a single combo probe (price search + 1-day velocity search) and
 * persists the result. ~2 trade API calls, both cached by the trade client.
 */
export async function probeCombo(opts: {
  league: string;
  itemClass: string;
  groups: string[];
  labels: string[];
  statIds: string[];
  /** Min VALUE per stat id — prices the tier bracket, not just presence. */
  statMins?: Map<string, number>;
  /** Skip the 1-day velocity search (halves API cost for bulk scans). */
  skipVelocity?: boolean;
  ttlMs?: number;
}): Promise<ComboProbe | null> {
  const category = tradeCategoryForClass(opts.itemClass);
  if (!category) return null;
  const ttlMs = opts.ttlMs ?? 6 * 60 * 60 * 1000;
  const priceMap = await getCachedPriceMap(opts.league);

  const res = await searchAndFetch(
    opts.league,
    buildProbeQuery(category, opts.statIds, { statMins: opts.statMins }),
    { maxListings: 10, ttlMs },
  );

  const asks: number[] = [];
  for (const l of res.listings) {
    if (!l.price) continue;
    const ex = tradePriceToExalted(l.price.amount, l.price.currency, priceMap);
    if (ex != null && ex > 0) asks.push(ex);
  }
  asks.sort((a, b) => a - b);

  // Velocity probe: how many matching listings appeared in the last day.
  let recentCount: number | null = null;
  if (!opts.skipVelocity) {
    try {
      const recent = await tradeSearch(
        opts.league,
        buildProbeQuery(category, opts.statIds, {
          recentOnly: true,
          statMins: opts.statMins,
        }),
        { ttlMs },
      );
      recentCount = recent.total;
    } catch {
      /* velocity is optional */
    }
  }

  const key = [...opts.statIds]
    .sort()
    .map((id) => {
      const min = opts.statMins?.get(id);
      return min != null && min > 0 ? `${id}>=${Math.round(min)}` : id;
    })
    .join("+");
  const probe: ComboProbe = {
    id: probeId(opts.league, opts.itemClass, key),
    league: opts.league,
    itemClass: opts.itemClass,
    comboKey: key,
    groups: opts.groups,
    labels: opts.labels,
    listingCount: res.total,
    minAskExalted: asks[0] ?? null,
    medianAskExalted: median(asks.slice(0, 5)),
    recentCount,
    tradeUrl: res.tradeUrl || tradeSiteUrl(opts.league, ""),
    fetchedAt: Date.now(),
  };

  await ensureAppTables();
  await getClient().execute({
    sql: `INSERT OR REPLACE INTO combo_probes
      (id, league, item_class, combo_key, groups, labels, listing_count,
       min_ask_exalted, median_ask_exalted, recent_count, trade_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      probe.id,
      probe.league,
      probe.itemClass,
      probe.comboKey,
      JSON.stringify(probe.groups),
      JSON.stringify(probe.labels),
      probe.listingCount,
      probe.minAskExalted,
      probe.medianAskExalted,
      probe.recentCount,
      probe.tradeUrl,
      probe.fetchedAt,
    ],
  });
  return probe;
}

function rowToProbe(r: typeof comboProbes.$inferSelect): ComboProbe {
  return {
    id: r.id,
    league: r.league,
    itemClass: r.itemClass,
    comboKey: r.comboKey,
    groups: JSON.parse(r.groups) as string[],
    labels: JSON.parse(r.labels) as string[],
    listingCount: r.listingCount,
    minAskExalted: r.minAskExalted,
    medianAskExalted: r.medianAskExalted,
    recentCount: r.recentCount,
    tradeUrl: r.tradeUrl,
    fetchedAt: r.fetchedAt,
  };
}

/** All stored probes for a class, newest first. */
export async function getProbes(
  league: string,
  itemClass: string,
): Promise<ComboProbe[]> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(comboProbes)
    .where(
      and(eq(comboProbes.league, league), eq(comboProbes.itemClass, itemClass)),
    );
  return rows
    .map(rowToProbe)
    .sort(
      (a, b) =>
        (b.medianAskExalted ?? b.minAskExalted ?? 0) -
        (a.medianAskExalted ?? a.minAskExalted ?? 0),
    );
}

/** Exact-match probe lookup for a target group set (no API call). */
export async function getProbeForGroups(opts: {
  league: string;
  itemClass: string;
  groups: string[];
  statIdsPerGroup: Map<string, string[]>;
  /** Match the tier-aware key when value floors were used. */
  statMins?: Map<string, number>;
  maxAgeMs?: number;
}): Promise<ComboProbe | null> {
  const keyed = comboKeyFromGroups(
    opts.groups,
    opts.statIdsPerGroup,
    opts.statMins,
  );
  if (!keyed) return null;
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(comboProbes)
    .where(eq(comboProbes.id, probeId(opts.league, opts.itemClass, keyed.key)))
    .limit(1);
  if (rows.length === 0) return null;
  const probe = rowToProbe(rows[0]);
  const maxAge = opts.maxAgeMs ?? 24 * 60 * 60 * 1000;
  if (Date.now() - probe.fetchedAt > maxAge) return null;
  return probe;
}

export interface ProbeRunResult {
  probes: ComboProbe[];
  refreshed: number;
  candidates: number;
}

interface Candidate {
  groups: string[];
  labels: string[];
  statIds: string[];
  key: string;
}

/**
 * Builds the candidate combo list for an item class: meta templates that the
 * class's real mod pool supports, plus high-value combos discovered by the
 * random sampler. `classMods` is the class-wide eligible mod pool (the caller
 * already has it for the solver).
 */
async function buildCandidates(
  league: string,
  itemClass: string,
  classMods: EligibleMod[],
): Promise<Candidate[]> {
  const statMap = await buildModStatMap(classMods);
  const labelByGroup = new Map<string, string>();
  for (const g of groupByModGroup(classMods)) {
    labelByGroup.set(g.group, modLabel(g.mods[0]));
  }

  const out: Candidate[] = [];
  const seen = new Set<string>();

  // 1) Meta templates supported by this class's pool.
  for (const template of META_TEMPLATES) {
    if (!template.every((g) => labelByGroup.has(g))) continue;
    const keyed = comboKeyFromGroups(template, statMap.groupToStats);
    if (!keyed || seen.has(keyed.key)) continue;
    seen.add(keyed.key);
    out.push({
      groups: template,
      labels: template.map((g) => labelByGroup.get(g) ?? g),
      statIds: keyed.statIds,
      key: keyed.key,
    });
  }

  // 2) High-value combos surfaced by the random sampler.
  try {
    const combosBySize = await getComboStats({
      league,
      itemClass,
      sizes: [2, 3, 4, 5, 6],
      minCount: 2,
      limitPerSize: 8,
    });
    const sampled = [
      ...(combosBySize.get(6) ?? []),
      ...(combosBySize.get(5) ?? []),
      ...(combosBySize.get(4) ?? []),
      ...(combosBySize.get(3) ?? []),
      ...(combosBySize.get(2) ?? []),
    ].sort((a, b) => b.medianExalted - a.medianExalted);
    for (const combo of sampled) {
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
      if (!ok || groups.length === 0) continue;
      const keyed = comboKeyFromGroups(groups, statMap.groupToStats);
      if (!keyed || seen.has(keyed.key)) continue;
      seen.add(keyed.key);
      out.push({
        groups,
        labels: groups.map((g) => labelByGroup.get(g) ?? g),
        statIds: keyed.statIds,
        key: keyed.key,
      });
    }
  } catch {
    /* sampler data is optional */
  }

  return out;
}

/**
 * Refreshes stale probes for an item class within a strict budget (default 6
 * probes ≈ 12 trade API calls per run) and returns ALL stored probes. Fresh
 * probes are served from SQLite without touching the API.
 */
export async function runProbes(opts: {
  league: string;
  itemClass: string;
  classMods: EligibleMod[];
  maxProbes?: number;
  staleMs?: number;
  /** Live step reporting for the UI (optional). */
  onProgress?: (
    text: string,
    o?: { current?: number; total?: number },
  ) => void;
}): Promise<ProbeRunResult> {
  const report = opts.onProgress ?? (() => {});
  const maxProbes = Math.max(1, Math.min(20, opts.maxProbes ?? 6));
  const staleMs = opts.staleMs ?? 6 * 60 * 60 * 1000;

  report(`Building candidate combos for ${opts.itemClass}…`);
  const candidates = await buildCandidates(
    opts.league,
    opts.itemClass,
    opts.classMods,
  );
  const existing = await getProbes(opts.league, opts.itemClass);
  const byKey = new Map(existing.map((p) => [p.comboKey, p]));

  const now = Date.now();
  const stale = candidates.filter((c) => {
    const p = byKey.get(c.key);
    return !p || now - p.fetchedAt > staleMs;
  });

  const toRun = stale.slice(0, maxProbes);
  report(
    `${candidates.length} candidate combos; ${existing.length} already stored, ${stale.length} stale — probing ${toRun.length} now (2 trade calls each).`,
    { current: 0, total: toRun.length },
  );

  let refreshed = 0;
  for (let i = 0; i < toRun.length; i++) {
    const c = toRun[i];
    const comboName = c.labels.join(" + ");
    report(`Probing ${comboName} (${i + 1}/${toRun.length})…`, {
      current: i,
      total: toRun.length,
    });
    try {
      const probe = await probeCombo({
        league: opts.league,
        itemClass: opts.itemClass,
        groups: c.groups,
        labels: c.labels,
        statIds: c.statIds,
        ttlMs: staleMs,
      });
      if (probe) {
        refreshed++;
        const ask =
          probe.medianAskExalted ?? probe.minAskExalted;
        report(
          `${comboName}: ${probe.listingCount} listed${
            ask != null ? `, asks ~${Math.round(ask * 10) / 10}ex` : ""
          }${probe.recentCount != null ? `, ${probe.recentCount} new today` : ""}.`,
          { current: i + 1, total: toRun.length },
        );
      }
    } catch (err) {
      console.warn(`combo probe failed (${c.key}): ${err}`);
      report(
        `Probe for ${comboName} failed (likely rate-limited) — stopping early to respect the API.`,
        { current: i + 1, total: toRun.length },
      );
      break; // budget the failure too — likely rate limited
    }
  }

  return {
    probes: await getProbes(opts.league, opts.itemClass),
    refreshed,
    candidates: candidates.length,
  };
}
