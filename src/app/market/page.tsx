import Link from "next/link";
import { listCraftableCategories, searchBases } from "@/lib/data";
import { getEligibleMods } from "@/lib/data/queries";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { buildModStatMap } from "@/lib/trade/modMap";
import {
  getComboStats,
  getSampleSummary,
  type ComboStat,
} from "@/lib/market/analytics";
import { listManualSales } from "@/lib/market/manual";
import { getProbes, type ComboProbe } from "@/lib/market/probes";
import { formatCost } from "@/lib/pricing/format";
import { listMetaItems } from "@/lib/market/meta";
import { InfoTip } from "@/components/InfoTip";
import { MarketControls } from "@/components/market/MarketControls";
import { ManualSales } from "@/components/market/ManualSales";
import { MetaPanel } from "@/components/market/MetaPanel";

export const dynamic = "force-dynamic";

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ComboTable({
  title,
  combos,
  craftLinks,
  divinePrice,
}: {
  title: string;
  combos: ComboStat[];
  craftLinks: Map<string, string>;
  divinePrice: number;
}) {
  if (combos.length === 0) return null;
  return (
    <div className="panel">
      <div className="border-b border-forge-border px-4 py-2.5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          {title}
        </h3>
      </div>
      <ul className="divide-y divide-forge-border/40">
        {combos.map((c) => {
          const craftHref = craftLinks.get(c.key);
          return (
            <li key={c.key} className="px-4 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1.5">
                    {c.labels.map((label, i) => (
                      <span
                        key={c.statIds[i]}
                        className="rounded border border-forge-border bg-forge-panel2/60 px-1.5 py-0.5 text-xs text-forge-gold/85"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-forge-gold/45 hover:text-forge-gold/70">
                      {c.count} listings · p25 {formatCost(c.p25Exalted, divinePrice)} ·
                      p75 {formatCost(c.p75Exalted, divinePrice)} · examples
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3 text-[11px] text-forge-gold/55">
                      {c.examples.map((e, i) => (
                        <li key={i}>
                          {e.baseType} — {formatCost(e.priceExalted, divinePrice)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold text-rarity-currency">
                    {formatCost(c.medianExalted, divinePrice)}
                  </div>
                  <div className="text-[11px] text-forge-gold/45">
                    median · {c.count} sold/listed
                  </div>
                  {craftHref ? (
                    <Link
                      href={craftHref}
                      className="mt-1 inline-block text-[11px] text-forge-gold/70 underline hover:text-forge-goldbright"
                    >
                      plan this craft →
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProbeTable({
  probes,
  itemClass,
  divinePrice,
}: {
  probes: ComboProbe[];
  itemClass: string;
  divinePrice: number;
}) {
  if (probes.length === 0) return null;
  return (
    <div className="panel">
      <div className="border-b border-forge-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
            Exact combo pricing (targeted probes)
          </h3>
          <InfoTip
            label="Targeted probes"
            summary="Precise supply and ask prices from stat-filtered trade searches."
            detail={[
              "One exact trade query per meta mod combo.",
              "Shows listing count, floor ask, median ask, and sell-through.",
              "Populated by the Probe meta combos button above.",
            ]}
          />
        </div>
        <p className="mt-0.5 text-[11px] text-forge-gold/45">
          One stat-filtered trade search per combo: exact supply, cheapest
          asks, and listings added in the last day (demand proxy).
        </p>
      </div>
      <ul className="divide-y divide-forge-border/40">
        {probes.map((p) => {
          const craftHref = `/craft?mode=recommend&class=${encodeURIComponent(itemClass)}&ilvl=82&groups=${encodeURIComponent(p.groups.join(","))}`;
          const saturated = p.listingCount >= 200;
          return (
            <li key={p.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1.5">
                    {p.labels.map((label, i) => (
                      <span
                        key={`${p.id}-${i}`}
                        className="rounded border border-forge-border bg-forge-panel2/60 px-1.5 py-0.5 text-xs text-forge-gold/85"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-forge-gold/50">
                    <span>
                      {p.listingCount} listed
                      {saturated ? (
                        <span className="text-amber-400/80"> · saturated</span>
                      ) : null}
                    </span>
                    {p.recentCount != null ? (
                      <span>{p.recentCount} new today</span>
                    ) : null}
                    {p.sellThroughPerDay != null ? (
                      <span
                        className="text-emerald-300/80"
                        title="Measured between probes: previously-seen cheapest listings that vanished from the order book."
                      >
                        sells ~{p.sellThroughPerDay}/day
                      </span>
                    ) : null}
                    {p.minAskExalted != null ? (
                      <span>floor {formatCost(p.minAskExalted, divinePrice)}</span>
                    ) : null}
                    <span>probed {timeAgo(p.fetchedAt)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold text-rarity-currency">
                    {p.medianAskExalted != null
                      ? formatCost(p.medianAskExalted, divinePrice)
                      : "no asks"}
                  </div>
                  <div className="text-[11px] text-forge-gold/45">
                    median of cheapest asks
                  </div>
                  <div className="mt-1 flex justify-end gap-2 text-[11px]">
                    <Link
                      href={craftHref}
                      className="text-forge-gold/70 underline hover:text-forge-goldbright"
                    >
                      plan craft →
                    </Link>
                    {p.tradeUrl ? (
                      <a
                        href={p.tradeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-forge-gold/70 underline hover:text-forge-goldbright"
                      >
                        trade ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function MarketPage({
  searchParams,
}: {
  searchParams: { class?: string; league?: string };
}) {
  const categories = await listCraftableCategories();
  let league = searchParams.league ?? "";
  if (!league) {
    try {
      league = await getCurrentLeagueName();
    } catch {
      league = "Standard";
    }
  }
  const itemClass = searchParams.class ?? null;

  let divinePrice = 0;
  try {
    divinePrice = (await getPrices(league)).divinePrice;
  } catch {
    /* format in exalted only */
  }

  const metaList = await listMetaItems(league, itemClass).catch(() => []);

  const [summary, combosBySize, manualList, probes] = itemClass
    ? await Promise.all([
        getSampleSummary({ league, itemClass }),
        getComboStats({
          league,
          itemClass,
          sizes: [2, 3, 4, 5, 6],
          minCount: 2,
          limitPerSize: 15,
        }),
        listManualSales(league),
        getProbes(league, itemClass).catch(() => [] as ComboProbe[]),
      ])
    : [
        null,
        new Map<number, ComboStat[]>(),
        await listManualSales(league),
        [] as ComboProbe[],
      ];

  // Map combo stat-ids back to mod groups so combos can link to the planner.
  const craftLinks = new Map<string, string>();
  if (itemClass && combosBySize.size > 0) {
    try {
      const bases = await searchBases({ itemClass, limit: 500 });
      const tagSet = new Set<string>();
      for (const b of bases) for (const t of b.tags) tagSet.add(t);
      const mods = await getEligibleMods([...tagSet], 82);
      const statMap = await buildModStatMap(mods);
      for (const combos of combosBySize.values()) {
        for (const c of combos) {
          const groups: string[] = [];
          let ok = true;
          for (const id of c.statIds) {
            const g = statMap.statToGroups.get(id)?.[0];
            if (!g) {
              ok = false;
              break;
            }
            if (!groups.includes(g)) groups.push(g);
          }
          if (ok && groups.length > 0) {
            craftLinks.set(
              c.key,
              `/craft?mode=recommend&class=${encodeURIComponent(itemClass)}&ilvl=82&groups=${encodeURIComponent(groups.join(","))}`,
            );
          }
        }
      }
    } catch {
      /* links are optional */
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">Market Intel</h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Sample live rare listings from the official PoE2 trade site and see
          which explicit-mod combinations command the highest prices.
        </p>
      </div>

      <div className="panel p-4">
        <MarketControls classes={categories} league={league} />
      </div>

      {!itemClass ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          Choose an item class to see its best-selling mod combinations.
        </div>
      ) : (
        <>
          {summary ? (
            <div className="panel flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm text-forge-gold/70">
              <span>
                <span className="font-semibold text-forge-goldbright">
                  {summary.sampleCount}
                </span>{" "}
                samples
              </span>
              <span>{summary.baseTypes} base types</span>
              {summary.medianExalted != null ? (
                <span>
                  median listing {formatCost(summary.medianExalted, divinePrice)}
                </span>
              ) : null}
              {summary.newestFetchedAt ? (
                <span>last sampled {timeAgo(summary.newestFetchedAt)}</span>
              ) : null}
            </div>
          ) : null}

          <ProbeTable
            probes={probes}
            itemClass={itemClass}
            divinePrice={divinePrice}
          />
          {probes.length === 0 ? (
            <div className="panel px-4 py-3 text-sm text-forge-gold/55">
              No targeted probes yet — hit “Probe meta combos” above to get
              exact supply and ask prices for this class&apos;s meta mod
              combinations.
            </div>
          ) : null}

          {summary && summary.sampleCount === 0 ? (
            <div className="panel p-8 text-center text-forge-gold/50">
              No samples yet for {itemClass} in {league}. Hit “Sample live
              listings” above (or run{" "}
              <code className="text-forge-gold/70">npm run market:sample</code>
              ) to pull live data.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
                  Combo analytics (from samples)
                </h3>
                <InfoTip
                  label="Sample-based combos"
                  summary="Mod combinations ranked by median price from random rare listings."
                  detail={[
                    "Populated by the Sample live listings button above.",
                    "Discovers pairs through 6-mod combos you may not have probed.",
                    "Less precise than probes — good for exploration.",
                  ]}
                />
              </div>
              <ComboTable
                title="Top 6-mod combos (full items)"
                combos={combosBySize.get(6) ?? []}
                craftLinks={craftLinks}
                divinePrice={divinePrice}
              />
              <ComboTable
                title="Top 5-mod combos"
                combos={combosBySize.get(5) ?? []}
                craftLinks={craftLinks}
                divinePrice={divinePrice}
              />
              <ComboTable
                title="Top 4-mod combos"
                combos={combosBySize.get(4) ?? []}
                craftLinks={craftLinks}
                divinePrice={divinePrice}
              />
              <ComboTable
                title="Top mod triples"
                combos={combosBySize.get(3) ?? []}
                craftLinks={craftLinks}
                divinePrice={divinePrice}
              />
              <ComboTable
                title="Top mod pairs"
                combos={combosBySize.get(2) ?? []}
                craftLinks={craftLinks}
                divinePrice={divinePrice}
              />
            </div>
          )}
        </>
      )}

      <MetaPanel
        league={league}
        itemClass={itemClass}
        initialItems={metaList.map((m) => ({
          id: m.id,
          itemClass: m.itemClass,
          baseId: m.baseId,
          baseName: m.baseName,
          groups: m.groups,
          labels: m.labels,
          sourceLabel: m.sourceLabel,
        }))}
      />

      <ManualSales league={league} itemClass={itemClass} sales={manualList} />

      <p className="text-xs text-forge-gold/40">
        Listing prices are ask prices, not confirmed sales — treat medians as
        an upper bound on realizable value. Prices convert to Exalted Orbs via
        poe2scout currency rates.
      </p>
    </div>
  );
}
