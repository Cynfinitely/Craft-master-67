"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ActionWithInfo } from "@/components/ui/ActionWithInfo";
import { tagStyle } from "@/lib/data/tags";
import { formatGoalEntry, parseGoalList, type GoalEntry } from "@/lib/craft/goal";

function actionInfo(actionLabel: string): {
  label: string;
  summary: string;
  detail: string[];
} {
  if (actionLabel.includes("Simulate")) {
    return {
      label: "Simulate the batch",
      summary: "Simulates one pass of a technique on every base in the batch.",
      detail: [
        "Uses the staged modifiers, minimum tiers and base cost.",
        "Shows expected finished items, their spread, and the batch cost.",
        "Nothing runs until you press the button.",
      ],
    };
  }
  if (actionLabel.includes("Recommend")) {
    return {
      label: "Recommend bases",
      summary: "Ranks the bases of this class by roll odds, then by the brain's cheapest cost.",
      detail: [
        "Every base gets a quick odds score; the best 10 get a full (quick) plan.",
        "Pick a base to open its full plan.",
        "Nothing runs until you press the button.",
      ],
    };
  }
  return {
    label: actionLabel,
    summary: "The crafting brain simulates every technique and option, then ranks them by expected cost.",
    detail: [
      "Uses the staged modifiers, minimum tiers, optional flags and base cost.",
      "Only currency prices are fetched (cached for an hour).",
      "Takes about a second; nothing recomputes until you press the button.",
    ],
  };
}

export interface SelectableTier {
  level: number;
  value: string;
  weight: number;
}

export interface SelectableGroup {
  group: string;
  label: string;
  generationType: "prefix" | "suffix";
  /** Combined odds of rolling any tier of this group from a fresh pool. */
  odds: number;
  tiers: SelectableTier[];
  tags: string[];
}

type Staged = Map<string, GoalEntry>;

function toMap(entries: GoalEntry[]): Staged {
  return new Map(entries.map((e) => [e.group, e]));
}

function serialize(m: Staged): string {
  return [...m.values()].map(formatGoalEntry).join(",");
}

/**
 * Modifier picker with staged selection: clicks only update local state so
 * the user can compose a multi-mod goal freely; nothing recomputes until the
 * primary action button is pressed.
 */
export function GroupSelector({
  prefixes,
  suffixes,
  desecrated,
  actionLabel = "Build plan",
  showBaseCost = true,
}: {
  prefixes: SelectableGroup[];
  suffixes: SelectableGroup[];
  /** Desecrated-only modifiers (Well of Souls); shown as a third column when given. */
  desecrated?: SelectableGroup[];
  /** Label of the apply button (mode-specific). */
  actionLabel?: string;
  showBaseCost?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const appliedRaw = params.get("groups") ?? "";
  const appliedCost = params.get("cost") ?? "";
  const [staged, setStaged] = useState<Staged>(() => toMap(parseGoalList(appliedRaw)));
  const [cost, setCost] = useState(appliedCost);
  const [filter, setFilter] = useState("");
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    setStaged(toMap(parseGoalList(appliedRaw)));
    setCost(appliedCost);
    setBuilding(false);
  }, [appliedRaw, appliedCost]);

  const stagedStr = serialize(staged);
  const normalizedCost = cost.trim() && Number(cost) > 0 ? String(Number(cost)) : "";
  const dirty = stagedStr !== serialize(toMap(parseGoalList(appliedRaw))) || normalizedCost !== appliedCost;

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of [...prefixes, ...suffixes, ...(desecrated ?? [])]) m.set(g.group, g.label);
    return m;
  }, [prefixes, suffixes, desecrated]);

  const apply = () => {
    const p = new URLSearchParams(params.toString());
    if (stagedStr) p.set("groups", stagedStr);
    else p.delete("groups");
    if (normalizedCost) p.set("cost", normalizedCost);
    else p.delete("cost");
    setBuilding(true);
    router.push(`${pathname}?${p.toString()}`);
  };

  const update = (group: string, fn: (e: GoalEntry | undefined) => GoalEntry | null) => {
    setStaged((prev) => {
      const next = new Map(prev);
      const v = fn(prev.get(group));
      if (v) next.set(group, v);
      else next.delete(group);
      return next;
    });
  };

  const toggle = (group: string, isDesecrated: boolean) =>
    update(group, (e) => (e ? null : { group, minLevel: 0, desecrated: isDesecrated, optional: false }));

  const matchesFilter = (g: SelectableGroup) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return g.label.toLowerCase().includes(needle) || g.tags.some((t) => t.toLowerCase().includes(needle));
  };

  const renderColumn = (
    title: string,
    accent: "prefix" | "suffix" | "desecrated",
    items: SelectableGroup[],
  ) => {
    const visible = items.filter(matchesFilter);
    const pickedCount = items.filter((g) => staged.has(g.group)).length;
    const titleColor =
      accent === "prefix" ? "text-affix-prefix" : accent === "suffix" ? "text-affix-suffix" : "text-forge-rust";
    return (
      <div className="panel flex flex-col">
        <div className="flex items-center justify-between border-b border-forge-border px-4 py-2.5">
          <h3 className={`text-sm font-semibold uppercase tracking-wide ${titleColor}`}>{title}</h3>
          <span className="text-[11px] text-forge-gold/80">
            {pickedCount > 0 ? `${pickedCount} selected · ` : ""}
            {accent === "desecrated" ? "max 1" : "max 3"}
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-4 text-sm text-forge-gold/80">
            {items.length === 0 ? "None available." : "No match for the filter."}
          </p>
        ) : (
          <ul className="max-h-[55vh] divide-y divide-forge-border/40 overflow-y-auto">
            {visible.map((g) => {
              const entry = staged.get(g.group);
              const on = !!entry;
              return (
                <li key={g.group} className={`px-4 py-2 transition-colors ${on ? "bg-forge-panel2/50" : ""}`}>
                  <button
                    type="button"
                    onClick={() => toggle(g.group, accent === "desecrated")}
                    className={`flex min-h-9 w-full items-center justify-between gap-3 text-left text-sm transition-colors ${
                      on ? "text-forge-goldbright" : "text-forge-gold/80"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] max-md:h-5 max-md:w-5 ${
                          on ? "border-forge-gold bg-forge-gold text-forge-bg" : "border-forge-border"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                      {g.label}
                    </span>
                    <span className="shrink-0 text-[11px] text-forge-gold/80">{(g.odds * 100).toFixed(1)}%</span>
                  </button>

                  {g.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1 pl-6">
                      {g.tags.map((t) => (
                        <span key={t} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagStyle(t)}`}>
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {entry ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                      <label
                        className="text-[11px] text-forge-gold/80"
                        title="Minimum acceptable tier: this tier or better counts as a hit. 'Any tier' is the cheapest."
                      >
                        Min tier
                      </label>
                      <select
                        className="input h-7 min-w-0 max-w-full py-0 text-xs max-md:h-9"
                        value={entry.minLevel || ""}
                        onChange={(e) =>
                          update(g.group, (cur) =>
                            cur ? { ...cur, minLevel: e.target.value ? Number.parseInt(e.target.value, 10) : 0 } : null,
                          )
                        }
                      >
                        <option value="">Any tier (cheapest)</option>
                        {g.tiers.map((t) => (
                          <option key={t.level} value={t.level}>
                            {t.value} or better (lvl {t.level}+)
                          </option>
                        ))}
                      </select>
                      <label
                        className="inline-flex items-center gap-1 text-[11px] text-forge-gold/80"
                        title="Nice to have: the brain reports how often you get it, but a craft without it still counts as done."
                      >
                        <input
                          type="checkbox"
                          checked={entry.optional}
                          onChange={(e) =>
                            update(g.group, (cur) => (cur ? { ...cur, optional: e.target.checked } : null))
                          }
                        />
                        optional
                      </label>
                    </div>
                  ) : (
                    <p className="mt-0.5 pl-6 text-[11px] text-forge-gold/80">
                      {g.tiers.length} tier{g.tiers.length === 1 ? "" : "s"} · best: {g.tiers[0]?.value}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="panel space-y-2 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input sm:max-w-xs"
            placeholder="Filter modifiers (e.g. life, resistance)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {showBaseCost ? (
            <label
              className="flex items-center gap-1.5 text-xs text-forge-gold/80"
              title="What one base (or one copy of your item) costs you, in Exalted Orbs. Each restart consumes one."
            >
              Base cost
              <input
                className="input h-8 w-20 py-0 text-xs"
                inputMode="decimal"
                placeholder="0"
                value={cost}
                onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              ex
            </label>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            {staged.size > 0 ? (
              <button
                type="button"
                className="text-xs text-forge-gold/55 underline hover:text-forge-goldbright"
                onClick={() => setStaged(new Map())}
              >
                Clear all
              </button>
            ) : null}
            {dirty && appliedRaw ? (
              <button
                type="button"
                className="text-xs text-forge-gold/55 underline hover:text-forge-goldbright"
                onClick={() => {
                  setStaged(toMap(parseGoalList(appliedRaw)));
                  setCost(appliedCost);
                }}
              >
                Revert
              </button>
            ) : null}
            <ActionWithInfo {...actionInfo(actionLabel)}>
              <button
                type="button"
                onClick={apply}
                disabled={!dirty || building}
                className={`rounded px-4 py-1.5 text-sm font-semibold transition-colors ${
                  dirty && !building
                    ? "bg-forge-gold text-forge-bg hover:bg-forge-goldbright"
                    : "cursor-default bg-forge-panel2 text-forge-gold/80"
                }`}
              >
                {building ? "Working…" : staged.size === 0 && appliedRaw ? "Clear plan" : actionLabel}
              </button>
            </ActionWithInfo>
          </div>
        </div>

        {staged.size > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {[...staged.values()].map((e) => (
              <span
                key={e.group}
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${
                  e.optional
                    ? "border-dashed border-forge-gold/30 text-forge-gold/80"
                    : "border-forge-gold/30 bg-forge-panel2/70 text-forge-goldbright/90"
                }`}
              >
                {labelOf.get(e.group) ?? e.group}
                {e.minLevel > 0 ? <span className="text-forge-gold/80">lvl {e.minLevel}+</span> : null}
                {e.desecrated ? <span className="text-forge-rust">desecrated</span> : null}
                {e.optional ? <span className="text-forge-gold/60">optional</span> : null}
                <button
                  type="button"
                  className="-my-0.5 -mr-1 ml-0.5 inline-flex min-h-6 min-w-6 items-center justify-center rounded text-forge-gold/80 hover:text-forge-rust max-md:min-h-8 max-md:min-w-8 max-md:text-base"
                  onClick={() => update(e.group, () => null)}
                  title="Remove"
                  aria-label={`Remove ${labelOf.get(e.group) ?? e.group}`}
                >
                  ×
                </button>
              </span>
            ))}
            {dirty ? (
              <span className="text-[11px] text-forge-rust/90">not applied yet — press “{actionLabel}”</span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-forge-gold/80">
            Tick modifiers below, set minimum tiers or mark some optional, then press “{actionLabel}”. Nothing
            recomputes until you do.
          </p>
        )}
      </div>

      <div className={`grid gap-4 ${desecrated?.length ? "lg:grid-cols-3 md:grid-cols-2" : "md:grid-cols-2"}`}>
        {renderColumn("Prefixes", "prefix", prefixes)}
        {renderColumn("Suffixes", "suffix", suffixes)}
        {desecrated?.length ? renderColumn("Desecrated (Well of Souls)", "desecrated", desecrated) : null}
      </div>
    </div>
  );
}
