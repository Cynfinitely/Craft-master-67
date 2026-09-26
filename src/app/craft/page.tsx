import { Suspense } from "react";
import { hasBaseSearchFilter, listCraftableCategories, searchBases } from "@/lib/data";
import { BasePickerPanel } from "@/components/bases/BasePickerPanel";
import { SelectedBaseCard } from "@/components/bases/SelectedBaseCard";
import {
  getBaseGroups,
  getClassPool,
  loadPriceBook,
  massCraft,
  parseCurrentMods,
  parseGoalList,
  recommendBases,
  solve,
  techniquesFor,
  type CurrentMod,
  type GroupChoice,
} from "@/lib/craft";
import { CraftControls } from "@/components/craft/CraftControls";
import { FilterSheet } from "@/components/ui/FilterSheet";
import { GroupSelector, type SelectableGroup } from "@/components/craft/GroupSelector";
import { MassControls } from "@/components/craft/MassControls";
import { MassResults } from "@/components/craft/MassResults";
import { PasteImport } from "@/components/craft/PasteImport";
import { PlanView } from "@/components/craft/PlanView";
import { Recommendations } from "@/components/craft/Recommendations";

export const dynamic = "force-dynamic";

type Mode = "base" | "recommend" | "paste" | "mass" | "finish";

function clampIlvl(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "82", 10);
  if (Number.isNaN(n)) return 82;
  return Math.min(100, Math.max(1, n));
}

function parseCost(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toSelectable(choices: GroupChoice[]): SelectableGroup[] {
  return choices.map((g) => ({
    group: g.group,
    label: g.label,
    generationType: g.generationType,
    odds: g.weight,
    tiers: g.tiers,
    tags: g.tags,
  }));
}

function filterParams(mode: Mode, q?: string, itemClass?: string, itemLevel?: number): URLSearchParams {
  const p = new URLSearchParams();
  p.set("mode", mode);
  if (q) p.set("q", q);
  if (itemClass) p.set("class", itemClass);
  if (itemLevel != null) p.set("ilvl", String(itemLevel));
  return p;
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
    cost?: string;
    method?: string;
    n?: string;
    current?: string;
  };
}) {
  const modes: Mode[] = ["base", "recommend", "paste", "mass", "finish"];
  const mode: Mode = modes.includes(searchParams.mode as Mode) ? (searchParams.mode as Mode) : "base";
  const itemLevel = clampIlvl(searchParams.ilvl);
  const goalParam = searchParams.groups ?? "";
  const baseCost = parseCost(searchParams.cost);
  const categories = await listCraftableCategories();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">Crafting Planner</h1>
        <p className="mt-1 text-sm text-forge-gold/80">
          Pick a base and the modifiers you want. The crafting brain simulates every technique it knows, tunes each
          one&apos;s options, and ranks them by expected cost per finished item.
        </p>
      </div>

      <FilterSheet
        title="Planner settings"
        summary={[
          { base: "Base", mass: "Mass craft", recommend: "Recommend", paste: "Paste", finish: "Finish item" }[mode],
          searchParams.class,
          `ilvl ${itemLevel}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        collapsed={
          mode === "base" || mode === "mass" || mode === "finish"
            ? !!searchParams.base
            : mode === "recommend" && !!searchParams.class
        }
      >
        <div className="panel p-4">
          <CraftControls classes={categories} mode={mode} />
        </div>
      </FilterSheet>

      {mode === "paste" ? (
        <PasteImport />
      ) : mode === "base" ? (
        <Suspense fallback={<SectionSkeleton label="The brain is simulating techniques…" />}>
          <BaseMode
            q={searchParams.q}
            itemClass={searchParams.class}
            baseId={searchParams.base}
            itemLevel={itemLevel}
            goalParam={goalParam}
            baseCost={baseCost}
          />
        </Suspense>
      ) : mode === "finish" ? (
        <Suspense fallback={<SectionSkeleton label="Simulating how to finish your item…" />}>
          <FinishMode
            baseId={searchParams.base}
            itemLevel={itemLevel}
            goalParam={goalParam}
            baseCost={baseCost}
            current={parseCurrentMods(searchParams.current)}
          />
        </Suspense>
      ) : mode === "mass" ? (
        <Suspense fallback={<SectionSkeleton label="Simulating the batch…" />}>
          <MassMode
            q={searchParams.q}
            itemClass={searchParams.class}
            baseId={searchParams.base}
            itemLevel={itemLevel}
            goalParam={goalParam}
            baseCost={baseCost}
            methodId={searchParams.method}
            basesCount={searchParams.n}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<SectionSkeleton label="Ranking bases for your goal…" />}>
          <RecommendMode
            itemClass={searchParams.class}
            itemLevel={itemLevel}
            goalParam={goalParam}
            baseCost={baseCost}
          />
        </Suspense>
      )}
    </div>
  );
}

function SectionSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4">
      <div className="panel animate-pulse px-4 py-3">
        <div className="h-5 w-1/3 rounded bg-forge-panel2" />
      </div>
      <div className="panel animate-pulse space-y-3 p-4">
        <div className="h-4 w-2/3 rounded bg-forge-panel2" />
        <div className="h-4 w-1/2 rounded bg-forge-panel2" />
        <div className="h-4 w-3/5 rounded bg-forge-panel2" />
      </div>
      <p className="text-center text-xs text-forge-gold/80">{label}</p>
    </div>
  );
}

async function CraftBasePicker({
  q,
  itemClass,
  itemLevel,
  mode,
}: {
  q?: string;
  itemClass?: string;
  itemLevel: number;
  mode: "base" | "mass";
}) {
  const filterActive = hasBaseSearchFilter({ q, itemClass });
  const results = filterActive ? await searchBases({ q, itemClass }) : [];

  const buildBaseHref = (id: string) => {
    const p = filterParams(mode, q, itemClass, itemLevel);
    p.set("base", id);
    return `/craft?${p.toString()}`;
  };

  return (
    <BasePickerPanel
      filterActive={filterActive}
      results={results}
      itemClass={itemClass}
      query={q}
      itemLevel={itemLevel}
      buildBaseHref={buildBaseHref}
      buildClearBaseHref={() => `/craft?${filterParams(mode, q, itemClass, itemLevel).toString()}`}
      maxHeight="60vh"
      steps={[{ label: "1. Filter" }, { label: "2. Select base", active: true }]}
      emptyHint="Choose an item class or search for a base name (min. 2 characters) above, then pick a base from the list."
    />
  );
}

async function BaseMode({
  q,
  itemClass,
  baseId,
  itemLevel,
  goalParam,
  baseCost,
}: {
  q?: string;
  itemClass?: string;
  baseId?: string;
  itemLevel: number;
  goalParam: string;
  baseCost: number;
}) {
  if (!baseId) return <CraftBasePicker q={q} itemClass={itemClass} itemLevel={itemLevel} mode="base" />;

  const groups = await getBaseGroups(baseId, itemLevel);
  if (!groups) return <div className="panel p-6 text-forge-gold/80">Base not found.</div>;

  const goal = parseGoalList(goalParam);
  const plan = goal.length ? await solve({ baseId, itemLevel, goal, baseCost }) : null;

  return (
    <div className="space-y-4">
      <SelectedBaseCard
        name={groups.base.name}
        itemClass={groups.base.itemClass}
        itemLevel={itemLevel}
        changeHref={`/craft?${filterParams("base", q, itemClass, itemLevel).toString()}`}
      />
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Select the modifiers you want
        </h2>
        <GroupSelector
          prefixes={toSelectable(groups.prefixes)}
          suffixes={toSelectable(groups.suffixes)}
          desecrated={toSelectable(groups.desecrated)}
          actionLabel="Build crafting plan"
        />
      </div>
      {plan ? (
        <PlanView plan={plan} />
      ) : (
        <div className="panel p-6 text-center text-forge-gold/80">
          Tick one or more modifiers above, then press “Build crafting plan”.
        </div>
      )}
    </div>
  );
}

function CurrentItemCard({ current, labels }: { current: CurrentMod[]; labels: Map<string, string> }) {
  return (
    <div className="panel p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">Your item right now</h2>
      {current.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {current.map((m) => (
            <li
              key={m.group}
              className={`rounded border px-2 py-0.5 text-xs ${
                m.side === "prefix"
                  ? "border-affix-prefix/40 text-affix-prefix"
                  : "border-affix-suffix/40 text-affix-suffix"
              }`}
            >
              {labels.get(m.group) ?? m.group}
              {m.level ? <span className="ml-1 opacity-60">lvl {m.level}</span> : null}
              {m.fractured ? <span className="ml-1 opacity-60">(fractured)</span> : null}
              {m.desecrated ? <span className="ml-1 opacity-60">(desecrated)</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-forge-gold/80">No modifiers.</p>
      )}
      <p className="mt-2 text-xs text-forge-gold/70">
        Keep the mods you want ticked below and add the ones you&apos;re missing. Set “Base cost” to what another copy
        of this item would cost you — a bricked attempt means starting over from one.
      </p>
    </div>
  );
}

async function FinishMode({
  baseId,
  itemLevel,
  goalParam,
  baseCost,
  current,
}: {
  baseId?: string;
  itemLevel: number;
  goalParam: string;
  baseCost: number;
  current: CurrentMod[];
}) {
  if (!baseId) {
    return (
      <div className="panel p-6 text-center text-forge-gold/80">
        Paste an item on the Paste tab, then choose “Finish this item”.
      </div>
    );
  }
  const groups = await getBaseGroups(baseId, itemLevel);
  if (!groups) return <div className="panel p-6 text-forge-gold/80">Base not found.</div>;
  const labels = new Map(
    [...groups.prefixes, ...groups.suffixes, ...groups.desecrated].map((g) => [g.group, g.label]),
  );

  const goal = parseGoalList(goalParam);
  const plan = goal.length ? await solve({ baseId, itemLevel, goal, baseCost, current }) : null;

  return (
    <div className="space-y-4">
      <SelectedBaseCard
        name={groups.base.name}
        itemClass={groups.base.itemClass}
        itemLevel={itemLevel}
        changeHref="/craft?mode=paste"
      />
      <CurrentItemCard current={current} labels={labels} />
      <GroupSelector
        prefixes={toSelectable(groups.prefixes)}
        suffixes={toSelectable(groups.suffixes)}
        desecrated={toSelectable(groups.desecrated)}
        actionLabel="Plan the finish"
      />
      {plan ? (
        <PlanView plan={plan} />
      ) : (
        <div className="panel p-6 text-center text-forge-gold/80">
          Tick the modifiers the finished item should have, then press “Plan the finish”.
        </div>
      )}
    </div>
  );
}

async function MassMode({
  q,
  itemClass,
  baseId,
  itemLevel,
  goalParam,
  baseCost,
  methodId,
  basesCount,
}: {
  q?: string;
  itemClass?: string;
  baseId?: string;
  itemLevel: number;
  goalParam: string;
  baseCost: number;
  methodId?: string;
  basesCount?: string;
}) {
  if (!baseId) return <CraftBasePicker q={q} itemClass={itemClass} itemLevel={itemLevel} mode="mass" />;

  const groups = await getBaseGroups(baseId, itemLevel);
  if (!groups) return <div className="panel p-6 text-forge-gold/80">Base not found.</div>;

  const n = Math.min(10000, Math.max(1, Number.parseInt(basesCount ?? "50", 10) || 50));
  const goal = parseGoalList(goalParam);
  const plan = goal.length
    ? await massCraft({ baseId, itemLevel, goal, techniqueId: methodId ?? "auto", basesCount: n, baseCost })
    : null;

  return (
    <div className="space-y-4">
      <SelectedBaseCard
        name={groups.base.name}
        itemClass={groups.base.itemClass}
        itemLevel={itemLevel}
        changeHref={`/craft?${filterParams("mass", q, itemClass, itemLevel).toString()}`}
      />
      <div className="panel p-4">
        <MassControls techniques={techniquesFor("craft").map((t) => ({ id: t.id, name: t.name }))} />
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Select the modifiers you&apos;re hunting
        </h2>
        <GroupSelector
          prefixes={toSelectable(groups.prefixes)}
          suffixes={toSelectable(groups.suffixes)}
          desecrated={toSelectable(groups.desecrated)}
          actionLabel="Simulate the batch"
        />
      </div>
      {plan ? (
        <MassResults plan={plan} />
      ) : goal.length ? (
        <div className="panel p-6 text-center text-forge-gold/80">
          No technique reaches this goal on this base.
        </div>
      ) : (
        <div className="panel p-6 text-center text-forge-gold/80">
          Tick one or more modifiers above, then press “Simulate the batch”.
        </div>
      )}
    </div>
  );
}

async function RecommendMode({
  itemClass,
  itemLevel,
  goalParam,
  baseCost,
}: {
  itemClass?: string;
  itemLevel: number;
  goalParam: string;
  baseCost: number;
}) {
  if (!itemClass) {
    return (
      <div className="panel p-8 text-center text-forge-gold/80">
        Choose an item class above to see which modifiers are available and get base recommendations.
      </div>
    );
  }

  const classPool = await getClassPool(itemClass, itemLevel);
  const withOdds = (choices: GroupChoice[]) => {
    const total = choices.reduce((s, g) => s + g.weight, 0);
    return toSelectable(choices.map((g) => ({ ...g, weight: total ? g.weight / total : 0 })));
  };

  const goal = parseGoalList(goalParam);
  const [recs, prices] = await Promise.all([
    goal.length ? recommendBases({ itemClass, itemLevel, goal, baseCost }) : Promise.resolve([]),
    loadPriceBook(),
  ]);

  return (
    <div className="space-y-4">
      {!prices.fetchedAt ? (
        <div className="panel-inset p-3 text-xs text-forge-gold">
          Live currency prices are unavailable right now; costs use conservative default prices.
        </div>
      ) : null}
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Desired modifiers for {itemClass}
        </h2>
        <GroupSelector
          prefixes={withOdds(classPool.prefixes)}
          suffixes={withOdds(classPool.suffixes)}
          actionLabel="Recommend bases"
        />
      </div>
      <Recommendations
        recs={recs}
        itemLevel={itemLevel}
        goalParam={goalParam}
        baseCost={baseCost}
        divinePriceExalted={prices.divinePriceExalted}
      />
    </div>
  );
}
