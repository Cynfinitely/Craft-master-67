import Link from "next/link";
import type { BaseRecommendation } from "@/lib/solver/types";
import { formatCost } from "@/lib/pricing/format";

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
        Bases ranked by how easily your selected modifiers can be hit (higher is
        easier). Open one to build a full step-by-step plan.
      </p>
      {recs.map((r, i) => (
        <div key={r.baseId} className="panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
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
                </p>
              ) : null}
            </div>
            <Link
              href={`/craft?mode=base&base=${encodeURIComponent(r.baseId)}&ilvl=${itemLevel}&groups=${encodeURIComponent(groupsParam)}`}
              className="btn btn-primary shrink-0"
            >
              Build plan
            </Link>
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
