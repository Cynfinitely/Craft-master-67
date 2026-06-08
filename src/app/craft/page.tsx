import Link from "next/link";
import {
  getModPool,
  listCraftableCategories,
  searchBases,
} from "@/lib/data";
import { groupByModGroup, modLabel, tierValue } from "@/lib/data/format";
import { notableTags } from "@/lib/data/tags";
import {
  getClassPool,
  recommendBases,
  solveFromBase,
} from "@/lib/solver";
import { CraftControls } from "@/components/craft/CraftControls";
import {
  GroupSelector,
  type SelectableGroup,
} from "@/components/craft/GroupSelector";
import { PasteImport } from "@/components/craft/PasteImport";
import { PlanView } from "@/components/craft/PlanView";
import { Recommendations } from "@/components/craft/Recommendations";

export const dynamic = "force-dynamic";

function clampIlvl(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "82", 10);
  if (Number.isNaN(n)) return 82;
  return Math.min(100, Math.max(1, n));
}

function parseGroups(raw: string | undefined): string[] {
  return (raw ?? "").split(",").filter(Boolean);
}

export default async function CraftPage({
  searchParams,
}: {
  searchParams: {
    mode?: string;
    q?: string;
    class?: string;
    ilvl?: string;
    base?: string;
    groups?: string;
  };
}) {
  const mode =
    searchParams.mode === "recommend"
      ? "recommend"
      : searchParams.mode === "paste"
        ? "paste"
        : "base";
  const itemLevel = clampIlvl(searchParams.ilvl);
  const selectedGroups = parseGroups(searchParams.groups);
  const categories = await listCraftableCategories();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">
          Crafting Planner
        </h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Pick a base and the modifiers you want for a step-by-step path with
          rough odds, or describe your goal and let the planner recommend a base.
        </p>
      </div>

      <div className="panel p-4">
        <CraftControls classes={categories} mode={mode} />
      </div>

      {mode === "paste" ? (
        <PasteImport />
      ) : mode === "base" ? (
        <BaseMode
          q={searchParams.q}
          itemClass={searchParams.class}
          baseId={searchParams.base}
          itemLevel={itemLevel}
          selectedGroups={selectedGroups}
        />
      ) : (
        <RecommendMode
          itemClass={searchParams.class}
          itemLevel={itemLevel}
          selectedGroups={selectedGroups}
        />
      )}
    </div>
  );
}

async function BaseMode({
  q,
  itemClass,
  baseId,
  itemLevel,
  selectedGroups,
}: {
  q?: string;
  itemClass?: string;
  baseId?: string;
  itemLevel: number;
  selectedGroups: string[];
}) {
  if (!baseId) {
    const results = await searchBases({ q, itemClass });
    const buildHref = (id: string) => {
      const p = new URLSearchParams();
      p.set("mode", "base");
      if (q) p.set("q", q);
      if (itemClass) p.set("class", itemClass);
      p.set("ilvl", String(itemLevel));
      p.set("base", id);
      return `/craft?${p.toString()}`;
    };
    return (
      <div className="panel max-h-[60vh] overflow-y-auto">
        {results.length === 0 ? (
          <p className="p-4 text-sm text-forge-gold/50">No bases found.</p>
        ) : (
          <ul className="divide-y divide-forge-border/50">
            {results.map((b) => (
              <li key={b.id}>
                <Link
                  href={buildHref(b.id)}
                  className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-forge-gold/80 transition-colors hover:bg-forge-panel2/60"
                >
                  <span>{b.name}</span>
                  <span className="text-[11px] text-forge-gold/40">
                    {b.itemClass}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const pool = await getModPool(baseId, itemLevel);
  if (!pool) {
    return (
      <div className="panel p-6 text-forge-gold/60">Base not found.</div>
    );
  }

  const toSel = (
    mods: typeof pool.prefixes,
    total: number,
    gen: "prefix" | "suffix",
  ): SelectableGroup[] =>
    groupByModGroup(mods).map((g) => ({
      group: g.group,
      label: modLabel(g.mods[0]),
      generationType: gen,
      odds: total ? g.weight / total : 0,
      tiers: g.mods.map((m) => ({
        level: m.requiredLevel,
        value: tierValue(m),
        weight: m.weight,
      })),
      tags: notableTags(g.mods[0].implicitTags),
    }));

  const prefixes = toSel(pool.prefixes, pool.prefixTotalWeight, "prefix");
  const suffixes = toSel(pool.suffixes, pool.suffixTotalWeight, "suffix");

  const plan = selectedGroups.length
    ? await solveFromBase(baseId, itemLevel, selectedGroups)
    : null;

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <span className="text-base font-semibold text-rarity-normal">
            {pool.base.name}
          </span>
          <span className="ml-2 text-sm text-forge-gold/50">
            {pool.base.itemClass} · iLvl {itemLevel}
          </span>
        </div>
        <Link
          href={`/craft?mode=base&ilvl=${itemLevel}${itemClass ? `&class=${encodeURIComponent(itemClass)}` : ""}`}
          className="btn"
        >
          Change base
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Select the modifiers you want
        </h2>
        <GroupSelector prefixes={prefixes} suffixes={suffixes} />
      </div>

      {plan ? (
        <PlanView plan={plan} />
      ) : (
        <div className="panel p-6 text-center text-forge-gold/50">
          Tick one or more modifiers above to generate a crafting plan.
        </div>
      )}
    </div>
  );
}

async function RecommendMode({
  itemClass,
  itemLevel,
  selectedGroups,
}: {
  itemClass?: string;
  itemLevel: number;
  selectedGroups: string[];
}) {
  if (!itemClass) {
    return (
      <div className="panel p-8 text-center text-forge-gold/50">
        Choose an item class above to see which modifiers are available and get
        base recommendations.
      </div>
    );
  }

  const classPool = await getClassPool(itemClass, itemLevel);
  const preTotal = classPool.prefixes.reduce((s, g) => s + g.weight, 0);
  const sufTotal = classPool.suffixes.reduce((s, g) => s + g.weight, 0);

  const prefixes: SelectableGroup[] = classPool.prefixes.map((g) => ({
    group: g.group,
    label: g.label,
    generationType: "prefix",
    odds: preTotal ? g.weight / preTotal : 0,
    tiers: g.tiers,
    tags: g.tags,
  }));
  const suffixes: SelectableGroup[] = classPool.suffixes.map((g) => ({
    group: g.group,
    label: g.label,
    generationType: "suffix",
    odds: sufTotal ? g.weight / sufTotal : 0,
    tiers: g.tiers,
    tags: g.tags,
  }));

  const recs = selectedGroups.length
    ? await recommendBases(itemClass, itemLevel, selectedGroups)
    : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Desired modifiers for {itemClass}
        </h2>
        <GroupSelector prefixes={prefixes} suffixes={suffixes} />
      </div>
      <Recommendations
        recs={recs}
        itemLevel={itemLevel}
        groups={selectedGroups}
      />
    </div>
  );
}
