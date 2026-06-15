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
import { getOpportunities } from "@/lib/market/opportunities";
import { getProbes, type ComboProbe } from "@/lib/market/probes";
import { parseRankMode } from "@/lib/market/profitPrefs";
import { formatCost } from "@/lib/pricing/format";
import { failJob, finishJob, reporterFor, startJob } from "@/lib/progress";
import { oppsProgressId } from "@/lib/progressId";
import { MarketControls } from "@/components/market/MarketControls";
import { ManualSales } from "@/components/market/ManualSales";
import { SnipePanel } from "@/components/market/SnipePanel";
import { OpportunityList } from "@/components/profit/OpportunityList";
import { ProfitControls } from "@/components/profit/ProfitControls";

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
                  <p className="mt-1 text-[11px] text-forge-gold/45">
                    {c.count} listings · median{" "}
                    {formatCost(c.medianExalted, divinePrice)}
                  </p>
                </div>
                {craftHref ? (
                  <Link
                    href={craftHref}
                    className="text-[11px] text-forge-gold/70 underline hover:text-forge-goldbright"
                  >
                    plan →
                  </Link>
                ) : null}
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
        <h3 className="text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Exact combo probes
        </h3>
      </div>
      <ul className="divide-y divide-forge-border/40">
        {probes.slice(0, 20).map((p) => (
          <li key={p.id} className="px-4 py-2.5 text-xs text-forge-gold/70">
            <div className="flex flex-wrap justify-between gap-2">
              <span>{p.labels.join(" · ")}</span>
              <span>
                {p.medianAskExalted != null
                  ? formatCost(p.medianAskExalted, divinePrice)
                  : "—"}{" "}
                · {p.listingCount} listed
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function ProfitPage({
  searchParams,
}: {
  searchParams: {
    class?: string;
    base?: string;
    ilvl?: string;
    league?: string;
    tab?: string;
    rank?: string;
    run?: string;
    view?: string;
  };
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
  const baseId = searchParams.base ?? null;
  const tab = searchParams.tab ?? "opportunities";
  const rankMode = parseRankMode(searchParams.rank);
  const itemLevel = Math.min(
    100,
    Math.max(1, Number.parseInt(searchParams.ilvl ?? "82", 10) || 82),
  );

  const classBases = itemClass
    ? (await searchBases({ itemClass, limit: 500 })).map((b) => ({
        id: b.id,
        name: b.name,
      }))
    : [];
  const pinnedBaseName =
    classBases.find((b) => b.id === baseId)?.name ?? null;

  let divinePrice = 0;
  try {
    divinePrice = (await getPrices(league)).divinePrice;
  } catch {
    /* exalted-only */
  }

  const summary = itemClass
    ? await getSampleSummary({ league, itemClass })
    : null;

  let opportunities: Awaited<
    ReturnType<typeof getOpportunities>
  >["opportunities"] = [];
  let unmappedCombos = 0;

  if (itemClass && tab === "opportunities" && searchParams.run === "opportunities") {
    const jobId = oppsProgressId(league, itemClass, searchParams.ilvl ?? "82", baseId);
    startJob(jobId, "opportunities", "Building craft opportunities…");
    try {
      const result = await getOpportunities({
        league,
        itemClass,
        itemLevel,
        baseId: pinnedBaseName ? baseId : null,
        rankMode,
        onProgress: reporterFor(jobId),
      });
      opportunities = result.opportunities;
      unmappedCombos = result.unmappedCombos;
      finishJob(
        jobId,
        `Done — ${opportunities.length} opportunities ranked.`,
      );
    } catch (err) {
      failJob(
        jobId,
        err instanceof Error ? err.message : "Opportunity build failed.",
      );
      throw err;
    }
  }

  let combosBySize = new Map<number, ComboStat[]>();
  let probes: ComboProbe[] = [];
  let manualList = await listManualSales(league);
  const craftLinks = new Map<string, string>();

  if (itemClass && (tab === "market" || tab === "manual")) {
    [combosBySize, manualList, probes] = await Promise.all([
      getComboStats({
        league,
        itemClass,
        sizes: [2, 3, 4, 5, 6],
        minCount: 2,
        limitPerSize: 15,
      }),
      listManualSales(league),
      getProbes(league, itemClass).catch(() => [] as ComboProbe[]),
    ]);
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
      /* optional */
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">
          Profit Dashboard
        </h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Find profitable crafts with sell-probability EV, market intel, and
          snipe-and-finish — ranked by profit per hour by default.
        </p>
      </div>

      <div className="panel p-4">
        <ProfitControls
          classes={categories}
          bases={classBases}
          league={league}
        />
      </div>

      {!itemClass ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          Pick an item class above — nothing loads until you scan or rank.
        </div>
      ) : tab === "snipes" ? (
        <SnipePanel itemClass={itemClass} league={league} />
      ) : tab === "manual" ? (
        <ManualSales league={league} itemClass={itemClass} sales={manualList} />
      ) : tab === "market" ? (
        <>
          <MarketControls classes={categories} league={league} />
          {summary ? (
            <div className="panel px-4 py-3 text-sm text-forge-gold/70">
              {summary.sampleCount} samples ·{" "}
              {summary.newestFetchedAt
                ? `last sampled ${timeAgo(summary.newestFetchedAt)}`
                : "never sampled — use Scan market above"}
            </div>
          ) : null}
          <ProbeTable
            probes={probes}
            itemClass={itemClass}
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
        </>
      ) : searchParams.run !== "opportunities" ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          <p>
            {summary && summary.sampleCount > 0 ? (
              <>
                {summary.sampleCount} market samples loaded for {itemClass}.
                Click{" "}
                <strong className="text-forge-gold/70">Rank opportunities</strong>{" "}
                to analyze profitable crafts.
              </>
            ) : (
              <>
                Click <strong className="text-forge-gold/70">Scan market</strong>{" "}
                first, then{" "}
                <strong className="text-forge-gold/70">Rank opportunities</strong>.
              </>
            )}
          </p>
        </div>
      ) : opportunities.length === 0 ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          <p>
            No rankable opportunities for {itemClass} in {league}. Scan market
            first, or try a different class.
          </p>
          {unmappedCombos > 0 ? (
            <p className="mt-2 text-xs text-forge-gold/40">
              {unmappedCombos} combo(s) could not be mapped to craftable mod
              groups.
            </p>
          ) : null}
        </div>
      ) : (
        <OpportunityList
          opportunities={opportunities}
          divinePrice={divinePrice}
          itemLevel={itemLevel}
          rankMode={rankMode}
        />
      )}
    </div>
  );
}
