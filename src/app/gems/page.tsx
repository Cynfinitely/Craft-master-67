import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { gemCorruptionResults, type GemCorruptionResultRow } from "@/db/schema";
import { getCurrentLeagueName, getLeagues, getPrices } from "@/lib/pricing/poe2scout";
import { countUnfinishedJobs, getActiveGemScanJob } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";
import { GemCorruptionControls } from "@/components/gems/GemCorruptionControls";
import { GemCorruptionTable } from "@/components/gems/GemCorruptionTable";

export const dynamic = "force-dynamic";

function fmtDivShort(value: number | null, divinePrice: number): string | null {
  if (value == null || divinePrice <= 0) return null;
  return `${(value / divinePrice).toFixed(1)} div`;
}

function sortRows(rows: GemCorruptionResultRow[]): GemCorruptionResultRow[] {
  return [...rows].sort((a, b) => {
    const af = a.floorPriceExalted ?? a.corruptedPriceExalted;
    const bf = b.floorPriceExalted ?? b.corruptedPriceExalted;
    if (af == null && bf == null) return a.gemType.localeCompare(b.gemType);
    if (af == null) return 1;
    if (bf == null) return -1;
    return bf - af;
  });
}

export default async function GemsPage({
  searchParams,
}: {
  searchParams: { league?: string };
}) {
  let leagues: { value: string; label: string }[] = [];
  let league = searchParams.league ?? "";
  let rows: GemCorruptionResultRow[] = [];
  let lastScan: number | null = null;
  let divinePrice = 0;
  let error: string | null = null;
  let activeJobId: string | null = null;

  try {
    const all = await getLeagues();
    leagues = all
      .filter((l) => l.isCurrent || l.value === "Standard")
      .map((l) => ({ value: l.value, label: l.value }));
    if (leagues.length === 0) {
      leagues = all.map((l) => ({ value: l.value, label: l.value }));
    }
    if (!league) league = await getCurrentLeagueName();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load leagues.";
  }
  if (!league) league = "Standard";
  if (!leagues.some((l) => l.value === league)) {
    leagues = [{ value: league, label: league }, ...leagues];
  }

  try {
    const priceData = await getPrices(league);
    divinePrice = priceData.divinePrice;
  } catch {
    /* optional */
  }

  try {
    await ensureAppTables();
    const raw = await getDb()
      .select()
      .from(gemCorruptionResults)
      .where(eq(gemCorruptionResults.league, league))
      .orderBy(desc(gemCorruptionResults.floorPriceExalted));
    rows = sortRows(raw);
    lastScan = rows.reduce(
      (max, r) => (r.fetchedAt > max ? r.fetchedAt : max),
      0,
    );
    if (lastScan === 0) lastScan = null;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load saved scan.";
  }

  // Resume an interrupted scan (e.g. dev-server restart mid-run): if any job is
  // still queued/running, kick the in-process pump so it drains itself.
  try {
    if ((await countUnfinishedJobs()) > 0) triggerQueuePump();
    const activeJob = await getActiveGemScanJob(league);
    activeJobId = activeJob?.id ?? null;
  } catch {
    /* best-effort */
  }

  // Headline only liquid gems (>=3 real-currency listings) so a single whale
  // listing never masquerades as the most profitable corruption target.
  const LIQUID_MIN_LISTINGS = 3;
  const topPriced = rows.find(
    (r) =>
      r.status === "priced" &&
      r.floorPriceExalted != null &&
      (r.listingCount ?? 0) >= LIQUID_MIN_LISTINGS,
  );
  const topHeadline = topPriced
    ? fmtDivShort(topPriced.floorPriceExalted, divinePrice)
    : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">
          21/20 Gem Market
        </h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Rank every corruptable skill gem by the cheapest corrupted level-21 /
          20%-quality listings on the PoE2 trade market — e.g. if Comet 21/20
          sells for 6 divine, it&apos;s a strong corruption target.
        </p>
      </div>

      <div className="panel p-4">
        <GemCorruptionControls
          league={league}
          leagues={leagues}
          activeJobId={activeJobId}
        />
      </div>

      {topPriced && topHeadline ? (
        <div className="panel border-affix-suffix/30 bg-affix-suffix/5 p-4">
          <p className="text-[11px] uppercase tracking-wide text-affix-suffix/70">
            Most profitable to corrupt right now
          </p>
          <p className="mt-1 text-lg font-bold text-forge-goldbright">
            {topPriced.gemType}{" "}
            <span className="text-affix-suffix">— {topHeadline} floor</span>
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="panel p-4 text-center text-xs text-forge-rust">
          {error}
        </div>
      ) : null}

      {lastScan ? (
        <p className="text-[11px] text-forge-gold/40">
          Last updated for {league}: {new Date(lastScan).toLocaleString()} ·{" "}
          {rows.length} gems in table
        </p>
      ) : null}

      <GemCorruptionTable rows={rows} divinePrice={divinePrice} />
    </div>
  );
}
