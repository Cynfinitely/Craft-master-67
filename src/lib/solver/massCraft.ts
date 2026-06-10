import "server-only";
import { getModPool } from "@/lib/data/queries";
import { groupByModGroup, modLabel } from "@/lib/data/format";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { getBasePrice, type BasePriceQuote } from "@/lib/trade/basePrice";
import { buildModStatMap } from "@/lib/trade/modMap";
import { withTimeout } from "@/lib/trade/client";
import { estimateSaleValue, type SaleEstimate } from "@/lib/market/analytics";
import { resolveFlux } from "./flux";
import { makePricer } from "./index";
import { buildSimSpecs } from "./registry";
import {
  binomialQuantiles,
  buildSimPool,
  simulateMethod,
  SIM_METHODS,
  type BatchQuantiles,
  type SimMethodId,
  type SimTarget,
  type SimulationResult,
} from "./simulate";

/**
 * Mass-crafting planner: "buy N bases at this item level, run method M on
 * each, what do I get?" — Monte Carlo per-base outcomes, live base purchase
 * price, and market-sample revenue, combined into a batch P&L.
 */

export interface MassTargetView {
  group: string;
  label: string;
  side: "prefix" | "suffix";
  minLevel: number;
}

export interface MassCraftPlan {
  baseId: string;
  baseName: string;
  itemClass: string;
  itemLevel: number;
  league: string | null;
  basesCount: number;
  method: { id: SimMethodId; name: string; blurb: string };
  targets: MassTargetView[];
  sim: SimulationResult;
  /** Hits across the batch of `basesCount` bases. */
  batchHits: BatchQuantiles;
  baseQuote: BasePriceQuote | null;
  essence: { name: string; group: string } | null;
  /** Flux conversion in play: any elemental res counts toward the target. */
  flux: { name: string; apiId: string; pricePerHit: number } | null;
  costs: {
    currencyPerBase: number;
    basePerBase: number | null;
    totalExalted: number;
    /** True when the base purchase price could not be fetched. */
    excludesBasePrice: boolean;
    costPerHit: number | null;
  };
  sale: SaleEstimate | null;
  revenue: {
    expectedExalted: number | null;
    profitExalted: number | null;
    profitP10Exalted: number | null;
    profitP90Exalted: number | null;
  };
  warnings: string[];
  divinePriceExalted: number;
}

function parseGroupEntry(raw: string): { group: string; minLevel: number } {
  const [g, levelPart] = raw.split("@");
  const minLevel = levelPart
    ? Number.parseInt(levelPart.replace(/~d$/, ""), 10) || 0
    : 0;
  return { group: g, minLevel };
}

export async function planMassCraft(opts: {
  baseId: string;
  itemLevel: number;
  desiredGroups: string[];
  methodId: SimMethodId;
  basesCount: number;
  trials?: number;
  maxChaos?: number;
}): Promise<MassCraftPlan | null> {
  const pool = await getModPool(opts.baseId, opts.itemLevel);
  if (!pool) return null;

  const method = SIM_METHODS.find((m) => m.id === opts.methodId);
  if (!method) return null;

  const warnings: string[] = [];
  const basesCount = Math.min(5000, Math.max(1, Math.round(opts.basesCount)));

  /* ---- resolve targets ---- */
  const preGroups = new Map(groupByModGroup(pool.prefixes).map((g) => [g.group, g]));
  const sufGroups = new Map(groupByModGroup(pool.suffixes).map((g) => [g.group, g]));

  const targets: SimTarget[] = [];
  const targetViews: MassTargetView[] = [];
  for (const raw of opts.desiredGroups) {
    const { group, minLevel } = parseGroupEntry(raw);
    const pre = preGroups.get(group);
    const suf = sufGroups.get(group);
    const hit = pre ?? suf;
    if (!hit) {
      warnings.push(
        `"${group}" cannot roll on this base at item level ${opts.itemLevel} — skipped.`,
      );
      continue;
    }
    const side: "prefix" | "suffix" = pre ? "prefix" : "suffix";
    targets.push({ group, side, minLevel });
    targetViews.push({
      group,
      label: modLabel(hit.mods[0]),
      side,
      minLevel,
    });
  }
  if (targets.length === 0) return null;

  // Flux conversion (0.5): with one targeted resistance type, any elemental
  // res roll counts — the hit is converted with a cheap Flux afterwards.
  const fluxPlan = resolveFlux(targets.map((t) => t.group));
  let fluxInfo: { name: string; apiId: string } | null = null;
  if (fluxPlan) {
    const t = targets.find((x) => x.group === fluxPlan.targetGroup);
    if (t) {
      const sideMap = t.side === "prefix" ? preGroups : sufGroups;
      const surrogates = fluxPlan.surrogateGroups.filter((g) => sideMap.has(g));
      if (surrogates.length > 0) {
        t.altGroups = surrogates;
        fluxInfo = { name: fluxPlan.fluxName, apiId: fluxPlan.fluxApiId };
      }
    }
  }

  /* ---- prices ---- */
  let priceMap = new Map<string, number>();
  let divinePriceExalted = 0;
  let league: string | null = null;
  try {
    const prices = await getPrices();
    priceMap = new Map(prices.items.map((i) => [i.apiId, i.priceExalted]));
    divinePriceExalted = prices.divinePrice;
    league = prices.league;
  } catch {
    warnings.push("Live currency prices unavailable — using fallback prices.");
  }
  if (!league) {
    league = await withTimeout(getCurrentLeagueName(), 5000);
  }
  const price = makePricer(priceMap);

  /* ---- per-method prerequisites (essence / desecration / fracture) ---- */
  const bundle = await buildSimSpecs({
    pool,
    targets,
    price,
    maxChaos: opts.maxChaos,
  });
  let spec = bundle.specs.get(opts.methodId);
  if (!spec) {
    // Prerequisite missing (no essence / no bone / single target): fall back
    // to the closest runnable policy instead of refusing.
    const usesEssence =
      opts.methodId === "essence-exalt" || opts.methodId === "essence-omen-exalt";
    if (usesEssence) {
      warnings.push(
        "No essence can guarantee any selected mod at the requested tier — the essence step is skipped (directional slams only).",
      );
      spec = bundle.specs.get("omen-exalt") ?? { id: "omen-exalt" };
    } else if (opts.methodId === "desecrate-omen-exalt") {
      warnings.push(
        "No selected mod can be revealed at the Well of Souls on this class — desecration skipped (directional slams only).",
      );
      spec = bundle.specs.get("omen-exalt") ?? { id: "omen-exalt" };
    } else {
      spec = { id: opts.methodId, maxChaos: opts.maxChaos };
    }
  }
  const essenceView =
    spec.essence != null
      ? { name: spec.essence.name, group: spec.essence.group }
      : null;

  /* ---- simulate ---- */
  const simPool = buildSimPool(pool.prefixes, pool.suffixes);
  const sim = simulateMethod(simPool, targets, spec, {
    trials: opts.trials ?? 3000,
    price,
  });
  const batchHits = binomialQuantiles(basesCount, sim.fullHitRate);

  /* ---- base purchase price (best-effort) ---- */
  let baseQuote: BasePriceQuote | null = null;
  if (league) {
    baseQuote = await withTimeout(
      getBasePrice({
        league,
        baseType: pool.base.name,
        rarity: "normal",
        ilvlMin: opts.itemLevel,
        priceMap,
      }),
      20000,
    );
  }
  if (!baseQuote) {
    warnings.push(
      "No live price for white bases — totals exclude the base purchase cost.",
    );
  }

  /* ---- sale value from market samples ---- */
  let sale: SaleEstimate | null = null;
  if (league) {
    try {
      const statMap = await withTimeout(
        buildModStatMap([...pool.prefixes, ...pool.suffixes]),
        10000,
      );
      if (statMap) {
        const minLevelPerGroup = new Map<string, number>();
        for (const t of targets) {
          if (t.minLevel > 0) minLevelPerGroup.set(t.group, t.minLevel);
        }
        sale = await estimateSaleValue({
          league,
          itemClass: pool.base.itemClass,
          groups: targets.map((t) => t.group),
          statIdsPerGroup: statMap.groupToStats,
          minLevelPerGroup,
        });
      }
    } catch {
      /* sale estimate is optional */
    }
  }
  if (!sale) {
    warnings.push(
      "No market samples match this mod combination yet — sample this item class on the Market page to get revenue estimates.",
    );
  }

  /* ---- P&L ---- */
  const currencyPerBase = sim.avgCurrencyCostExalted;
  const basePerBase = baseQuote?.priceExalted ?? null;
  const expectedHits = batchHits.mean;
  // One Flux per finished item (conservative: only hits that landed as a
  // different element actually need it).
  const fluxPricePerHit = fluxInfo ? price(fluxInfo.apiId) : 0;
  const totalExalted =
    basesCount * (currencyPerBase + (basePerBase ?? 0)) +
    expectedHits * fluxPricePerHit;
  const costPerHit = expectedHits > 0.005 ? totalExalted / expectedHits : null;

  const expectedRevenue = sale ? expectedHits * sale.priceExalted : null;
  const profit = expectedRevenue != null ? expectedRevenue - totalExalted : null;
  const profitP10 =
    sale != null ? batchHits.p10 * sale.priceExalted - totalExalted : null;
  const profitP90 =
    sale != null ? batchHits.p90 * sale.priceExalted - totalExalted : null;

  return {
    baseId: opts.baseId,
    baseName: pool.base.name,
    itemClass: pool.base.itemClass,
    itemLevel: opts.itemLevel,
    league,
    basesCount,
    method,
    targets: targetViews,
    sim,
    batchHits,
    baseQuote,
    essence: essenceView,
    flux: fluxInfo
      ? { ...fluxInfo, pricePerHit: fluxPricePerHit }
      : null,
    costs: {
      currencyPerBase,
      basePerBase,
      totalExalted,
      excludesBasePrice: basePerBase == null,
      costPerHit,
    },
    sale,
    revenue: {
      expectedExalted: expectedRevenue,
      profitExalted: profit,
      profitP10Exalted: profitP10,
      profitP90Exalted: profitP90,
    },
    warnings,
    divinePriceExalted,
  };
}
