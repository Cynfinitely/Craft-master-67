import type { Metadata } from "next";
import Link from "next/link";
import { PlanCraftLink } from "@/components/items/PlanCraftLink";
import {
  getModPool,
  getModTexts,
  hasBaseSearchFilter,
  listCraftableCategories,
  searchBases,
} from "@/lib/data";
import { BasePickerPanel } from "@/components/bases/BasePickerPanel";
import { ItemControls } from "@/components/items/ItemControls";
import { FilterSheet } from "@/components/ui/FilterSheet";
import { BaseHeader } from "@/components/items/BaseHeader";
import { ModColumn } from "@/components/items/ModColumn";
import { FavoriteButton } from "@/components/items/FavoriteButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { isFavorite } from "@/lib/user/queries";
import {
  guaranteedGroups,
  modHasTag,
  NOTABLE_TAGS,
} from "@/lib/craft/data/essences";
import type { EligibleMod } from "@/lib/data/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Items & Modifiers" };

function clampIlvl(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "82", 10);
  if (Number.isNaN(n)) return 82;
  return Math.min(100, Math.max(1, n));
}

function buildFilterParams(
  searchParams: {
    q?: string;
    class?: string;
    ilvl?: string;
    tag?: string;
  },
  itemLevel: number,
  tag: string,
): URLSearchParams {
  const p = new URLSearchParams();
  if (searchParams.q) p.set("q", searchParams.q);
  if (searchParams.class) p.set("class", searchParams.class);
  if (tag) p.set("tag", tag);
  p.set("ilvl", String(itemLevel));
  return p;
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    class?: string;
    ilvl?: string;
    base?: string;
    tag?: string;
  };
}) {
  const itemLevel = clampIlvl(searchParams.ilvl);
  const filterActive = hasBaseSearchFilter({
    q: searchParams.q,
    itemClass: searchParams.class,
  });
  const [categories, results] = await Promise.all([
    listCraftableCategories(),
    filterActive
      ? searchBases({ q: searchParams.q, itemClass: searchParams.class })
      : Promise.resolve([]),
  ]);

  const pool = searchParams.base
    ? await getModPool(searchParams.base, itemLevel)
    : null;
  const implicitTexts = pool
    ? await getModTexts(pool.base.implicits)
    : undefined;
  const favorited = pool ? await isFavorite(pool.base.id) : false;

  const tag = searchParams.tag?.trim() || "";
  const guaranteed = pool
    ? guaranteedGroups(pool.base.itemClass, [
        ...pool.prefixes,
        ...pool.suffixes,
      ])
    : new Set<string>();
  const tagFilter = (m: EligibleMod) => (tag ? modHasTag(m, tag) : true);
  const prefixes = pool ? pool.prefixes.filter(tagFilter) : [];
  const suffixes = pool ? pool.suffixes.filter(tagFilter) : [];

  const buildBaseHref = (baseId: string) => {
    const p = buildFilterParams(searchParams, itemLevel, tag);
    p.set("base", baseId);
    return `/items?${p.toString()}`;
  };

  const buildClearBaseHref = () => {
    const p = buildFilterParams(searchParams, itemLevel, tag);
    return `/items?${p.toString()}`;
  };

  // Base id in the URL that doesn't resolve (stale link, typo, removed base).
  const baseNotFound = !!searchParams.base && !pool;

  // StepBreadcrumb numbers the steps itself.
  const steps = pool
    ? [
        { label: "Filter" },
        { label: "Select base" },
        { label: "Explore mods", active: true },
      ]
    : filterActive
      ? [{ label: "Filter" }, { label: "Select base", active: true }]
      : [{ label: "Filter", active: true }];

  // Carry the current filters into the planner so its "Change base" list
  // isn't empty.
  const planHref = (() => {
    if (!pool) return "/craft";
    const p = new URLSearchParams();
    if (searchParams.q) p.set("q", searchParams.q);
    if (searchParams.class) p.set("class", searchParams.class);
    p.set("ilvl", String(pool.itemLevel));
    p.set("base", pool.base.id);
    return `/craft?${p.toString()}`;
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Items & Modifiers"
        description="Search any base item to see every prefix and suffix that can roll on it, grouped by mod group with tiers and spawn-weight odds."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr] xl:grid-cols-[minmax(320px,400px)_1fr_1fr]">
        <div className="space-y-3">
          <FilterSheet
            title="Filters & base"
            summary={
              pool
                ? `${pool.base.name} · ilvl ${pool.itemLevel}${tag ? ` · ${tag}` : ""}`
                : "Choose a base"
            }
            collapsed={!!pool}
          >
            <div className="panel p-4">
              <ItemControls classes={categories} tags={[...NOTABLE_TAGS]} />
            </div>
            <BasePickerPanel
              filterActive={filterActive}
              results={results}
              selectedBase={pool?.base}
              selectedBaseId={searchParams.base}
              itemClass={searchParams.class}
              query={searchParams.q}
              itemLevel={itemLevel}
              buildBaseHref={buildBaseHref}
              buildClearBaseHref={buildClearBaseHref}
              maxHeight="70vh"
              steps={steps}
              emptyHint="Choose an item class or search for a base name (min. 2 characters) above."
            />
          </FilterSheet>
        </div>

        <div className="space-y-4 xl:col-span-2">
          {baseNotFound ? (
            <EmptyState
              title="Base not found"
              action={
                <Link href={buildClearBaseHref()} className="btn">
                  Choose another base
                </Link>
              }
            >
              No base item matches the id in this link. It may have been
              renamed or removed — pick one from the list instead.
            </EmptyState>
          ) : !pool ? (
            <EmptyState title="No base selected">
              {filterActive
                ? "Select a base item from the list to view its modifier pool."
                : "Choose an item class or search for a base name, then pick a base to view its modifier pool."}
            </EmptyState>
          ) : (
            <>
              <BaseHeader
                base={pool.base}
                implicitTexts={implicitTexts}
                itemLevel={pool.itemLevel}
              >
                <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
                  <FavoriteButton
                    key={pool.base.id}
                    baseId={pool.base.id}
                    baseName={pool.base.name}
                    initial={favorited}
                  />
                  <PlanCraftLink href={planHref} />
                </div>
              </BaseHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <ModColumn
                  title="Prefixes"
                  accent="prefix"
                  mods={prefixes}
                  filterTag={tag || undefined}
                  craftFilters={{
                    q: searchParams.q,
                    itemClass: searchParams.class,
                  }}
                  totalWeight={pool.prefixTotalWeight}
                  guaranteedGroups={guaranteed}
                  baseId={pool.base.id}
                  itemLevel={pool.itemLevel}
                />
                <ModColumn
                  title="Suffixes"
                  accent="suffix"
                  mods={suffixes}
                  filterTag={tag || undefined}
                  craftFilters={{
                    q: searchParams.q,
                    itemClass: searchParams.class,
                  }}
                  totalWeight={pool.suffixTotalWeight}
                  guaranteedGroups={guaranteed}
                  baseId={pool.base.id}
                  itemLevel={pool.itemLevel}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
