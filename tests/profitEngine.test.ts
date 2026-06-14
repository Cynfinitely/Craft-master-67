import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBatchProfit,
  rankOpportunities,
} from "../src/lib/market/profitEngine";

describe("computeBatchProfit", () => {
  it("computes batch profit with near-miss resale", () => {
    const result = computeBatchProfit({
      basesCount: 10,
      hitRate: 0.08,
      sellableRate: 0.08,
      adjustedSaleExalted: 40,
      totalCostExalted: 200,
      nearMissResaleExalted: 15,
      craftMinutesPerBase: 2,
      timeToSellDays: 2,
    });
    assert.ok(result.totalBatchProfitP50 < 0);
    assert.ok(result.roiPercent < 0);
    assert.ok(result.profitPerHour != null);
  });

  it("computes profit per hour with craft and sell time", () => {
    const result = computeBatchProfit({
      basesCount: 5,
      hitRate: 0.2,
      sellableRate: 0.25,
      adjustedSaleExalted: 50,
      totalCostExalted: 100,
      nearMissResaleExalted: 0,
      craftMinutesPerBase: 2,
      timeToSellDays: 1,
    });
    assert.ok(Math.abs(result.profitPerCraftP50 - -10) < 1);
    const craftHours = (5 * 2) / 60;
    const totalHours = craftHours + 24;
    assert.ok(
      Math.abs(result.profitPerHour! - -50 / totalHours) < 0.5,
    );
  });
});

describe("rankOpportunities", () => {
  it("sorts by profit per hour when mode is hour", () => {
    const opps = [
      {
        profitP50Exalted: 100,
        profitPerHour: 1,
        roiPercent: 50,
        adjustedProfitP50: 90,
        confidence: "high" as const,
        saturated: false,
        totalCostExalted: 50,
      },
      {
        profitP50Exalted: 20,
        profitPerHour: 5,
        roiPercent: 200,
        adjustedProfitP50: 18,
        confidence: "high" as const,
        saturated: false,
        totalCostExalted: 10,
      },
    ];
    const ranked = rankOpportunities(opps, "hour");
    assert.equal(ranked[0].profitPerHour, 5);
  });
});
