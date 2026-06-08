"use client";

import Link from "next/link";
import { useState } from "react";
import type { SavedPlanSummary } from "@/lib/user/queries";

function craftHref(p: SavedPlanSummary): string {
  const groups = [...p.plan.desiredPrefixes, ...p.plan.desiredSuffixes]
    .map((d) => d.group)
    .join(",");
  const params = new URLSearchParams({
    mode: "base",
    ilvl: String(p.plan.itemLevel),
  });
  if (p.baseId) params.set("base", p.baseId);
  if (groups) params.set("groups", groups);
  return `/craft?${params.toString()}`;
}

export function SavedPlansList({ initial }: { initial: SavedPlanSummary[] }) {
  const [plans, setPlans] = useState(initial);

  const remove = async (id: number) => {
    setPlans((p) => p.filter((x) => x.id !== id));
    await fetch(`/api/plans?id=${id}`, { method: "DELETE" });
  };

  if (plans.length === 0) {
    return (
      <div className="panel p-8 text-center text-forge-gold/50">
        No saved plans yet. Build a plan in the Crafting Planner and click
        &ldquo;Save plan&rdquo;.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {plans.map((p) => (
        <li key={p.id} className="panel p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-forge-goldbright">{p.name}</h3>
              <p className="text-sm text-forge-gold/60">
                {p.plan.baseName} · {p.plan.desiredPrefixes.length}p /{" "}
                {p.plan.desiredSuffixes.length}s · iLvl {p.plan.itemLevel}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link href={craftHref(p)} className="btn btn-primary">
                Open
              </Link>
              <button
                type="button"
                className="btn"
                onClick={() => remove(p.id)}
              >
                Delete
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.plan.desiredPrefixes.map((d) => (
              <span
                key={d.group}
                className="rounded border border-affix-prefix/40 bg-affix-prefix/10 px-2 py-0.5 text-xs text-affix-prefix"
              >
                {d.label}
              </span>
            ))}
            {p.plan.desiredSuffixes.map((d) => (
              <span
                key={d.group}
                className="rounded border border-affix-suffix/40 bg-affix-suffix/10 px-2 py-0.5 text-xs text-affix-suffix"
              >
                {d.label}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
