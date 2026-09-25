import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tabletComboResults } from "@/db/schema";
import { TabletControls } from "@/components/tablets/TabletControls";
import { TabletWorkspace } from "@/components/tablets/TabletWorkspace";
import { toComboView } from "@/lib/tablets/view";
import { countUnfinishedJobs } from "@/lib/jobs/queue";
import { getActiveTabletScanJob } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";
import { getCurrentLeagueName, getLeagues, getPrices } from "@/lib/pricing/poe2scout";
import { loadTabletCatalog } from "@/lib/tablets/catalog";
import {
  comboStatusCounts,
  orderConfirmQueue,
  type ComboStatusCounts,
} from "@/lib/tablets/logic";
import { getTradeCooldownMs } from "@/lib/trade/rateLimiter";

export const dynamic = "force-dynamic";

const SAMPLE_MARKER = "__sample__";

export default async function TabletsPage({
  searchParams,
}: {
  searchParams: { league?: string; tablet?: string };
}) {
  let leagues: { value: string; label: string }[] = [];
  let league = searchParams.league ?? "";
  let error: string | null = null;
  let divineExalted = 200;
  let chaosExalted = 0.5;
  let activeJobId: string | null = null;

  try {
    const all = await getLeagues();
    const rank = (l: { isCurrent: boolean; value: string }) => {
      if (l.isCurrent && !l.value.startsWith("HC")) return 0;
      if (l.isCurrent) return 1;
      if (l.value === "Standard" || l.value === "Hardcore") return 2;
      return 3;
    };
    leagues = [...all]
      .sort((a, b) => rank(a) - rank(b) || a.value.localeCompare(b.value))
      .map((l) => ({
        value: l.value,
        label: l.isCurrent ? `${l.value} (current)` : l.value,
      }));
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
    if (priceData.divinePrice > 0) divineExalted = priceData.divinePrice;
    const chaos = priceData.items.find((i) => i.apiId === "chaos");
    if (chaos && chaos.priceExalted > 0) chaosExalted = chaos.priceExalted;
  } catch {
    /* prices are optional until a scan */
  }

  let catalog: Awaited<ReturnType<typeof loadTabletCatalog>> = [];
  try {
    catalog = await loadTabletCatalog();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load tablet mods.";
  }

  const tabletName =
    catalog.find((t) => t.name === searchParams.tablet)?.name ??
    catalog[0]?.name ??
    "";
  const tablet = catalog.find((t) => t.name === tabletName) ?? null;

  let rows: ReturnType<typeof toComboView>[] = [];
  let fetchedAt: number | null = null;
  let counts: ComboStatusCounts = { confirmed: 0, waiting: 0, thin: 0 };
  if (league && tabletName) {
    try {
      await ensureAppTables();
      const all = await getDb()
        .select()
        .from(tabletComboResults)
        .where(
          and(
            eq(tabletComboResults.league, league),
            ne(tabletComboResults.comboKey, SAMPLE_MARKER),
          ),
        )
        .orderBy(desc(tabletComboResults.floorPriceExalted));
      const raw = all.filter((r) => r.tablet === tabletName);
      rows = raw.map(toComboView);
      fetchedAt = raw.reduce((max, r) => (r.fetchedAt > max ? r.fetchedAt : max), 0) || null;
      counts = {
        ...comboStatusCounts(all),
        waiting: orderConfirmQueue(all, Date.now()).length,
      };
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load scan results.";
    }
  }

  let tradeWaitMs = 0;
  try {
    if ((await countUnfinishedJobs()) > 0) triggerQueuePump();
    const active = await getActiveTabletScanJob(league);
    activeJobId = active?.id ?? null;
    tradeWaitMs = await getTradeCooldownMs();
  } catch {
    /* best-effort */
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">Tablet crafting</h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Precursor tablet combinations that are selling, filtered by price,
          with a stash regex for the ones you keep.
        </p>
      </div>

      <div className="panel p-4">
        <TabletControls
          league={league}
          leagues={leagues}
          tablet={tabletName}
          tablets={catalog.map((t) => t.name)}
          activeJobId={activeJobId}
          fetchedAt={fetchedAt}
          counts={counts}
          tradeWaitMs={tradeWaitMs}
        />
      </div>

      {error ? (
        <div className="panel p-4 text-center text-xs text-forge-rust">{error}</div>
      ) : null}

      {catalog.length === 0 ? (
        <div className="panel p-4 text-sm text-forge-gold/60">
          Tablet mods are not in the local database yet. Run{" "}
          <code className="text-forge-goldbright">npm run data:setup</code> and restart.
        </div>
      ) : tablet ? (
        <TabletWorkspace
          key={tablet.id}
          tablet={tablet}
          rows={rows}
          chaosExalted={chaosExalted}
          divineExalted={divineExalted}
        />
      ) : null}
    </div>
  );
}
