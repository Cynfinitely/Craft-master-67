import Link from "next/link";
import type { EligibleMod } from "@/lib/data/types";
import { groupByModGroup, modLabel, statRange, weightPct } from "@/lib/data/format";
import { notableTags, tagStyle } from "@/lib/data/tags";
import { AffixMark, Badge } from "@/components/ui/Badge";

function TagChip({ tag }: { tag: string }) {
  return <span className={`badge ${tagStyle(tag)}`}>{tag}</span>;
}

export function ModColumn({
  title,
  accent,
  mods,
  totalWeight,
  guaranteedGroups,
  baseId,
  itemLevel,
  filterTag,
  craftFilters,
}: {
  title: string;
  accent: "prefix" | "suffix";
  mods: EligibleMod[];
  totalWeight: number;
  guaranteedGroups?: Set<string>;
  /** When provided, each group links into the planner preselected. */
  baseId?: string;
  itemLevel?: number;
  /** Active tag filter, used to explain an empty column. */
  filterTag?: string;
  /** Base-search filters carried into the planner so "Change base" keeps them. */
  craftFilters?: { q?: string; itemClass?: string };
}) {
  const groups = groupByModGroup(mods);
  const accentColor =
    accent === "prefix" ? "text-affix-prefix" : "text-affix-suffix";
  const headingId = `modcol-${accent}`;

  const craftHref = (group: string) => {
    const p = new URLSearchParams({ mode: "base" });
    if (craftFilters?.q) p.set("q", craftFilters.q);
    if (craftFilters?.itemClass) p.set("class", craftFilters.itemClass);
    p.set("base", baseId ?? "");
    p.set("ilvl", String(itemLevel ?? 82));
    p.set("groups", group);
    return `/craft?${p.toString()}`;
  };

  return (
    <section className="panel flex min-w-0 flex-col" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-2 border-b border-forge-border px-4 py-2.5">
        <h2
          id={headingId}
          className={`flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide ${accentColor}`}
        >
          <AffixMark kind={accent} />
          {title}
        </h2>
        <span className="num text-xs text-forge-muted">
          {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-forge-muted">
          {filterTag
            ? `No ${accent}es with the “${filterTag}” tag can roll on this base at this item level.`
            : `No ${accent}es can roll on this base at this item level.`}
        </p>
      ) : (
        <ul className="divide-y divide-forge-border/50">
          {groups.map((g) => {
            const tags = notableTags(g.mods[0].implicitTags);
            const guaranteed = guaranteedGroups?.has(g.group);
            return (
              <li key={g.group} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 break-words text-xs font-medium text-forge-muted">
                    {g.group}
                    {guaranteed ? (
                      <Badge
                        tone="info"
                        title="An essence can guarantee a mod from this group"
                      >
                        essence
                        <span className="sr-only">
                          {" "}
                          — an essence can guarantee a mod from this group
                        </span>
                      </Badge>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className="num rounded bg-forge-panel2 px-1.5 py-0.5 text-xs text-forge-goldbright"
                      title={`Combined spawn weight ${g.weight} of ${totalWeight}`}
                    >
                      {weightPct(g.weight, totalWeight)}
                      <span className="sr-only">
                        {" "}
                        chance (spawn weight {g.weight} of {totalWeight})
                      </span>
                    </span>
                    {baseId ? (
                      <Link href={craftHref(g.group)} className="btn btn-sm tap">
                        Craft
                        <span className="sr-only">
                          {" "}
                          {g.group}: open the crafting planner with this
                          modifier preselected
                        </span>
                        <span aria-hidden>→</span>
                      </Link>
                    ) : null}
                  </span>
                </div>
                {tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {tags.map((t) => (
                      <TagChip key={t} tag={t} />
                    ))}
                  </div>
                ) : null}
                <ul className="mt-1 space-y-0.5">
                  {g.mods.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 break-words text-forge-goldbright">
                        {modLabel(m)}
                      </span>
                      <span className="num shrink-0 text-2xs text-forge-muted">
                        iLvl {m.requiredLevel}
                        {m.stats.length === 1 ? (
                          <span className="ml-1">({statRange(m.stats[0])})</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
