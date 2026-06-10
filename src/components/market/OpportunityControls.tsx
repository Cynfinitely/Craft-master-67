"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { LiveProgress } from "@/components/LiveProgress";
import { oppsProgressId } from "@/lib/progressId";

export function OpportunityControls({
  classes,
  bases,
  league,
}: {
  classes: { category: string; classes: string[] }[];
  /** Bases of the selected class (empty until a class is chosen). */
  bases: { id: string; name: string }[];
  league: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);

  const itemClass = params.get("class") ?? "";
  const baseId = params.get("base") ?? "";
  const ilvl = params.get("ilvl") ?? "82";

  const push = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    // The server page registers its build under this deterministic id; this
    // (still-mounted) component polls it while the navigation is pending.
    const nextClass = next.get("class");
    const nextView = next.get("view") ?? "crafts";
    setJobId(
      nextClass && nextView === "crafts"
        ? oppsProgressId(
            league,
            nextClass,
            next.get("ilvl") ?? "82",
            next.get("base"),
          )
        : null,
    );
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
        className="input"
        value={itemClass}
        onChange={(e) => push({ class: e.target.value || null, base: null })}
      >
        <option value="">Choose an item class…</option>
        {classes.map((cat) => (
          <optgroup key={cat.category} label={cat.category}>
            {cat.classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {itemClass ? (
        <select
          className="input"
          value={baseId}
          onChange={(e) => push({ base: e.target.value || null })}
          title="Pin the search to one base, or let the planner pick the best base per combo"
        >
          <option value="">Any base (auto-pick best)</option>
          {bases.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : null}
      <div className="flex shrink-0 items-center gap-1.5">
        <label className="text-xs text-forge-gold/60">iLvl</label>
        <input
          type="number"
          min={1}
          max={100}
          className="input w-16 text-center"
          defaultValue={ilvl}
          key={ilvl}
          onBlur={(e) => push({ ilvl: e.target.value || "82" })}
          onKeyDown={(e) => {
            if (e.key === "Enter")
              push({ ilvl: (e.target as HTMLInputElement).value || "82" });
          }}
        />
      </div>
        <span className="text-xs text-forge-gold/50">league: {league}</span>
      </div>
      <LiveProgress jobId={jobId} active={isPending} showLog={3} />
    </div>
  );
}
