"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

export function GroupSelector({
  prefixes,
  suffixes,
}: {
  prefixes: SelectableGroup[];
  suffixes: SelectableGroup[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Parse the groups param into group -> targeted tier level (null = any tier).
  const selMap = new Map<string, number | null>();
  for (const e of (params.get("groups") ?? "").split(",").filter(Boolean)) {
    const [g, l] = e.split("@");
    selMap.set(g, l ? Number.parseInt(l, 10) : null);
  }

  const commit = (next: Map<string, number | null>) => {
    const p = new URLSearchParams(params.toString());
    const entries = [...next].map(([g, l]) => (l != null ? `${g}@${l}` : g));
    if (entries.length) p.set("groups", entries.join(","));
    else p.delete("groups");
    router.push(`${pathname}?${p.toString()}`);
  };

  const toggle = (group: string) => {
    const next = new Map(selMap);
    if (next.has(group)) next.delete(group);
    else next.set(group, null);
    commit(next);
  };

  const setTier = (group: string, level: number | null) => {
    const next = new Map(selMap);
    next.set(group, level);
    commit(next);
  };

  const renderColumn = (
    title: string,
    accent: "prefix" | "suffix",
    items: SelectableGroup[],
  ) => (
    <div className="panel flex flex-col">
      <div className="border-b border-forge-border px-4 py-2.5">
        <h3
          className={`text-sm font-semibold uppercase tracking-wide ${
            accent === "prefix" ? "text-affix-prefix" : "text-affix-suffix"
          }`}
        >
          {title}
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-forge-gold/50">None available.</p>
      ) : (
        <ul className="max-h-[55vh] divide-y divide-forge-border/40 overflow-y-auto">
          {items.map((g) => {
            const on = selMap.has(g.group);
            const tier = selMap.get(g.group) ?? null;
            return (
              <li key={g.group} className="px-4 py-2">
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
                    <label className="text-[11px] text-forge-gold/50">
                      Target tier
                    </label>
                    <select
                      className="input h-7 py-0 text-xs"
                      value={tier ?? ""}
                      onChange={(e) =>
                        setTier(
                          g.group,
                          e.target.value ? Number.parseInt(e.target.value, 10) : null,
                        )
                      }
                    >
                      <option value="">Any tier</option>
                      {g.tiers.map((t) => (
                        <option key={t.level} value={t.level}>
                          {t.value} (lvl {t.level})
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

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {renderColumn("Prefixes", "prefix", prefixes)}
      {renderColumn("Suffixes", "suffix", suffixes)}
    </div>
  );
}
