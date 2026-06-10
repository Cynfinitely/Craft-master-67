import Link from "next/link";
import { Suspense } from "react";
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
import { planMassCraft } from "@/lib/solver/massCraft";
import type { SimMethodId } from "@/lib/solver/simulate";
import { getPrices } from "@/lib/pricing/poe2scout";
import { CraftControls } from "@/components/craft/CraftControls";
import {
  GroupSelector,
  type SelectableGroup,
} from "@/components/craft/GroupSelector";
import { MassControls } from "@/components/craft/MassControls";
import { MassResults } from "@/components/craft/MassResults";
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
    method?: string;
    n?: string;
    chaos?: string;
  };
}) {
  const mode =
    searchParams.mode === "recommend"
      ? "recommend"
      : searchParams.mode === "paste"
        ? "paste"
        : searchParams.mode === "mass"
          ? "mass"
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
        <Suspense fallback={<SectionSkeleton label="Building the crafting plan (live prices + trade lookups)…" />}>
          <BaseMode
            q={searchParams.q}
            itemClass={searchParams.class}
            baseId={searchParams.base}
            itemLevel={itemLevel}
            selectedGroups={selectedGroups}
          />
        </Suspense>
      ) : mode === "mass" ? (
        <Suspense fallback={<SectionSkeleton label="Simulating the batch (Monte Carlo + live prices)…" />}>
          <MassMode
            q={searchParams.q}
            itemClass={searchParams.class}
            baseId={searchParams.base}
            itemLevel={itemLevel}
            selectedGroups={selectedGroups}
            methodId={searchParams.method}
            basesCount={searchParams.n}
            maxChaos={searchParams.chaos}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<SectionSkeleton label="Ranking bases for your goal…" />}>
          <RecommendMode
            itemClass={searchParams.class}
            itemLevel={itemLevel}
            selectedGroups={selectedGroups}
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
      <p className="text-center text-xs text-forge-gold/45">{label}</p>
    </div>
  );
}

async function BasePicker({
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
  const results = await searchBases({ q, itemClass });
  const buildHref = (id: string) => {
    const p = new URLSearchParams();
    p.set("mode", mode);
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
    return (
      <BasePicker q={q} itemClass={itemClass} itemLevel={itemLevel} mode="base" />
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
        <GroupSelector
          prefixes={prefixes}
          suffixes={suffixes}
          actionLabel="Build crafting plan"
        />
      </div>

      {plan ? (
        <PlanView plan={plan} />
      ) : (
        <div className="panel p-6 text-center text-forge-gold/50">
          Tick one or more modifiers above, then press “Build crafting plan”.
        </div>
      )}
    </div>
  );
}

const SIM_METHOD_IDS = new Set([
  "alch-spam",
  "alch-chaos",
  "transmute-regal-exalt",
  "perfect-seed",
  "essence-exalt",
]);

async function MassMode({
  q,
  itemClass,
  baseId,
  itemLevel,
  selectedGroups,
  methodId,
  basesCount,
  maxChaos,
}: {
  q?: string;
  itemClass?: string;
  baseId?: string;
  itemLevel: number;
  selectedGroups: string[];
  methodId?: string;
  basesCount?: string;
  maxChaos?: string;
}) {
  if (!baseId) {
    return (
      <BasePicker q={q} itemClass={itemClass} itemLevel={itemLevel} mode="mass" />
    );
  }

  const pool = await getModPool(baseId, itemLevel);
  if (!pool) {
    return <div className="panel p-6 text-forge-gold/60">Base not found.</div>;
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

  const method = SIM_METHOD_IDS.has(methodId ?? "")
    ? (methodId as SimMethodId)
    : "alch-spam";
  const n = Math.min(5000, Math.max(1, Number.parseInt(basesCount ?? "50", 10) || 50));
  const chaos = Math.min(100, Math.max(0, Number.parseInt(maxChaos ?? "10", 10) || 10));

  const plan = selectedGroups.length
    ? await planMassCraft({
        baseId,
        itemLevel,
        desiredGroups: selectedGroups,
        methodId: method,
        basesCount: n,
        maxChaos: chaos,
      })
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
          href={`/craft?mode=mass&ilvl=${itemLevel}${itemClass ? `&class=${encodeURIComponent(itemClass)}` : ""}`}
          className="btn"
        >
          Change base
        </Link>
      </div>

      <div className="panel p-4">
        <MassControls />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Select the modifiers you&apos;re hunting
        </h2>
        <GroupSelector
          prefixes={prefixes}
          suffixes={suffixes}
          actionLabel="Simulate the batch"
        />
      </div>

      {plan ? (
        <MassResults plan={plan} />
      ) : (
        <div className="panel p-6 text-center text-forge-gold/50">
          Tick one or more modifiers above, then press “Simulate the batch”.
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

  let divinePriceExalted = 0;
  try {
    const prices = await getPrices();
    divinePriceExalted = prices.divinePrice;
  } catch {
    /* omit divine column when prices unavailable */
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Desired modifiers for {itemClass}
        </h2>
        <GroupSelector
          prefixes={prefixes}
          suffixes={suffixes}
          actionLabel="Recommend bases"
        />
      </div>
      <Recommendations
        recs={recs}
        itemLevel={itemLevel}
        groups={selectedGroups}
        divinePriceExalted={divinePriceExalted}
      />
    </div>
  );
}
