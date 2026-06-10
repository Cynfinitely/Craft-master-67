"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { tagStyle } from "@/lib/data/tags";

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

function parseGroupsParam(raw: string): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const e of raw.split(",").filter(Boolean)) {
    const [g, l] = e.split("@");
    m.set(g, l ? Number.parseInt(l, 10) : null);
  }
  return m;
}

function serializeGroups(m: Map<string, number | null>): string {
  return [...m]
    .map(([g, l]) => (l != null ? `${g}@${l}` : g))
    .join(",");
}

/**
 * Modifier picker with STAGED selection: clicks only update local state so
 * the user can compose a multi-mod goal freely; nothing recomputes until
 * they hit the primary action button (plan building hits live prices and
 * trade lookups, so each accidental run is expensive).
 */
export function GroupSelector({
  prefixes,
  suffixes,
  actionLabel = "Build plan",
}: {
  prefixes: SelectableGroup[];
  suffixes: SelectableGroup[];
  /** Label of the apply button (mode-specific). */
  actionLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const appliedRaw = params.get("groups") ?? "";
  const [staged, setStaged] = useState<Map<string, number | null>>(() =>
    parseGroupsParam(appliedRaw),
  );
  const [filter, setFilter] = useState("");
  const [building, setBuilding] = useState(false);

  // Re-sync the staged set when the URL changes from outside (plan applied,
  // base changed, mode switched, link followed).
  useEffect(() => {
    setStaged(parseGroupsParam(appliedRaw));
    setBuilding(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRaw]);

  const stagedStr = serializeGroups(staged);
  const dirty = stagedStr !== appliedRaw;

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of [...prefixes, ...suffixes]) m.set(g.group, g.label);
    return m;
  }, [prefixes, suffixes]);

  const apply = () => {
    const p = new URLSearchParams(params.toString());
    if (stagedStr) p.set("groups", stagedStr);
    else p.delete("groups");
    setBuilding(true);
    router.push(`${pathname}?${p.toString()}`);
  };

  const toggle = (group: string) => {
    setStaged((prev) => {
      const next = new Map(prev);
      if (next.has(group)) next.delete(group);
      else next.set(group, null);
      return next;
    });
  };

  const setTier = (group: string, level: number | null) => {
    setStaged((prev) => {
      const next = new Map(prev);
      next.set(group, level);
      return next;
    });
  };

  const matchesFilter = (g: SelectableGroup) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return (
      g.label.toLowerCase().includes(needle) ||
      g.tags.some((t) => t.toLowerCase().includes(needle))
    );
  };

  const renderColumn = (
    title: string,
    accent: "prefix" | "suffix",
    items: SelectableGroup[],
  ) => {
    const visible = items.filter(matchesFilter);
    const pickedCount = items.filter((g) => staged.has(g.group)).length;
    return (
      <div className="panel flex flex-col">
        <div className="flex items-center justify-between border-b border-forge-border px-4 py-2.5">
          <h3
            className={`text-sm font-semibold uppercase tracking-wide ${
              accent === "prefix" ? "text-affix-prefix" : "text-affix-suffix"
            }`}
          >
            {title}
          </h3>
          <span className="text-[11px] text-forge-gold/45">
            {pickedCount > 0 ? `${pickedCount} selected · ` : ""}
            max 3
          </span>
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-4 text-sm text-forge-gold/50">
            {items.length === 0 ? "None available." : "No match for the filter."}
          </p>
        ) : (
          <ul className="max-h-[55vh] divide-y divide-forge-border/40 overflow-y-auto">
            {visible.map((g) => {
              const on = staged.has(g.group);
              const tier = staged.get(g.group) ?? null;
              return (
                <li
                  key={g.group}
                  className={`px-4 py-2 transition-colors ${on ? "bg-forge-panel2/50" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(g.group)}
                    className={`flex w-full items-center justify-between gap-3 text-left text-sm transition-colors ${
                      on ? "text-forge-goldbright" : "text-forge-gold/80"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                          on
                            ? "border-forge-gold bg-forge-gold text-forge-bg"
                            : "border-forge-border"
                        }`}
                      >
                        {on ? "✓" : ""}
                      </span>
                      {g.label}
                    </span>
                    <span className="shrink-0 text-[11px] text-forge-gold/40">
                      {(g.odds * 100).toFixed(1)}%
                    </span>
                  </button>

                  {g.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1 pl-6">
                      {g.tags.map((t) => (
                        <span
                          key={t}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagStyle(t)}`}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {on ? (
                    <div className="mt-2 flex items-center gap-2 pl-6">
                      <label
                        className="text-[11px] text-forge-gold/50"
                        title="Minimum acceptable tier — the plan counts this tier OR BETTER as a hit. 'Any tier' is the cheapest and usually still sells fine."
                      >
                        Min tier
                      </label>
                      <select
                        className="input h-7 py-0 text-xs"
                        value={tier ?? ""}
                        onChange={(e) =>
                          setTier(
                            g.group,
                            e.target.value
                              ? Number.parseInt(e.target.value, 10)
                              : null,
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
                    </div>
                  ) : (
                    <p className="mt-0.5 pl-6 text-[11px] text-forge-gold/35">
                      {g.tiers.length} tier{g.tiers.length === 1 ? "" : "s"} ·
                      best: {g.tiers[0]?.value}
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
      {/* Selection toolbar: filter + staged chips + apply */}
      <div className="panel space-y-2 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input sm:max-w-xs"
            placeholder="Filter modifiers (e.g. life, resistance)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="flex flex-1 items-center justify-end gap-2">
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
                onClick={() => setStaged(parseGroupsParam(appliedRaw))}
              >
                Revert
              </button>
            ) : null}
            <button
              type="button"
              onClick={apply}
              disabled={!dirty || building}
              className={`rounded px-4 py-1.5 text-sm font-semibold transition-colors ${
                dirty && !building
                  ? "bg-forge-gold text-forge-bg hover:bg-forge-goldbright"
                  : "cursor-default bg-forge-panel2 text-forge-gold/40"
              }`}
            >
              {building
                ? "Working…"
                : staged.size === 0 && appliedRaw
                  ? "Clear plan"
                  : actionLabel}
            </button>
          </div>
        </div>

        {staged.size > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {[...staged].map(([g, l]) => (
              <span
                key={g}
                className="inline-flex items-center gap-1 rounded border border-forge-gold/30 bg-forge-panel2/70 px-2 py-0.5 text-xs text-forge-goldbright/90"
              >
                {labelOf.get(g) ?? g}
                {l != null ? (
                  <span className="text-forge-gold/50">lvl {l}+</span>
                ) : null}
                <button
                  type="button"
                  className="ml-0.5 text-forge-gold/50 hover:text-forge-rust"
                  onClick={() => toggle(g)}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
            {dirty ? (
              <span className="text-[11px] text-forge-rust/90">
                not applied yet — press “{actionLabel}”
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-forge-gold/40">
            Tick modifiers below, set optional minimum tiers, then press “
            {actionLabel}”. Nothing recomputes until you do.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {renderColumn("Prefixes", "prefix", prefixes)}
        {renderColumn("Suffixes", "suffix", suffixes)}
      </div>
    </div>
  );
}
