"use client";

import Link from "next/link";
import type { BaseRecommendation } from "@/lib/craft/types";
import { formatCost } from "@/lib/pricing/format";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const NO_BASE_HINT = "Try lower minimum tiers, fewer modifiers (or mark some optional), or a higher item level.";

export function Recommendations({
  recs,
  hasGoal,
  itemLevel,
  goalParam,
  baseCost,
  divinePriceExalted = 0,
}: {
  recs: BaseRecommendation[];
  /** Whether the applied goal has at least one required modifier. */
  hasGoal: boolean;
  itemLevel: number;
  /** Encoded goal (the `groups` URL param). */
  goalParam: string;
  baseCost?: number;
  divinePriceExalted?: number;
}) {
  if (!hasGoal) {
    return (
      <EmptyState title="No goal yet">
        Select an item class and at least one required (not optional) modifier above, then press “Recommend
        bases”.
      </EmptyState>
    );
  }

  if (recs.length === 0) {
    return <EmptyState title="No base can roll all of these modifiers">{NO_BASE_HINT}</EmptyState>;
  }

  // Recommendations are sorted with fully-rollable bases first.
  const noneQualify = recs[0].missing.length > 0;

  const planHref = (baseId: string) => {
    const p = new URLSearchParams({ mode: "base", base: baseId, ilvl: String(itemLevel), groups: goalParam });
    if (baseCost) p.set("cost", String(baseCost));
    return `/craft?${p.toString()}`;
  };

  return (
    <div className="space-y-3">
      {noneQualify ? (
        <Alert tone="warn" title="No base can roll all of these modifiers">
          {NO_BASE_HINT} The closest bases are listed below.
        </Alert>
      ) : (
        <p className="text-sm text-forge-muted">
          Bases ranked by the brain&apos;s cheapest expected cost (quick pass), then by roll odds. Open one for the
          full plan.
        </p>
      )}
      {recs.map((r, i) => {
        const best = i === 0 && r.missing.length === 0;
        return (
          <div key={r.baseId} className="panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="flex flex-wrap items-center gap-2 font-semibold text-rarity-normal">
                  {best ? (
                    <Badge tone="accent">
                      <span aria-hidden="true">★</span> Best
                    </Badge>
                  ) : null}
                  {r.baseName}
                </h3>
                {r.missing.length > 0 ? (
                  <p className="mt-0.5 text-xs text-forge-rust-strong">Cannot roll: {r.missing.join(", ")}</p>
                ) : r.cheapestCostExalted != null ? (
                  <p className="mt-0.5 text-xs text-forge-muted">
                    Cheapest:{" "}
                    <span className="num text-rarity-currency">
                      {formatCost(r.cheapestCostExalted, divinePriceExalted)}
                    </span>{" "}
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
                <Link
                  href={planHref(r.baseId)}
                  aria-label={`Build plan for ${r.baseName}`}
                  className={`btn w-full sm:w-auto ${best ? "btn-primary" : ""}`}
                >
                  Build plan
                </Link>
              </ActionWithInfo>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {r.perGroup.map((g) => (
                <span key={g.group} className="tag-chip">
                  {g.label}
                  <span className="num ml-1 text-forge-muted">{(g.odds * 100).toFixed(1)}%</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
