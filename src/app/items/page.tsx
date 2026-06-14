import Link from "next/link";
import {
  getModPool,
  getModTexts,
  hasBaseSearchFilter,
  listCraftableCategories,
  searchBases,
} from "@/lib/data";
import { ItemControls } from "@/components/items/ItemControls";
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

  // Essence-guaranteeable groups and optional tag filtering of the pool.
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

  // Build hrefs that preserve current filters while selecting a base.
  const buildBaseHref = (baseId: string) => {
    const p = new URLSearchParams();
    if (searchParams.q) p.set("q", searchParams.q);
    if (searchParams.class) p.set("class", searchParams.class);
    if (tag) p.set("tag", tag);
    p.set("ilvl", String(itemLevel));
    p.set("base", baseId);
    return `/items?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">
          Items &amp; Modifiers
        </h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Search any base item to see every prefix and suffix that can roll on
          it, grouped by mod group with tiers and spawn-weight odds.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="space-y-3">
          <div className="panel p-4">
            <ItemControls classes={categories} tags={[...NOTABLE_TAGS]} />
          </div>
          <div className="panel max-h-[70vh] overflow-y-auto">
            {!filterActive ? (
              <div className="p-6 text-center text-sm text-forge-gold/50">
                <p className="font-medium text-forge-gold/70">
                  Step 1: Filter bases
                </p>
                <p className="mt-2">
                  Choose an item class or search for a base name (min. 2
                  characters).
                </p>
              </div>
            ) : results.length === 0 ? (
              <p className="p-4 text-sm text-forge-gold/50">
                No bases match your search.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-forge-border/50 px-4 py-2">
                  <span className="text-xs text-forge-gold/50">
                    {results.length} base{results.length === 1 ? "" : "s"}
                  </span>
                  {searchParams.class ? (
                    <span className="tag-chip">{searchParams.class}</span>
                  ) : null}
                  {searchParams.q?.trim() ? (
                    <span className="tag-chip">
                      &ldquo;{searchParams.q.trim()}&rdquo;
                    </span>
                  ) : null}
                </div>
                <ul className="divide-y divide-forge-border/50">
                {results.map((b) => {
                  const active = b.id === searchParams.base;
                  return (
                    <li key={b.id}>
                      <Link
                        href={buildBaseHref(b.id)}
                        className={`flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors ${
                          active
                            ? "bg-forge-panel2 text-forge-goldbright"
                            : "text-forge-gold/80 hover:bg-forge-panel2/60"
                        }`}
                      >
                        <span>{b.name}</span>
                        <span className="shrink-0 text-[11px] text-forge-gold/40">
                          {b.itemClass}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {!pool ? (
            <div className="panel p-10 text-center text-forge-gold/50">
              Select a base item from the list to view its modifier pool.
            </div>
          ) : (
            <>
              <BaseHeader
                base={pool.base}
                implicitTexts={implicitTexts}
                itemLevel={pool.itemLevel}
              >
                <div className="flex shrink-0 gap-2">
                  <FavoriteButton baseId={pool.base.id} initial={favorited} />
                  <Link
                    href={`/craft?base=${encodeURIComponent(pool.base.id)}&ilvl=${pool.itemLevel}`}
                    className="btn btn-primary"
                  >
                    Plan a craft
                  </Link>
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
