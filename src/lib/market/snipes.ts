import "server-only";
import { getEligibleMods, searchBases } from "@/lib/data/queries";
import { groupByModGroup, modLabel } from "@/lib/data/format";
import type { EligibleMod } from "@/lib/data/types";
import { searchAndFetch, withTimeout, type TradeListing } from "@/lib/trade/client";
import { getCachedPriceMap, tradePriceToExalted } from "@/lib/trade/currency";
import { buildModStatMap, type ModStatMap } from "@/lib/trade/modMap";
import {
  buildTradeQuery,
  TOTAL_ELEM_RES_STAT,
  type TradeQueryOpts,
} from "@/lib/trade/query";
import { planFinish, type FinishCurrentMod, type FinishPlan } from "@/lib/solver/finish";
import { getDesecratedSimPool } from "@/lib/solver/registry";
import {
  slamOddsNote,
  slamTierProfile,
  slamValueFloor,
} from "@/lib/solver/tierMath";
import { tradeCategoryForClass } from "./categories";
import { estimateSaleValue, type SaleEstimate } from "./analytics";
import {
  comboKeyFromGroups,
  getProbeForGroups,
  getProbes,
  probeCombo,
} from "./probes";

/**
 * Snipe scanner: finds underpriced, partially-rolled listings that are
 * 1-2 actions away from a high-value item, and prices the finish with the
 * finisher solver. Templates codify known 0.5 recipes (the belt desecration
 * recipe, ES finishes, ...) plus auto-generated ones from high-value probe
 * combos that are one mod short.
 */

/* ----------------------------- templates ----------------------------- */

export type SnipeFinishSpec =
  | { kind: "desecrate"; side: "prefix" | "suffix" }
  | { kind: "slam"; side: "prefix" | "suffix"; candidates: string[] };

export interface SnipeTemplate {
  id: string;
  name: string;
  description: string;
  itemClass: string;
  source: "recipe" | "auto";
  /** Mod groups the listing must already have (becomes AND stat filters). */
  requiredGroups: string[];
  /** Non-stat search criteria (rarity, ilvl, open slots, price cap...). */
  query: Omit<TradeQueryOpts, "statIds">;
  finish: SnipeFinishSpec;
}

const RECIPE_TEMPLATES: SnipeTemplate[] = [
  {
    id: "belt-res-desecrate",
    name: "Belt: 70+ resists, open suffix → desecrate",
    description:
      "Buy ilvl-71+ rare belts with 70+ combined elemental resistances and " +
      "an open suffix. Ancient Collarbone + Omen of Dextral Necromancy puts " +
      "an unrevealed desecrated suffix straight into the open slot — reveal " +
      "at the Well of Souls. The classic 0.5 money-printer.",
    itemClass: "Belt",
    source: "recipe",
    requiredGroups: [],
    query: {
      rarity: "rare",
      ilvlMin: 71,
      statFilters: [{ id: TOTAL_ELEM_RES_STAT, min: 70 }],
      emptySuffixesMin: 1,
      maxPriceExalted: 60,
    },
    finish: { kind: "desecrate", side: "suffix" },
  },
  {
    id: "belt-life-res-desecrate",
    name: "Belt: life + 45 resists, open suffix → desecrate",
    description:
      "Same desecration finish but anchored on a life roll: rare belts with " +
      "maximum Life, 45+ combined resistances and an open suffix.",
    itemClass: "Belt",
    source: "recipe",
    requiredGroups: ["IncreasedLife"],
    query: {
      rarity: "rare",
      ilvlMin: 71,
      statFilters: [{ id: TOTAL_ELEM_RES_STAT, min: 45 }],
      emptySuffixesMin: 1,
      maxPriceExalted: 50,
    },
    finish: { kind: "desecrate", side: "suffix" },
  },
  {
    id: "boots-ms-life-slam",
    name: "Boots: movement speed + life, open suffix → slam resistance",
    description:
      "Rare boots with movement speed and life but an open suffix sell far " +
      "below finished res boots. Slam a resistance with an Exalted Orb " +
      "(omen only while prefixes are still open). The slam rolls a random " +
      "tier — EV is priced at the average tier outcome, not a T1 hit.",
    itemClass: "Boots",
    source: "recipe",
    requiredGroups: ["MovementVelocity", "IncreasedLife"],
    query: {
      rarity: "rare",
      ilvlMin: 65,
      emptySuffixesMin: 1,
      maxPriceExalted: 40,
    },
    finish: {
      kind: "slam",
      side: "suffix",
      candidates: [
        "FireResistance",
        "ColdResistance",
        "LightningResistance",
        "ChaosResistance",
      ],
    },
  },
  {
    id: "chest-es-slam",
    name: "Body Armour: double-ES prefixes, open prefix → slam life",
    description:
      "Energy-shield chests with both ES prefixes and an open prefix: slam " +
      "maximum Life to finish the standard ES-build chest.",
    itemClass: "Body Armour",
    source: "recipe",
    requiredGroups: ["EnergyShieldPercent", "IncreasedEnergyShield"],
    query: {
      rarity: "rare",
      ilvlMin: 65,
      emptyPrefixesMin: 1,
      maxPriceExalted: 50,
    },
    finish: { kind: "slam", side: "prefix", candidates: ["IncreasedLife"] },
  },
  {
    id: "amulet-desecrate",
    name: "Amulet: life + resist, open suffix → desecrate",
    description:
      "Rare amulets with life, a resistance and an open suffix: Gnawed " +
      "Jawbone + Omen of Dextral Necromancy for a desecrated suffix reveal.",
    itemClass: "Amulet",
    source: "recipe",
    requiredGroups: ["IncreasedLife"],
    query: {
      rarity: "rare",
      ilvlMin: 71,
      statFilters: [{ id: TOTAL_ELEM_RES_STAT, min: 30 }],
      emptySuffixesMin: 1,
      maxPriceExalted: 40,
    },
    finish: { kind: "desecrate", side: "suffix" },
  },
];

/* ----------------------------- class context ----------------------------- */

interface ClassContext {
  itemClass: string;
  itemLevel: number;
  baseIdByName: Map<string, string>;
  baseTags: string[];
  classMods: EligibleMod[];
  /** Stat map over normal + desecrated mods (sale estimation needs both). */
  statMap: ModStatMap;
  labelByGroup: Map<string, string>;
  sideByGroup: Map<string, "prefix" | "suffix">;
  /** Normal-pool mods per group (tier math for slam outcomes). */
  modsByGroup: Map<string, EligibleMod[]>;
}

async function loadClassContext(
  itemClass: string,
  itemLevel: number,
): Promise<ClassContext> {
  const bases = await searchBases({ itemClass, limit: 500 });
  const tagSet = new Set<string>();
  for (const b of bases) for (const t of b.tags) tagSet.add(t);
  const baseTags = [...tagSet];
  const classMods = await getEligibleMods(baseTags, itemLevel);
  const desecMods = await getEligibleMods(baseTags, itemLevel, {
    domains: ["desecrated"],
  });
  const statMap = await buildModStatMap([...classMods, ...desecMods]);

  const labelByGroup = new Map<string, string>();
  const sideByGroup = new Map<string, "prefix" | "suffix">();
  for (const g of groupByModGroup([...classMods, ...desecMods])) {
    labelByGroup.set(g.group, modLabel(g.mods[0]));
    const gen = g.mods[0].generationType;
    if (gen === "prefix" || gen === "suffix") sideByGroup.set(g.group, gen);
  }
  const modsByGroup = new Map<string, EligibleMod[]>();
  for (const g of groupByModGroup(classMods)) modsByGroup.set(g.group, g.mods);

  return {
    itemClass,
    itemLevel,
    baseIdByName: new Map(bases.map((b) => [b.name, b.id])),
    baseTags,
    classMods,
    statMap,
    labelByGroup,
    sideByGroup,
    modsByGroup,
  };
}

/* ----------------------------- auto templates ----------------------------- */

/**
 * Generates templates from stored high-value probe combos that are exactly
 * one slam-able mod short: search for listings carrying all-but-one of the
 * combo's groups with the missing side open, capped at a fraction of the
 * finished item's median ask.
 */
async function autoTemplates(
  league: string,
  ctx: ClassContext,
): Promise<SnipeTemplate[]> {
  const out: SnipeTemplate[] = [];
  try {
    const probes = await getProbes(league, ctx.itemClass);
    for (const p of probes) {
      if (out.length >= 4) break;
      const ask = p.medianAskExalted ?? p.minAskExalted;
      if (ask == null || ask < 25) continue;
      if (p.groups.length < 3 || p.groups.length > 5) continue;

      // Drop the LAST suffix-side group that exists in the normal pool —
      // suffix slams are the most common finish.
      const droppable = [...p.groups]
        .reverse()
        .find(
          (g) =>
            ctx.sideByGroup.has(g) &&
            (ctx.statMap.groupToStats.get(g)?.length ?? 0) > 0,
        );
      if (!droppable) continue;
      const side = ctx.sideByGroup.get(droppable)!;
      const rest = p.groups.filter((g) => g !== droppable);
      if (rest.length === 0) continue;
      if (!rest.every((g) => (ctx.statMap.groupToStats.get(g)?.length ?? 0) > 0))
        continue;

      out.push({
        id: `auto-${p.comboKey.slice(0, 24)}-${droppable}`,
        name: `${ctx.itemClass}: ${rest
          .map((g) => ctx.labelByGroup.get(g) ?? g)
          .join(" + ")} → slam ${ctx.labelByGroup.get(droppable) ?? droppable}`,
        description: `Auto-generated from a probe: the finished combo asks ~${Math.round(ask)}ex (${p.listingCount} listed). Buy listings one mod short with an open ${side} and slam the missing mod.`,
        itemClass: ctx.itemClass,
        source: "auto",
        requiredGroups: rest,
        query: {
          rarity: "rare",
          ilvlMin: 65,
          ...(side === "prefix"
            ? { emptyPrefixesMin: 1 }
            : { emptySuffixesMin: 1 }),
          maxPriceExalted: Math.max(5, Math.round(ask * 0.35)),
        },
        finish: { kind: "slam", side, candidates: [droppable] },
      });
    }
  } catch {
    /* probes unavailable — recipes only */
  }
  return out;
}

/** All templates applicable to an item class (recipes + auto-generated). */
export async function listSnipeTemplates(
  league: string,
  itemClass: string,
  itemLevel = 82,
): Promise<SnipeTemplate[]> {
  const recipes = RECIPE_TEMPLATES.filter((t) => t.itemClass === itemClass);
  const ctx = await loadClassContext(itemClass, itemLevel);
  const auto = await autoTemplates(league, ctx);
  return [...recipes, ...auto];
}

/* ----------------------------- scanning ----------------------------- */

export interface SnipeResult {
  listingId: string;
  baseName: string;
  ilvl: number;
  priceText: string;
  buyExalted: number;
  currentLabels: string[];
  targetLabel: string;
  /** Honest tier expectation for slam finishes (avg outcome, top-tier odds). */
  tierNote: string | null;
  successRate: number;
  finishCostExalted: number;
  saleExalted: number | null;
  saleSource: SaleEstimate["source"] | null;
  saleSamples: number;
  evExalted: number | null;
  feasible: boolean;
  warnings: string[];
  steps: { title: string; detail: string }[];
}

export interface SnipeScan {
  template: SnipeTemplate;
  tradeUrl: string;
  total: number;
  results: SnipeResult[];
  skipped: number;
  warnings: string[];
}

/** Current mods of a listing, resolved through the stat -> group map. */
function listingCurrentMods(
  listing: TradeListing,
  ctx: ClassContext,
): FinishCurrentMod[] {
  const out: FinishCurrentMod[] = [];
  const seen = new Set<string>();
  for (const stat of listing.explicitStats) {
    const groups = ctx.statMap.statToGroups.get(stat.hash) ?? [];
    const group = groups.find((g) => ctx.sideByGroup.has(g));
    if (!group || seen.has(group)) continue;
    seen.add(group);
    out.push({
      group,
      side: ctx.sideByGroup.get(group)!,
      level: stat.level ?? 0,
      rolledValue: stat.min ?? stat.max ?? undefined,
    });
  }
  return out;
}

/** Live-probe budget per scan: count AND wall-clock bounded (the trade API
 * rate limiter can stretch a single probe into a multi-minute wait). */
interface ProbeBudget {
  left: number;
  deadline: number;
  /** Live step reporting (optional). */
  report?: (text: string) => void;
}

/** The single trade stat id for a group, when the mapping is unambiguous. */
function soleStatId(ctx: ClassContext, group: string): string | null {
  const ids = ctx.statMap.groupToStats.get(group);
  return ids?.length === 1 ? ids[0] : null;
}

/**
 * Sale estimate with live fallback:
 *  1. local stores (probes / samples / manual sales),
 *  2. a stored tier-aware probe for this exact combo+floors,
 *  3. a fresh budgeted trade probe (persisted — free on the next scan).
 */
async function saleWithFallback(opts: {
  league: string;
  ctx: ClassContext;
  groups: string[];
  minLevelPerGroup: Map<string, number>;
  statMins: Map<string, number>;
  budget: ProbeBudget;
  /** Allow spending the live-probe budget for this combo. */
  allowLive: boolean;
}): Promise<SaleEstimate | null> {
  try {
    const local = await estimateSaleValue({
      league: opts.league,
      itemClass: opts.ctx.itemClass,
      groups: opts.groups,
      statIdsPerGroup: opts.ctx.statMap.groupToStats,
      minLevelPerGroup: opts.minLevelPerGroup,
    });
    if (local) return local;
  } catch {
    /* local stores unavailable */
  }

  const keyed = comboKeyFromGroups(
    opts.groups,
    opts.ctx.statMap.groupToStats,
    opts.statMins,
  );
  if (!keyed) return null;

  try {
    const stored = await getProbeForGroups({
      league: opts.league,
      itemClass: opts.ctx.itemClass,
      groups: opts.groups,
      statIdsPerGroup: opts.ctx.statMap.groupToStats,
      statMins: opts.statMins,
    });
    if (stored && stored.medianAskExalted != null && stored.listingCount > 0) {
      return {
        priceExalted: stored.medianAskExalted,
        sampleCount: stored.listingCount,
        source: "probe",
      };
    }
  } catch {
    /* probe store unavailable */
  }

  if (
    !opts.allowLive ||
    opts.budget.left <= 0 ||
    Date.now() > opts.budget.deadline
  ) {
    return null;
  }
  opts.budget.left--;
  opts.budget.report?.(
    `Pricing "${opts.groups
      .map((g) => opts.ctx.labelByGroup.get(g) ?? g)
      .join(" + ")}" with a live trade probe…`,
  );
  try {
    // Per-probe timeout: when the rate limiter is saturated, give up on this
    // combo instead of stalling the scan — the probe budget covers retries
    // on the NEXT scan, where everything priced so far is already stored.
    const probe = await withTimeout(
      probeCombo({
        league: opts.league,
        itemClass: opts.ctx.itemClass,
        groups: opts.groups,
        labels: opts.groups.map((g) => opts.ctx.labelByGroup.get(g) ?? g),
        statIds: keyed.statIds,
        statMins: opts.statMins,
        skipVelocity: true,
      }),
      20000,
    );
    if (probe && probe.medianAskExalted != null && probe.listingCount > 0) {
      return {
        priceExalted: probe.medianAskExalted,
        sampleCount: probe.listingCount,
        source: "probe",
      };
    }
    // Timed out — the request may still land and persist; don't keep queueing.
    if (probe === null) opts.budget.deadline = 0;
  } catch {
    // Probably rate-limited — stop spending the budget for this scan.
    opts.budget.left = 0;
  }
  return null;
}

/**
 * Picks the finish target with the best sale signal. Comparables are pinned
 * to the listing's ACTUAL rolls (value floors at ~90% of each rolled stat)
 * and, for slams, to the EXPECTED slam tier — never the top-tier fantasy.
 */
async function pickTarget(opts: {
  league: string;
  ctx: ClassContext;
  current: FinishCurrentMod[];
  candidates: string[];
  finishKind: "slam" | "desecrate";
  budget: ProbeBudget;
}): Promise<{ group: string; sale: SaleEstimate | null; tierNote: string | null }> {
  const { ctx } = opts;
  const currentGroups = opts.current.map((m) => m.group);
  // Tier-aware comparables: match listings rolled at the bought item's tiers.
  const minLevelPerGroup = new Map<string, number>();
  const baseMins = new Map<string, number>();
  for (const m of opts.current) {
    if ((m.level ?? 0) > 0) minLevelPerGroup.set(m.group, m.level!);
    const statId = soleStatId(ctx, m.group);
    if (statId && m.rolledValue != null && m.rolledValue > 0) {
      baseMins.set(statId, Math.max(1, Math.floor(m.rolledValue * 0.9)));
    }
  }

  let best: { group: string; sale: SaleEstimate | null } | null = null;
  const candidates = opts.candidates.slice(0, 5);
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const statMins = new Map(baseMins);
    if (opts.finishKind === "slam") {
      const profile = slamTierProfile(ctx.modsByGroup.get(cand) ?? []);
      const statId = soleStatId(ctx, cand);
      if (profile && statId) statMins.set(statId, slamValueFloor(profile));
    }
    const sale = await saleWithFallback({
      league: opts.league,
      ctx,
      groups: [...currentGroups, cand],
      minLevelPerGroup,
      statMins,
      budget: opts.budget,
      // Spread the budget across listings: live-probe only the first two
      // candidates per listing; the rest still get local-store pricing.
      allowLive: i < 2,
    });
    if (!best) best = { group: cand, sale };
    else if (
      sale &&
      (!best.sale || sale.priceExalted > best.sale.priceExalted)
    ) {
      best = { group: cand, sale };
    }
  }
  const picked = best ?? { group: opts.candidates[0], sale: null };

  let tierNote: string | null = null;
  if (opts.finishKind === "slam") {
    const profile = slamTierProfile(ctx.modsByGroup.get(picked.group) ?? []);
    if (profile) {
      tierNote = slamOddsNote(
        ctx.labelByGroup.get(picked.group) ?? picked.group,
        profile,
      );
    }
  }
  return { ...picked, tierNote };
}

/**
 * Runs one template scan: trade search -> per-listing finish plan -> rank by
 * EV. Costs at most 1 search + ceil(maxListings/10) fetch calls (all cached).
 */
export async function scanSnipeTemplate(opts: {
  league: string;
  templateId: string;
  itemClass: string;
  itemLevel?: number;
  maxListings?: number;
  /** Live step reporting for the UI (optional). */
  onProgress?: (
    text: string,
    o?: { current?: number; total?: number },
  ) => void;
}): Promise<SnipeScan | null> {
  const report = opts.onProgress ?? (() => {});
  const itemLevel = opts.itemLevel ?? 82;
  report("Loading templates and class mod data…");
  const templates = await listSnipeTemplates(
    opts.league,
    opts.itemClass,
    itemLevel,
  );
  const template = templates.find((t) => t.id === opts.templateId);
  if (!template) return null;

  const ctx = await loadClassContext(template.itemClass, itemLevel);
  const warnings: string[] = [];

  const statIds: string[] = [];
  for (const g of template.requiredGroups) {
    const ids = ctx.statMap.groupToStats.get(g);
    if (!ids?.length) {
      warnings.push(`"${g}" has no trade-stat mapping — filter skipped.`);
      continue;
    }
    statIds.push(...ids);
  }

  const category = tradeCategoryForClass(template.itemClass);
  const query = buildTradeQuery({
    ...template.query,
    ...(category ? { category } : {}),
    statIds,
    sort: { price: "asc" },
  });

  report(`Searching the trade site for "${template.name}"…`);
  const res = await searchAndFetch(opts.league, query, {
    maxListings: Math.min(20, opts.maxListings ?? 10),
    ttlMs: 10 * 60 * 1000,
  });
  report(
    `${res.total} matching listings online — evaluating the ${res.listings.length} cheapest.`,
    { current: 0, total: res.listings.length },
  );
  const priceMap = await getCachedPriceMap(opts.league);

  // Desecration candidates (shared across listings of the same class).
  let desecCandidates: string[] = [];
  if (template.finish.kind === "desecrate") {
    const desecPool = await getDesecratedSimPool(ctx.baseTags, itemLevel);
    const sideGroups =
      template.finish.side === "prefix"
        ? desecPool.prefixes
        : desecPool.suffixes;
    desecCandidates = sideGroups.map((g) => g.group);
    if (desecCandidates.length === 0) {
      warnings.push(
        `No desecrated ${template.finish.side} mods exist for ${template.itemClass} — scan aborted.`,
      );
      return {
        template,
        tradeUrl: res.tradeUrl,
        total: res.total,
        results: [],
        skipped: res.listings.length,
        warnings,
      };
    }
  }

  const results: SnipeResult[] = [];
  let skipped = 0;
  // Live-probe budget for the whole scan. Probes persist, so each scan adds
  // coverage and later scans read earlier discoveries back for free. The
  // wall-clock deadline keeps a rate-limited API from stalling the scan.
  const budget: ProbeBudget = {
    left: 12,
    deadline: Date.now() + 90 * 1000,
    report,
  };

  for (let li = 0; li < res.listings.length; li++) {
    const listing = res.listings[li];
    report(
      `(${li + 1}/${res.listings.length}) ${listing.baseType}${
        listing.price ? ` @ ${listing.price.amount} ${listing.price.currency}` : ""
      } — resolving mods and picking the finish…`,
      { current: li, total: res.listings.length },
    );
    if (!listing.price) {
      skipped++;
      continue;
    }
    const buyEx = tradePriceToExalted(
      listing.price.amount,
      listing.price.currency,
      priceMap,
    );
    if (buyEx == null || buyEx <= 0) {
      skipped++;
      continue;
    }
    const baseId = ctx.baseIdByName.get(listing.baseType);
    if (!baseId) {
      skipped++;
      continue;
    }
    const current = listingCurrentMods(listing, ctx);
    if (current.length === 0) {
      skipped++;
      continue;
    }
    const currentGroups = current.map((m) => m.group);

    const candidates =
      template.finish.kind === "desecrate"
        ? desecCandidates
        : template.finish.candidates.filter(
            (g) => !currentGroups.includes(g),
          );
    if (candidates.length === 0) {
      skipped++;
      continue;
    }
    const target = await pickTarget({
      league: opts.league,
      ctx,
      current,
      candidates,
      finishKind: template.finish.kind,
      budget,
    });

    let plan: FinishPlan | null = null;
    try {
      plan = await planFinish({
        baseId,
        itemLevel: listing.ilvl ?? itemLevel,
        current,
        desiredGroups: [target.group],
        buyPriceExalted: buyEx,
        saleOverride: target.sale,
        // The scanner owns the probe budget — don't probe per listing.
        allowLiveProbe: false,
        // Snipe economics: slam into the open slot(s) once; on a miss, sell
        // the item as-is. Never model omen-priced annul grinds on cheap bases.
        cleanup: false,
        trials: 1500,
      });
    } catch {
      /* skip un-plannable listings */
    }
    if (!plan) {
      skipped++;
      continue;
    }

    report(
      `(${li + 1}/${res.listings.length}) ${listing.baseType}: finish "${
        ctx.labelByGroup.get(target.group) ?? target.group
      }" — ${Math.round(plan.successRate * 100)}% success, EV ${
        plan.evExalted != null ? `${plan.evExalted}ex` : "unknown"
      }.`,
      { current: li + 1, total: res.listings.length },
    );

    results.push({
      listingId: listing.id,
      baseName: listing.name
        ? `${listing.name}, ${listing.baseType}`
        : listing.baseType,
      ilvl: listing.ilvl ?? itemLevel,
      priceText: `${listing.price.amount} ${listing.price.currency}`,
      buyExalted: Math.round(buyEx * 100) / 100,
      currentLabels: currentGroups.map((g) => ctx.labelByGroup.get(g) ?? g),
      targetLabel: ctx.labelByGroup.get(target.group) ?? target.group,
      tierNote: target.tierNote,
      successRate: plan.successRate,
      finishCostExalted: plan.finishCostExalted,
      saleExalted: plan.estimatedSale?.priceExalted ?? null,
      saleSource: plan.estimatedSale?.source ?? null,
      saleSamples: plan.estimatedSale?.sampleCount ?? 0,
      evExalted: plan.evExalted,
      feasible: plan.feasible,
      warnings: plan.warnings,
      steps: plan.steps.map((s) => ({ title: s.title, detail: s.detail })),
    });
  }

  const unpriced = results.filter((r) => r.saleExalted == null).length;
  if (
    unpriced > 0 &&
    (budget.left <= 0 || Date.now() > budget.deadline)
  ) {
    warnings.push(
      `${unpriced} listing(s) had no sale price yet — the live-probe budget ran out. Scan again in a minute: probes persist, so coverage builds up.`,
    );
  }

  results.sort((a, b) => {
    if (a.evExalted != null && b.evExalted != null)
      return b.evExalted - a.evExalted;
    if (a.evExalted != null) return -1;
    if (b.evExalted != null) return 1;
    return b.successRate - a.successRate;
  });

  return {
    template,
    tradeUrl: res.tradeUrl,
    total: res.total,
    results,
    skipped,
    warnings,
  };
}
