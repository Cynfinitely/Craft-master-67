import type { MinConfidence, RankMode } from "./profitEngine";

export interface ProfitPrefs {
  rankMode: RankMode;
  holdingCostPerDay: number;
  minConfidence: MinConfidence;
  maxBatchCostExalted: number | null;
  hideHighBrick: boolean;
  backgroundScanEnabled: boolean;
  showSpeculativeCombos: boolean;
}

export const DEFAULT_PROFIT_PREFS: ProfitPrefs = {
  rankMode: "hour",
  holdingCostPerDay: 0.5,
  minConfidence: "medium",
  maxBatchCostExalted: null,
  hideHighBrick: true,
  backgroundScanEnabled: false,
  showSpeculativeCombos: false,
};

/** Parse rank mode from URL search param. */
export function parseRankMode(raw: string | undefined): RankMode {
  if (raw === "craft" || raw === "hour" || raw === "roi") return raw;
  return DEFAULT_PROFIT_PREFS.rankMode;
}
