import "server-only";
import { getEligibleMods, searchBases } from "@/lib/data/queries";
import { groupByModGroup, modLabel } from "@/lib/data/format";
import type { EligibleMod } from "@/lib/data/types";
import { searchAndFetch, type TradeListing } from "@/lib/trade/client";
import { getCachedPriceMap, tradePriceToExalted } from "@/lib/trade/currency";
import { buildModStatMap, type ModStatMap } from "@/lib/trade/modMap";
import {
  buildTradeQuery,
  TOTAL_ELEM_RES_STAT,
  type TradeQueryOpts,
} from "@/lib/trade/query";
import { planFinish, type FinishCurrentMod, type FinishPlan } from "@/lib/solver/finish";
import { getDesecratedSimPool } from "@/lib/solver/registry";
import { tradeCategoryForClass } from "./categories";
import { estimateSaleValue, type SaleEstimate } from "./analytics";
import { getProbes } from "./probes";

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
      "below finished triple-res boots. Slam the missing resistance with an " +
      "Exalted Orb (omen only while prefixes are still open).",
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

  return {
    itemClass,
    itemLevel,
    baseIdByName: new Map(bases.map((b) => [b.name, b.id])),
    baseTags,
    classMods,
    statMap,
    labelByGroup,
    sideByGroup,
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
    });
  }
  return out;
}

/** Picks the finish target with the best local sale signal. */
async function pickTarget(opts: {
  league: string;
  ctx: ClassContext;
  current: FinishCurrentMod[];
  candidates: string[];
}): Promise<{ group: string; sale: SaleEstimate | null }> {
  const currentGroups = opts.current.map((m) => m.group);
  // Tier-aware comparables: match listings rolled at the bought item's tiers.
  const minLevelPerGroup = new Map<string, number>();
  for (const m of opts.current) {
    if ((m.level ?? 0) > 0) minLevelPerGroup.set(m.group, m.level!);
  }
  let best: { group: string; sale: SaleEstimate | null } | null = null;
  for (const cand of opts.candidates.slice(0, 5)) {
    let sale: SaleEstimate | null = null;
    try {
      sale = await estimateSaleValue({
        league: opts.league,
        itemClass: opts.ctx.itemClass,
        groups: [...currentGroups, cand],
        statIdsPerGroup: opts.ctx.statMap.groupToStats,
        minLevelPerGroup,
      });
    } catch {
      /* local data only */
    }
    if (!best) best = { group: cand, sale };
    else if (
      sale &&
      (!best.sale || sale.priceExalted > best.sale.priceExalted)
    ) {
      best = { group: cand, sale };
    }
  }
  return best ?? { group: opts.candidates[0], sale: null };
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
}): Promise<SnipeScan | null> {
  const itemLevel = opts.itemLevel ?? 82;
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

  const res = await searchAndFetch(opts.league, query, {
    maxListings: Math.min(20, opts.maxListings ?? 10),
    ttlMs: 10 * 60 * 1000,
  });
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

  for (const listing of res.listings) {
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
        trials: 1500,
      });
    } catch {
      /* skip un-plannable listings */
    }
    if (!plan) {
      skipped++;
      continue;
    }

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
