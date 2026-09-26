"use client";

import Link from "next/link";
import type { BaseRecommendation } from "@/lib/craft/types";
import { formatCost } from "@/lib/pricing/format";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";

export function Recommendations({
  recs,
  itemLevel,
  goalParam,
  baseCost,
  divinePriceExalted = 0,
}: {
  recs: BaseRecommendation[];
  itemLevel: number;
  /** Encoded goal (the `groups` URL param). */
  goalParam: string;
  baseCost?: number;
  divinePriceExalted?: number;
}) {
  if (recs.length === 0) {
    return (
      <div className="panel p-8 text-center text-forge-gold/80">
        Select an item class and at least one required modifier to get base recommendations.
      </div>
    );
  }

  const planHref = (baseId: string) => {
    const p = new URLSearchParams({ mode: "base", base: baseId, ilvl: String(itemLevel), groups: goalParam });
    if (baseCost) p.set("cost", String(baseCost));
    return `/craft?${p.toString()}`;
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-forge-gold/80">
        Bases ranked by the brain&apos;s cheapest expected cost (quick pass), then by roll odds. Open one for the full
        plan.
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
                <p className="mt-0.5 text-xs text-forge-rust">Cannot roll: {r.missing.join(", ")}</p>
              ) : r.cheapestCostExalted != null ? (
                <p className="mt-0.5 text-xs text-forge-gold/80">
                  Cheapest:{" "}
                  <span className="text-rarity-currency">{formatCost(r.cheapestCostExalted, divinePriceExalted)}</span>{" "}
                  via {r.cheapestMethod}
                </p>
              ) : null}
            </div>
            <ActionWithInfo
              label="Build plan"
              summary="Opens the full plan for this base and goal."
              detail={[
                "Carries the base, item level, modifiers and base cost.",
                "The brain runs a full (slower, more precise) pass there.",
              ]}
              className="w-full sm:w-auto"
            >
              <Link href={planHref(r.baseId)} className="btn btn-primary w-full sm:w-auto">
                Build plan
              </Link>
            </ActionWithInfo>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.perGroup.map((g) => (
              <span key={g.group} className="tag-chip">
                {g.label}
                <span className="ml-1 text-forge-gold/80">{(g.odds * 100).toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
