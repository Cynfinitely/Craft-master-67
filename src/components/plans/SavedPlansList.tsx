"use client";

import Link from "next/link";
import { useState } from "react";
import type { SavedPlanSummary } from "@/lib/user/queries";
import { formatCost } from "@/lib/pricing/format";
import { Alert } from "@/components/ui/Alert";
import { AffixMark } from "@/components/ui/Badge";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrentMods, formatGoalEntry } from "@/lib/craft/goal";

export interface PlanDrift {
  savedCostExalted: number;
  nowCostExalted: number;
  divinePriceExalted: number;
}

function craftHref(p: SavedPlanSummary): string {
  const groups = [...p.plan.desiredPrefixes, ...p.plan.desiredSuffixes]
    .map((d) =>
      formatGoalEntry({
        group: d.group,
        minLevel: d.tierLevel ?? 0,
        desecrated: !!d.desecrated,
        optional: !!d.optional,
      }),
    )
    .join(",");
  const params = new URLSearchParams({
    mode: p.plan.current ? "finish" : "base",
    ilvl: String(p.plan.itemLevel),
  });
  if (p.baseId) params.set("base", p.baseId);
  if (groups) params.set("groups", groups);
  if (p.plan.current) params.set("current", formatCurrentMods(p.plan.current));
  if (p.plan.baseCostExalted) params.set("cost", String(p.plan.baseCostExalted));
  return `/craft?${params.toString()}`;
}

function DriftLine({ d }: { d: PlanDrift }) {
  const delta = d.nowCostExalted - d.savedCostExalted;
  const rounded = Math.round(delta);
  // Direction is stated in words/arrows as well as colour.
  const dir = rounded > 0 ? "up" : rounded < 0 ? "down" : "same";
  return (
    <p className="mt-0.5 text-xs">
      <span className="text-forge-muted">
        best technique now ~
        <span className="num">{formatCost(d.nowCostExalted, d.divinePriceExalted)}</span>
      </span>{" "}
      {dir === "same" ? (
        <span className="text-forge-muted">(unchanged since saved)</span>
      ) : (
        <span className={dir === "up" ? "text-danger-fg" : "text-success-fg"}>
          (<span aria-hidden="true">{dir === "up" ? "▲ " : "▼ "}</span>
          {dir === "up" ? "up " : "down "}
          <span className="num">
            {dir === "up" ? "+" : "−"}
            {formatCost(Math.abs(rounded), d.divinePriceExalted)}
          </span>{" "}
          since saved)
        </span>
      )}
    </p>
  );
}

export function SavedPlansList({
  initial,
  drift = {},
}: {
  initial: SavedPlanSummary[];
  drift?: Record<number, PlanDrift>;
}) {
  const [plans, setPlans] = useState(initial);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const remove = async (plan: SavedPlanSummary) => {
    setError(null);
    setStatus("");
    // Optimistic removal; restored at its original position if the request fails.
    const index = plans.findIndex((x) => x.id === plan.id);
    setPlans((list) => list.filter((x) => x.id !== plan.id));
    let ok = false;
    try {
      const res = await fetch(`/api/plans?id=${plan.id}`, { method: "DELETE" });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (ok) {
      setStatus(`Deleted \u201c${plan.name}\u201d`);
      return;
    }
    setPlans((list) => {
      if (list.some((x) => x.id === plan.id)) return list;
      const next = [...list];
      next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, plan);
      return next;
    });
    setError(`Couldn\u2019t delete \u201c${plan.name}\u201d. Please try again.`);
  };

  return (
    <div className="space-y-3">
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error ? (
        <Alert
          tone="danger"
          action={
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
              Dismiss
            </button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {plans.length === 0 ? (
        <EmptyState
          title="No saved plans yet"
          action={
            <Link href="/craft" className="btn btn-primary tap">
              Plan a craft
            </Link>
          }
        >
          Build a plan in the Crafting Planner and click &ldquo;Save plan&rdquo;.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => (
            <li key={p.id} className="panel p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="break-words font-semibold text-forge-goldbright">{p.name}</h3>
                  <p className="text-sm text-forge-muted">
                    {p.plan.baseName} · {p.plan.desiredPrefixes.length}p /{" "}
                    {p.plan.desiredSuffixes.length}s · iLvl {p.plan.itemLevel}
                  </p>
                  {drift[p.id] ? <DriftLine d={drift[p.id]} /> : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={craftHref(p)}
                    className="btn btn-primary tap"
                    aria-label={`Open plan \u201c${p.name}\u201d in the planner`}
                  >
                    Open
                  </Link>
                  <ConfirmButton
                    onConfirm={() => void remove(p)}
                    confirmLabel="Confirm delete?"
                    ariaLabel={`Delete plan \u201c${p.name}\u201d`}
                  >
                    Delete
                  </ConfirmButton>
                </div>
              </div>
              {p.plan.desiredPrefixes.length + p.plan.desiredSuffixes.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Target modifiers">
                  {p.plan.desiredPrefixes.map((d) => (
                    <li
                      key={d.group}
                      className="inline-flex items-center gap-1 rounded border border-affix-prefix/40 bg-affix-prefix/10 px-2 py-0.5 text-xs text-affix-prefix"
                    >
                      <AffixMark kind="prefix" />
                      {d.label}
                    </li>
                  ))}
                  {p.plan.desiredSuffixes.map((d) => (
                    <li
                      key={d.group}
                      className="inline-flex items-center gap-1 rounded border border-affix-suffix/40 bg-affix-suffix/10 px-2 py-0.5 text-xs text-affix-suffix"
                    >
                      <AffixMark kind="suffix" />
                      {d.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
