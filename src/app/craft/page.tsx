import Link from "next/link";
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
import { PageSkeleton } from "@/components/PageSkeleton";
import { Alert } from "@/components/ui/Alert";
import { AffixMark } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Crafting Planner",
};

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
    <div className="space-y-6">
      <PageHeader
        title="Crafting Planner"
        description={
          <>
            Pick a base and the modifiers you want. The crafting brain simulates every technique it knows, tunes each
            one&apos;s options, and ranks them by expected cost per finished item.
          </>
        }
      />

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
        <Suspense fallback={<PageSkeleton variant="section" label="The brain is simulating techniques…" />}>
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
        <Suspense fallback={<PageSkeleton variant="section" label="Simulating how to finish your item…" />}>
          <FinishMode
            baseId={searchParams.base}
            itemLevel={itemLevel}
            goalParam={goalParam}
            baseCost={baseCost}
            current={parseCurrentMods(searchParams.current)}
          />
        </Suspense>
      ) : mode === "mass" ? (
        <Suspense fallback={<PageSkeleton variant="section" label="Simulating the batch…" />}>
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
        <Suspense fallback={<PageSkeleton variant="section" label="Ranking bases for your goal…" />}>
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

function BaseNotFound({ href, actionLabel }: { href: string; actionLabel: string }) {
  return (
    <EmptyState
      title="Base not found"
      action={
        <Link href={href} className="btn">
          {actionLabel}
        </Link>
      }
    >
      This base doesn&apos;t exist in the current data, or the link is out of date.
    </EmptyState>
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
      steps={[{ label: "Filter" }, { label: "Select base", active: true }]}
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
  if (!groups) {
    return (
      <BaseNotFound
        href={`/craft?${filterParams("base", q, itemClass, itemLevel).toString()}`}
        actionLabel="Choose another base"
      />
    );
  }

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
        <h2 className="section-title mb-2">Select the modifiers you want</h2>
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
        <EmptyState title="No modifiers applied yet">
          Tick one or more modifiers above, then press “Build crafting plan”.
        </EmptyState>
      )}
    </div>
  );
}

function CurrentItemCard({ current, labels }: { current: CurrentMod[]; labels: Map<string, string> }) {
  return (
    <div className="panel p-4">
      <h2 className="section-title">Your item right now</h2>
      {current.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {current.map((m) => (
            <li
              key={m.group}
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs ${
                m.side === "prefix"
                  ? "border-affix-prefix/40 text-affix-prefix"
                  : "border-affix-suffix/40 text-affix-suffix"
              }`}
            >
              <AffixMark kind={m.side} />
              {labels.get(m.group) ?? m.group}
              {m.level ? <span className="text-forge-muted">lvl {m.level}</span> : null}
              {m.fractured ? <span className="text-forge-muted">(fractured)</span> : null}
              {m.desecrated ? <span className="text-forge-muted">(desecrated)</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-forge-muted">No modifiers.</p>
      )}
      <p className="mt-2 text-xs text-forge-muted">
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
      <EmptyState
        title="No item to finish yet"
        action={
          <Link href="/craft?mode=paste" className="btn">
            Paste an item
          </Link>
        }
      >
        Paste an item on the Paste tab, then choose “Finish this item”.
      </EmptyState>
    );
  }
  const groups = await getBaseGroups(baseId, itemLevel);
  if (!groups) return <BaseNotFound href="/craft?mode=paste" actionLabel="Paste another item" />;
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
      <div>
        <h2 className="section-title mb-2">Select the modifiers the finished item needs</h2>
        <GroupSelector
          prefixes={toSelectable(groups.prefixes)}
          suffixes={toSelectable(groups.suffixes)}
          desecrated={toSelectable(groups.desecrated)}
          actionLabel="Plan the finish"
        />
      </div>
      {plan ? (
        <PlanView plan={plan} />
      ) : (
        <EmptyState title="No modifiers applied yet">
          Tick the modifiers the finished item should have, then press “Plan the finish”.
        </EmptyState>
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
  if (!groups) {
    return (
      <BaseNotFound
        href={`/craft?${filterParams("mass", q, itemClass, itemLevel).toString()}`}
        actionLabel="Choose another base"
      />
    );
  }

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
        <h2 className="section-title mb-2">Select the modifiers you&apos;re hunting</h2>
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
        <EmptyState title="No technique reaches this goal on this base">
          <p>Try one of these, then simulate again:</p>
          <ul className="mt-2 inline-block list-inside list-disc text-left">
            <li>lower the minimum tiers</li>
            <li>pick fewer modifiers, or mark some optional</li>
            <li>raise the item level so higher tiers can roll</li>
          </ul>
        </EmptyState>
      ) : (
        <EmptyState title="No modifiers applied yet">
          Tick one or more modifiers above, then press “Simulate the batch”.
        </EmptyState>
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
      <EmptyState title="Choose an item class">
        Choose an item class above to see which modifiers are available and get base recommendations.
      </EmptyState>
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
        <Alert tone="warn">
          Live currency prices are unavailable right now; costs use conservative default prices.
        </Alert>
      ) : null}
      <div>
        <h2 className="section-title mb-2">Desired modifiers for {itemClass}</h2>
        <GroupSelector
          prefixes={withOdds(classPool.prefixes)}
          suffixes={withOdds(classPool.suffixes)}
          actionLabel="Recommend bases"
        />
      </div>
      <Recommendations
        recs={recs}
        hasGoal={goal.some((g) => !g.optional)}
        itemLevel={itemLevel}
        goalParam={goalParam}
        baseCost={baseCost}
        divinePriceExalted={prices.divinePriceExalted}
      />
    </div>
  );
}
