import type { EligibleMod } from "@/lib/data/types";
import { groupByModGroup, modLabel, statRange, weightPct } from "@/lib/data/format";
import { notableTags, tagStyle } from "@/lib/data/tags";

function TagChip({ tag }: { tag: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagStyle(tag)}`}
    >
      {tag}
    </span>
  );
}

export function ModColumn({
  title,
  accent,
  mods,
  totalWeight,
  guaranteedGroups,
}: {
  title: string;
  accent: "prefix" | "suffix";
  mods: EligibleMod[];
  totalWeight: number;
  guaranteedGroups?: Set<string>;
}) {
  const groups = groupByModGroup(mods);
  const accentColor =
    accent === "prefix" ? "text-affix-prefix" : "text-affix-suffix";

  return (
    <div className="panel flex flex-col">
      <div className="flex items-center justify-between border-b border-forge-border px-4 py-2.5">
        <h3 className={`text-sm font-semibold uppercase tracking-wide ${accentColor}`}>
          {title}
        </h3>
        <span className="text-xs text-forge-gold/50">
          {groups.length} groups
        </span>
      </div>
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-sm text-forge-gold/50">
          No {accent}es can roll on this base at this item level.
        </p>
      ) : (
        <ul className="divide-y divide-forge-border/50">
          {groups.map((g) => {
            const tags = notableTags(g.mods[0].implicitTags);
            const guaranteed = guaranteedGroups?.has(g.group);
            return (
              <li key={g.group} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-forge-gold/60">
                    {g.group}
                    {guaranteed ? (
                      <span
                        className="rounded bg-violet-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200"
                        title="An essence can guarantee a mod from this group"
                      >
                        essence
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="shrink-0 rounded bg-forge-bg/60 px-1.5 py-0.5 text-xs text-forge-goldbright"
                    title={`combined spawn weight ${g.weight} of ${totalWeight}`}
                  >
                    {weightPct(g.weight, totalWeight)}
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
                      <span className="text-forge-goldbright/90">
                        {modLabel(m)}
                      </span>
                      <span className="shrink-0 text-[11px] text-forge-gold/40">
                        iLvl {m.requiredLevel}
                        {m.stats.length === 1 ? (
                          <span className="ml-1 text-forge-gold/30">
                            ({statRange(m.stats[0])})
                          </span>
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
    </div>
  );
}
