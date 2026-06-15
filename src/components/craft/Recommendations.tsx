"use client";

import Link from "next/link";
import type { BaseRecommendation } from "@/lib/solver/types";
import { formatCost } from "@/lib/pricing/format";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";

export function Recommendations({
  recs,
  itemLevel,
  groups,
  divinePriceExalted = 0,
}: {
  recs: BaseRecommendation[];
  itemLevel: number;
  groups: string[];
  divinePriceExalted?: number;
}) {
  if (recs.length === 0) {
    return (
      <div className="panel p-8 text-center text-forge-gold/50">
        Select an item class and at least one desired modifier to get base
        recommendations.
      </div>
    );
  }

  const groupsParam = groups.join(",");

  return (
    <div className="space-y-3">
      <p className="text-sm text-forge-gold/60">
        Bases ranked by rollability and expected profit when market data
        exists (probe-backed sale estimates weighted heavily). Open one to
        build a full step-by-step plan.
      </p>
      {recs.map((r, i) => (
        <div key={r.baseId} className="panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-rarity-normal">
                {i === 0 ? "★ " : ""}
                {r.baseName}
              </h3>
              {r.missing.length > 0 ? (
                <p className="mt-0.5 text-xs text-forge-rust">
                  Cannot roll: {r.missing.join(", ")}
                </p>
              ) : r.cheapestCostExalted != null ? (
                <p className="mt-0.5 text-xs text-forge-gold/60">
                  Cheapest:{" "}
                  <span className="text-rarity-currency">
                    {formatCost(r.cheapestCostExalted, divinePriceExalted)}
                  </span>{" "}
                  via {r.cheapestMethod}
                  {r.expectedProfitExalted != null ? (
                    <>
                      {" "}
                      · est. profit{" "}
                      <span
                        className={
                          r.expectedProfitExalted >= 0
                            ? "text-emerald-300"
                            : "text-forge-rust"
                        }
                      >
                        {r.expectedProfitExalted >= 0 ? "+" : ""}
                        {formatCost(r.expectedProfitExalted, divinePriceExalted)}
                      </span>
                      {r.saleConfidence ? (
                        <span className="text-forge-gold/45">
                          {" "}
                          ({r.saleConfidence} confidence)
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <ActionWithInfo
              label="Build plan"
              summary="Opens a full step-by-step plan for this base and mods."
              detail={[
                "Carries base, item level, and staged modifier groups.",
                "Runs the planner with live prices on the craft page.",
                "Compare methods by cost, profit, or ROI after opening.",
              ]}
              className="w-full sm:w-auto"
            >
              <Link
                href={`/craft?mode=base&base=${encodeURIComponent(r.baseId)}&ilvl=${itemLevel}&groups=${encodeURIComponent(groupsParam)}`}
                className="btn btn-primary w-full sm:w-auto"
              >
                Build plan
              </Link>
            </ActionWithInfo>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.perGroup.map((g) => (
              <span key={g.group} className="tag-chip">
                {g.label}
                <span className="ml-1 text-forge-gold/40">
                  {(g.odds * 100).toFixed(1)}%
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
