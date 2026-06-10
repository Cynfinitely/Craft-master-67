import "server-only";
import { getModPool } from "@/lib/data/queries";
import { groupByModGroup, modLabel } from "@/lib/data/format";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { buildModStatMap } from "@/lib/trade/modMap";
import { withTimeout } from "@/lib/trade/client";
import { estimateSaleValue, type SaleEstimate } from "@/lib/market/analytics";
import { makePricer } from "./index";
import { boneForClass, getDesecratedSimPool } from "./registry";
import { MAX_DESECRATED_MODS } from "./rules";
import {
  buildSimPool,
  simulateFinish,
  type SimDesecrateSpec,
  type SimStartMod,
  type SimTarget,
  type SimulationResult,
} from "./simulate";

/**
 * Finisher solver: given a PARTIALLY-ROLLED item (pasted from the game or a
 * trade listing), work out the legal finishing actions under the 0.5 rules
 * and the expected value of finishing it versus its predicted sale price.
 * This is the engine behind "snipe and finish".
 */

export interface FinishCurrentMod {
  group: string;
  side: "prefix" | "suffix";
  /** Modifier level of the rolled tier (0 when unknown). */
  level?: number;
  fractured?: boolean;
  desecrated?: boolean;
}

export interface FinishStep {
  n: number;
  title: string;
  detail: string;
  currency?: string;
  costExalted?: number;
}

export interface FinishPlan {
  feasible: boolean;
  warnings: string[];
  baseId: string;
  baseName: string;
  itemClass: string;
  itemLevel: number;
  /** Targets still missing from the item. */
  remaining: { group: string; label: string; side: "prefix" | "suffix" }[];
  steps: FinishStep[];
  /** Expected finishing currency per attempt, in Exalted. */
  finishCostExalted: number;
  /** P(this item ends with every remaining target). */
  successRate: number;
  sim: SimulationResult;
  /** Predicted sale price of the finished item. */
  estimatedSale: SaleEstimate | null;
  /**
   * EV of buying+finishing ONE item:
   * successRate x sale − (buy price + finish cost). Failures are valued at 0.
   */
  evExalted: number | null;
  buyPriceExalted: number | null;
  divinePriceExalted: number;
}

function parseGroupEntry(raw: string): {
  group: string;
  minLevel: number;
  desecrated: boolean;
} {
  const [g, levelPart] = raw.split("@");
  const desecrated = levelPart?.endsWith("~d") ?? false;
  const minLevel = levelPart
    ? Number.parseInt(levelPart.replace(/~d$/, ""), 10) || 0
    : 0;
  return { group: g, minLevel, desecrated };
}

export async function planFinish(opts: {
  baseId: string;
  itemLevel: number;
  /** Mods currently on the item. */
  current: FinishCurrentMod[];
  /** Desired FINAL mod set ("Group@<minLevel>" / "Group@<minLevel>~d"). */
  desiredGroups: string[];
  /** What the item costs to buy (exalted), when known. */
  buyPriceExalted?: number | null;
  /** Pre-computed sale estimate (the snipe scanner passes its probe price). */
  saleOverride?: SaleEstimate | null;
  trials?: number;
}): Promise<FinishPlan | null> {
  const pool = await getModPool(opts.baseId, opts.itemLevel);
  if (!pool) return null;

  const warnings: string[] = [];
  let feasible = true;

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
  if (!league) league = await withTimeout(getCurrentLeagueName(), 5000);
  const price = makePricer(priceMap);

  /* ---- resolve targets and current state ---- */
  const preGroups = new Map(
    groupByModGroup(pool.prefixes).map((g) => [g.group, g]),
  );
  const sufGroups = new Map(
    groupByModGroup(pool.suffixes).map((g) => [g.group, g]),
  );
  const desecPool = await getDesecratedSimPool(pool.base.tags, opts.itemLevel);
  const labelOf = (group: string): string => {
    const hit = preGroups.get(group) ?? sufGroups.get(group);
    if (hit) return modLabel(hit.mods[0]);
    return desecPool.labels.get(group) ?? group;
  };

  const startMods: SimStartMod[] = opts.current.map((m) => ({
    group: m.group,
    side: m.side,
    level: m.level ?? 0,
    fractured: m.fractured,
    desecrated: m.desecrated,
  }));
  const onItem = new Set(startMods.map((m) => m.group));

  const targets: SimTarget[] = [];
  const desecratedWanted: { group: string; side: "prefix" | "suffix"; minLevel: number }[] = [];

  for (const raw of opts.desiredGroups) {
    const { group, minLevel, desecrated } = parseGroupEntry(raw);
    if (onItem.has(group)) continue; // already there
    const pre = preGroups.get(group);
    const suf = sufGroups.get(group);
    let side: "prefix" | "suffix" | null = pre
      ? "prefix"
      : suf
        ? "suffix"
        : null;
    // Desecrated-only groups don't exist in the normal pool — find their side
    // in the desecrated pool instead.
    let isDesecrated = desecrated;
    if (!side) {
      if (desecPool.prefixes.some((g) => g.group === group)) {
        side = "prefix";
        isDesecrated = true;
      } else if (desecPool.suffixes.some((g) => g.group === group)) {
        side = "suffix";
        isDesecrated = true;
      }
    }
    if (!side) {
      warnings.push(`"${group}" cannot roll on this base — skipped.`);
      continue;
    }
    if (isDesecrated) {
      desecratedWanted.push({ group, side, minLevel });
    }
    targets.push({ group, side, minLevel });
  }

  /* ---- 0.5 legality checks ---- */
  const desecratedOnItem = startMods.filter((m) => m.desecrated).length;
  if (desecratedOnItem + desecratedWanted.length > MAX_DESECRATED_MODS) {
    warnings.push(
      `This finish needs ${desecratedWanted.length} more desecrated modifier(s) but the item ${
        desecratedOnItem > 0 ? "already has one" : "can only hold one"
      } — 0.5 caps items at ${MAX_DESECRATED_MODS} Desecrated modifier.`,
    );
    feasible = false;
  }
  const sideCounts = { prefix: 0, suffix: 0 };
  for (const m of startMods) sideCounts[m.side]++;
  for (const t of targets) {
    sideCounts[t.side]++;
  }
  if (sideCounts.prefix > 3 || sideCounts.suffix > 3) {
    warnings.push(
      "Current mods + remaining targets exceed 3 prefixes / 3 suffixes — some existing mods must be annulled first (risky) or the targets reduced.",
    );
  }

  /* ---- desecration spec (direct bone into an open slot) ---- */
  let desecrateSpec: SimDesecrateSpec | undefined;
  const bone = boneForClass(pool.base.itemClass);
  const desecWanted = desecratedWanted[0];
  if (feasible && desecWanted) {
    if (!bone) {
      warnings.push(
        `No Abyssal bone applies to ${pool.base.itemClass} — the desecrated target can't be added.`,
      );
      feasible = false;
    } else {
      const sideGroups =
        desecWanted.side === "prefix" ? desecPool.prefixes : desecPool.suffixes;
      desecrateSpec = {
        side: desecWanted.side,
        targetGroup: desecWanted.group,
        groups: sideGroups,
        useEchoes: sideGroups.length > 12,
        boneApiId: `ancient-${bone.boneApi}`,
        necroApiId:
          desecWanted.side === "prefix"
            ? "omen-of-sinistral-necromancy"
            : "omen-of-dextral-necromancy",
        skipAbyssMark: true, // desecrate straight into the open slot
      };
    }
  }

  /* ---- simulate the finish ---- */
  const simPool = buildSimPool(pool.prefixes, pool.suffixes);
  const sim = simulateFinish(
    simPool,
    startMods,
    targets,
    { desecrate: desecrateSpec },
    { trials: opts.trials ?? 3000, price },
  );
  const successRate = sim.fullHitRate;
  const finishCost = sim.avgCurrencyCostExalted;

  /* ---- sale estimate ---- */
  let sale: SaleEstimate | null = opts.saleOverride ?? null;
  if (!sale && league) {
    try {
      const statMap = await withTimeout(
        buildModStatMap([...pool.prefixes, ...pool.suffixes]),
        10000,
      );
      if (statMap) {
        const allGroups = [
          ...startMods.map((m) => m.group),
          ...targets.map((t) => t.group),
        ];
        // Tier floors: the finished item carries the CURRENT rolls plus the
        // targeted tiers — match comparables on those tiers, not just groups.
        const minLevelPerGroup = new Map<string, number>();
        for (const m of startMods) {
          if (m.level > 0) minLevelPerGroup.set(m.group, m.level);
        }
        for (const t of targets) {
          if (t.minLevel > 0) minLevelPerGroup.set(t.group, t.minLevel);
        }
        sale = await estimateSaleValue({
          league,
          itemClass: pool.base.itemClass,
          groups: allGroups,
          statIdsPerGroup: statMap.groupToStats,
          minLevelPerGroup,
        });
      }
    } catch {
      /* sale estimate optional */
    }
  }
  if (!sale) {
    warnings.push(
      "No market data for the finished mod combo — EV can't be computed. Probe this combo on the Market page first.",
    );
  }

  /* ---- steps (human-readable) ---- */
  const steps: FinishStep[] = [];
  let n = 1;
  if (desecrateSpec && bone) {
    const necroName =
      desecrateSpec.side === "prefix"
        ? "Omen of Sinistral Necromancy"
        : "Omen of Dextral Necromancy";
    const perTry =
      price(desecrateSpec.boneApiId) +
      price(desecrateSpec.necroApiId) +
      (desecrateSpec.useEchoes ? price("omen-of-abyssal-echoes") : 0);
    steps.push({
      n: n++,
      title: `Desecrate the open ${desecrateSpec.side} with an Ancient ${bone.bone} + ${necroName}`,
      detail: `Adds an unrevealed desecrated ${desecrateSpec.side}; reveal at the Well of Souls and pick "${labelOf(desecrateSpec.targetGroup)}" if offered${
        desecrateSpec.useEchoes
          ? " (Omen of Abyssal Echoes shows 5 options instead of 3)"
          : " (1 of 3 options)"
      }. 0.5 allows only one desecrated mod, so there is no re-roll on a miss.`,
      currency: `Ancient ${bone.bone}`,
      costExalted: Math.round(perTry * 100) / 100,
    });
  }
  for (const t of targets.filter(
    (t) => !desecratedWanted.some((d) => d.group === t.group),
  )) {
    const omenName =
      t.side === "prefix"
        ? "Omen of Sinistral Exaltation"
        : "Omen of Dextral Exaltation";
    steps.push({
      n: n++,
      title: `Slam "${labelOf(t.group)}" with Exalted Orbs`,
      detail: `Add ${omenName} only while the other side still has wanted open slots (plain slams are cheaper once junk there is harmless). On a miss, clean up with Annul + ${
        t.side === "prefix"
          ? "Omen of Sinistral Annulment"
          : "Omen of Dextral Annulment"
      } — the Annul is random within the side and can strip a finished mod.`,
      currency: "Exalted Orb",
    });
  }

  const buy = opts.buyPriceExalted ?? null;
  const ev =
    sale != null
      ? Math.round(
          successRate * sale.priceExalted - ((buy ?? 0) + finishCost),
        )
      : null;

  return {
    feasible,
    warnings,
    baseId: opts.baseId,
    baseName: pool.base.name,
    itemClass: pool.base.itemClass,
    itemLevel: opts.itemLevel,
    remaining: targets.map((t) => ({
      group: t.group,
      label: labelOf(t.group),
      side: t.side,
    })),
    steps,
    finishCostExalted: Math.round(finishCost * 100) / 100,
    successRate,
    sim,
    estimatedSale: sale,
    evExalted: ev,
    buyPriceExalted: buy,
    divinePriceExalted,
  };
}
