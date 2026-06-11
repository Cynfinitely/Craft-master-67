import Link from "next/link";
import { listCraftableCategories, searchBases } from "@/lib/data";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { getOpportunities } from "@/lib/market/opportunities";
import { getSampleSummary } from "@/lib/market/analytics";
import { formatCost } from "@/lib/pricing/format";
import { OpportunityControls } from "@/components/market/OpportunityControls";
import { SnipePanel } from "@/components/market/SnipePanel";
import { failJob, finishJob, reporterFor, startJob } from "@/lib/progress";
import { oppsProgressId } from "@/lib/progressId";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: {
    class?: string;
    base?: string;
    ilvl?: string;
    league?: string;
    view?: string;
    spec?: string;
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
  const view = searchParams.view === "snipes" ? "snipes" : "crafts";
  const initialSpecId = Number.parseInt(searchParams.spec ?? "", 10);
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

  // Crafts-view-only data: skip entirely on the snipes tab so switching
  // tabs stays cheap (the SnipePanel fetches its own data client-side).
  let divinePrice = 0;
  if (view === "crafts") {
    try {
      divinePrice = (await getPrices(league)).divinePrice;
    } catch {
      /* exalted-only display */
    }
  }

  const summary =
    itemClass && view === "crafts"
      ? await getSampleSummary({ league, itemClass })
      : null;
  let result = { opportunities: [] as Awaited<ReturnType<typeof getOpportunities>>["opportunities"], unmappedCombos: 0 };
  if (itemClass && view === "crafts") {
    // Deterministic job id: the still-mounted controls on the OLD page poll
    // this id during navigation and show what the build is doing live.
    const jobId = oppsProgressId(
      league,
      itemClass,
      searchParams.ilvl ?? "82",
      baseId,
    );
    startJob(jobId, "opportunities", "Building craft opportunities…");
    try {
      result = await getOpportunities({
        league,
        itemClass,
        itemLevel,
        baseId: pinnedBaseName ? baseId : null,
        onProgress: reporterFor(jobId),
      });
      finishJob(
        jobId,
        `Done — ${result.opportunities.length} opportunities ranked.`,
      );
    } catch (err) {
      failJob(
        jobId,
        err instanceof Error ? err.message : "Opportunity build failed.",
      );
      throw err;
    }
  }
  const { opportunities, unmappedCombos } = result;

  const tabHref = (v: string) => {
    const next = new URLSearchParams();
    if (itemClass) next.set("class", itemClass);
    if (baseId) next.set("base", baseId);
    if (searchParams.ilvl) next.set("ilvl", searchParams.ilvl);
    if (searchParams.league) next.set("league", searchParams.league);
    if (v !== "crafts") next.set("view", v);
    const qs = next.toString();
    return `/opportunities${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">
          Craft Opportunities
        </h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          The best-selling mod combinations from your market samples, crossed
          with the cheapest crafting route the planner can find — ranked by
          expected profit.
        </p>
      </div>

      <div className="panel p-4">
        <OpportunityControls
          classes={categories}
          bases={classBases}
          league={league}
        />
      </div>

      <div className="flex gap-1.5">
        {[
          { id: "crafts", label: "Craft from scratch" },
          { id: "snipes", label: "Snipe & finish" },
        ].map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            className={`rounded-t border-b-2 px-3 py-1.5 text-sm transition-colors ${
              view === t.id
                ? "border-forge-gold font-semibold text-forge-goldbright"
                : "border-transparent text-forge-gold/55 hover:text-forge-gold"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {!itemClass ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          Choose an item class to rank its{" "}
          {view === "snipes" ? "snipe-and-finish" : "craft"} opportunities.
        </div>
      ) : view === "snipes" ? (
        <SnipePanel
          itemClass={itemClass}
          league={league}
          initialSpecId={
            Number.isFinite(initialSpecId) ? initialSpecId : undefined
          }
        />
      ) : opportunities.length === 0 ? (
        <div className="panel p-8 text-center text-forge-gold/50">
          <p>
            No rankable opportunities yet for{" "}
            {pinnedBaseName ? `${pinnedBaseName} (${itemClass})` : itemClass} in{" "}
            {league}.{" "}
            <Link
              href={`/market?class=${encodeURIComponent(itemClass)}`}
              className="text-forge-gold underline hover:text-forge-goldbright"
            >
              Probe meta combos or sample listings on the Market page
            </Link>{" "}
            first, then come back.
            {pinnedBaseName
              ? " Combos this base cannot roll are skipped — try “Any base”."
              : ""}
          </p>
          {summary && summary.sampleCount === 0 ? (
            <p className="mt-2 text-xs text-forge-gold/40">
              No market data at all yet — probes give the most precise
              opportunities.
            </p>
          ) : null}
          {unmappedCombos > 0 ? (
            <p className="mt-2 text-xs text-forge-gold/40">
              {unmappedCombos} high-value combo{unmappedCombos === 1 ? "" : "s"}{" "}
              couldn&apos;t be mapped to craftable mod groups (often
              desecrated/unique-only stats).
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {opportunities.map((o, rank) => (
            <div key={o.key} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-forge-gold/30 text-xs font-semibold text-forge-gold">
                      {rank + 1}
                    </span>
                    <span className="font-semibold text-forge-goldbright">
                      {o.baseName}
                    </span>
                    <span className="text-xs text-forge-gold/50">
                      iLvl {itemLevel} · {o.methodName}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        o.confidence === "high"
                          ? "bg-emerald-900/50 text-emerald-300"
                          : o.confidence === "medium"
                            ? "bg-amber-900/40 text-amber-300"
                            : "bg-forge-panel2 text-forge-gold/50"
                      }`}
                    >
                      {o.confidence} confidence
                    </span>
                    {o.saturated ? (
                      <span className="rounded bg-forge-rust/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-forge-rust">
                        saturated market
                      </span>
                    ) : null}
                    {o.rareCombo ? (
                      <span
                        className="rounded bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300"
                        title="A live probe found zero matching listings. No competition to undercut, but demand is unproven — the sale price is a rough sample estimate."
                      >
                        rare combo · 0 listed
                      </span>
                    ) : null}
                    {o.metaUses > 0 ? (
                      <span
                        className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300"
                        title="Imported ladder builds wear this combo — proven demand from the meta, not just listing data."
                      >
                        meta demand ×{o.metaUses}
                      </span>
                    ) : null}
                    {o.craftModel === "keys-fillers" ? (
                      <span
                        className="rounded bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-300"
                        title="Realistic large-combo route: lock/target the rarest key mods, accept the rest as fillers. A one-filler-short item still sells at a discount."
                      >
                        keys + fillers
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.labels.map((label, i) => (
                      <span
                        key={`${o.key}-${i}`}
                        className="rounded border border-forge-border bg-forge-panel2/60 px-1.5 py-0.5 text-xs text-forge-gold/85"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  {o.craftModel === "keys-fillers" ? (
                    <p className="mt-1.5 text-[11px] text-sky-300/80">
                      keys{o.essenceName ? ` (${o.essenceName} locks one)` : ""}
                      : {o.keyLabels.join(", ")} — rest are fillers; sellable
                      (≤1 filler short) {Math.round(o.sellableRate * 1000) / 10}
                      % per base
                    </p>
                  ) : null}
                  <p className="mt-1.5 text-[11px] text-forge-gold/45">
                    {Math.round(o.hitRate * 1000) / 10}% full-combo rate per
                    base · batch of {o.basesCount} costs ~
                    {formatCost(o.totalCostExalted, divinePrice)}
                    {o.excludesBasePrice ? " (base price unknown)" : ""}
                    {o.nearMissResaleExalted > 0
                      ? ` · near-misses resell ~${formatCost(o.nearMissResaleExalted, divinePrice)}`
                      : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-forge-gold/45">
                    sale {formatCost(o.saleExalted, divinePrice)} each
                    {o.adjustedSaleExalted < o.saleExalted ? (
                      <>
                        {" "}
                        (~{formatCost(o.adjustedSaleExalted, divinePrice)} after
                        undercut)
                      </>
                    ) : null}
                    {o.timeToSellDays != null
                      ? ` · ~${o.timeToSellDays}d to sell`
                      : ""}{" "}
                    ·{" "}
                    {o.saleSource === "probe" ? (
                      <>
                        {o.supply ?? 0} listed
                        {o.velocity != null ? ` · ${o.velocity} new today` : ""}
                        {o.sellThroughPerDay != null
                          ? ` · sells ~${o.sellThroughPerDay}/day (measured)`
                          : ""}{" "}
                        (exact probe)
                      </>
                    ) : o.rareCombo ? (
                      <>
                        none listed right now — price from {o.sampleCount}{" "}
                        random samples (unproven demand)
                      </>
                    ) : (
                      <>{o.sampleCount} random samples (rough)</>
                    )}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className={`text-lg font-bold ${
                      o.profitP50Exalted >= 0
                        ? "text-emerald-300"
                        : "text-forge-rust"
                    }`}
                  >
                    {o.profitP50Exalted >= 0 ? "+" : ""}
                    {formatCost(o.profitP50Exalted, divinePrice)}
                  </div>
                  <div className="text-[11px] text-forge-gold/55">
                    p10 {formatCost(o.profitP10Exalted, divinePrice)} · p90{" "}
                    {formatCost(o.profitP90Exalted, divinePrice)}
                  </div>
                  <div className="mt-1.5 flex flex-col items-end gap-1">
                    <Link
                      href={o.massHref}
                      className="inline-block rounded border border-forge-gold/40 px-2 py-1 text-xs text-forge-gold transition-colors hover:bg-forge-panel2 hover:text-forge-goldbright"
                    >
                      Open mass-craft plan →
                    </Link>
                    <Link
                      href={o.craftHref}
                      className="text-[11px] text-forge-gold/60 underline hover:text-forge-goldbright"
                    >
                      single-item plan
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs text-forge-gold/40">
            Profit = batch hits × median ask + near-miss resale − batch cost
            (Monte Carlo hit rates × live prices). p10/p50/p90 span the
            batch-luck range. Asks are upper bounds on realizable value — a
            saturated market means undercutting. Probe combos on the Market
            page to upgrade confidence.
          </p>
        </div>
      )}
    </div>
  );
}
