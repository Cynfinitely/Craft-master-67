import { binomialQuantiles } from "@/lib/solver/simulate";
import type { SimMethodId } from "@/lib/solver/simulate";

export interface BatchProfitInput {
  basesCount: number;
  hitRate: number;
  sellableRate: number;
  adjustedSaleExalted: number;
  totalCostExalted: number;
  nearMissResaleExalted: number;
  craftMinutesPerBase: number;
  timeToSellDays: number | null;
  holdingCostPerDay?: number;
}

export interface ProfitMetrics {
  profitPerCraftP50: number;
  profitPerCraftP10: number;
  profitPerCraftP90: number;
  roiPercent: number;
  profitPerHour: number | null;
  adjustedProfitP50: number;
  totalBatchProfitP50: number;
  totalBatchProfitP10: number;
  totalBatchProfitP90: number;
}

/** Rough active-craft time per base, used for profit/hour ranking. */
export const METHOD_CRAFT_MINUTES: Partial<Record<SimMethodId, number>> = {
  "alch-spam": 1,
  "alch-chaos": 2,
  "transmute-regal-exalt": 2,
  "perfect-seed": 3,
  "essence-exalt": 2,
  "omen-exalt": 3,
  "essence-omen-exalt": 3,
  "essence-desec-double-exalt": 4,
  "fracture-omen-exalt": 5,
  "fractured-finish": 5,
  "desecrate-omen-exalt": 4,
};

export function craftMinutesForMethod(methodId: SimMethodId): number {
  return METHOD_CRAFT_MINUTES[methodId] ?? 2;
}

export function computeBatchProfit(input: BatchProfitInput): ProfitMetrics {
  const n = input.basesCount;
  const { p10, p50, p90 } = binomialQuantiles(n, input.sellableRate);
  const revenueAt = (hits: number) =>
    hits * input.adjustedSaleExalted + input.nearMissResaleExalted;
  const profitAt = (hits: number) => revenueAt(hits) - input.totalCostExalted;

  const profitP50 = profitAt(p50);
  const profitP10 = profitAt(p10);
  const profitP90 = profitAt(p90);
  const profitPerCraftP50 = n > 0 ? profitP50 / n : 0;
  const roiPercent =
    input.totalCostExalted > 0 ? (profitP50 / input.totalCostExalted) * 100 : 0;

  const craftHours = (n * input.craftMinutesPerBase) / 60;
  const sellHours = (input.timeToSellDays ?? 0) * 24;
  const totalHours = craftHours + sellHours;
  const profitPerHour = totalHours > 0 ? profitP50 / totalHours : null;

  const holding =
    (input.holdingCostPerDay ?? 0) * (input.timeToSellDays ?? 0);

  return {
    profitPerCraftP50,
    profitPerCraftP10: n > 0 ? profitP10 / n : 0,
    profitPerCraftP90: n > 0 ? profitP90 / n : 0,
    roiPercent,
    profitPerHour,
    adjustedProfitP50: profitP50 - holding,
    totalBatchProfitP50: profitP50,
    totalBatchProfitP10: profitP10,
    totalBatchProfitP90: profitP90,
  };
}

export interface SinglePlanProfitInput {
  costExalted: number;
  adjustedSaleExalted: number;
  sellableRate: number;
  nearMissResaleExalted?: number;
  craftMinutes: number;
  timeToSellDays: number | null;
  holdingCostPerDay?: number;
}

export function estimateSinglePlanProfit(
  input: SinglePlanProfitInput,
): ProfitMetrics {
  const rate = Math.max(0, Math.min(1, input.sellableRate));
  return computeBatchProfit({
    basesCount: 1,
    hitRate: rate,
    sellableRate: rate,
    adjustedSaleExalted: input.adjustedSaleExalted,
    totalCostExalted: input.costExalted,
    nearMissResaleExalted: input.nearMissResaleExalted ?? 0,
    craftMinutesPerBase: input.craftMinutes,
    timeToSellDays: input.timeToSellDays,
    holdingCostPerDay: input.holdingCostPerDay,
  });
}

export type RankMode = "craft" | "hour" | "roi";

export interface RankableOpportunity {
  profitP50Exalted: number;
  profitPerHour: number | null;
  roiPercent: number;
  adjustedProfitP50: number;
  confidence: "high" | "medium" | "low";
  saturated: boolean;
  totalCostExalted: number;
  brickRisk?: number;
}

const CONFIDENCE_TIER = { high: 2, medium: 1, low: 0 } as const;

export function rankOpportunities<T extends RankableOpportunity>(
  opps: T[],
  mode: RankMode,
): T[] {
  const sorted = [...opps];
  const key = (o: T): number => {
    if (mode === "hour") {
      return o.profitPerHour ?? o.adjustedProfitP50 / 48;
    }
    if (mode === "roi") return o.roiPercent;
    return o.profitP50Exalted;
  };
  sorted.sort((a, b) => {
    const t = CONFIDENCE_TIER[b.confidence] - CONFIDENCE_TIER[a.confidence];
    if (t !== 0) return t;
    if (a.saturated !== b.saturated) return a.saturated ? 1 : -1;
    return key(b) - key(a);
  });
  return sorted;
}

export type MinConfidence = "low" | "medium" | "high";

export function filterOpportunities<T extends RankableOpportunity>(
  opps: T[],
  opts: {
    minConfidence?: MinConfidence;
    maxBatchCostExalted?: number | null;
    maxBrickRisk?: number | null;
  },
): T[] {
  const minConf = opts.minConfidence ?? "low";
  const confOk = (c: RankableOpportunity["confidence"]) =>
    CONFIDENCE_TIER[c] >= CONFIDENCE_TIER[minConf];
  return opps.filter((o) => {
    if (!confOk(o.confidence)) return false;
    if (
      opts.maxBatchCostExalted != null &&
      o.totalCostExalted > opts.maxBatchCostExalted
    ) {
      return false;
    }
    if (
      opts.maxBrickRisk != null &&
      o.brickRisk != null &&
      o.brickRisk > opts.maxBrickRisk
    ) {
      return false;
    }
    return true;
  });
}
