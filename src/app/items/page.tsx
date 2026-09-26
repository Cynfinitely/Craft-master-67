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
import { isFavorite } from "@/lib/user/queries";
import {
  guaranteedGroups,
  modHasTag,
  NOTABLE_TAGS,
} from "@/lib/solver/determinism";
import type { EligibleMod } from "@/lib/data/types";

export const dynamic = "force-dynamic";

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

  const steps = pool
    ? [
        { label: "1. Filter" },
        { label: "2. Select base" },
        { label: "3. Explore mods", active: true },
      ]
    : filterActive
      ? [
          { label: "1. Filter" },
          { label: "2. Select base", active: true },
        ]
      : [{ label: "1. Filter", active: true }];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">
          Items &amp; Modifiers
        </h1>
        <p className="mt-1 text-sm text-forge-gold/80">
          Search any base item to see every prefix and suffix that can roll on
          it, grouped by mod group with tiers and spawn-weight odds.
        </p>
      </div>

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
          {!pool ? (
            <div className="panel p-6 text-center text-forge-gold/80 sm:p-10">
              Select a base item from the list to view its modifier pool.
            </div>
          ) : (
            <>
              <BaseHeader
                base={pool.base}
                implicitTexts={implicitTexts}
                itemLevel={pool.itemLevel}
              >
                <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
                  <FavoriteButton baseId={pool.base.id} initial={favorited} />
                  <PlanCraftLink
                    href={`/craft?base=${encodeURIComponent(pool.base.id)}&ilvl=${pool.itemLevel}`}
                  />
                </div>
              </BaseHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <ModColumn
                  title="Prefixes"
                  accent="prefix"
                  mods={prefixes}
                  totalWeight={pool.prefixTotalWeight}
                  guaranteedGroups={guaranteed}
                  baseId={pool.base.id}
                  itemLevel={pool.itemLevel}
                />
                <ModColumn
                  title="Suffixes"
                  accent="suffix"
                  mods={suffixes}
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
