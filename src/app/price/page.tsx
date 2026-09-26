import { getLeagues, getPrices } from "@/lib/pricing/poe2scout";
import { PriceExplorer } from "@/components/price/PriceExplorer";
import { PriceRefresh } from "@/components/price/PriceRefresh";

export const dynamic = "force-dynamic";

export default async function PricePage({
  searchParams,
}: {
  searchParams: { league?: string; focus?: string };
}) {
  let leagues;
  let data;
  let error: string | null = null;
  try {
    [leagues, data] = await Promise.all([
      getLeagues(),
      getPrices(searchParams.league),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load prices.";
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">Price Check</h1>
        <p className="mt-1 text-sm text-forge-gold/80">
          Currency values from poe2scout, priced in Exalted Orbs. The collector
          refreshes them about every 90 minutes.
        </p>
      </div>

      {data?.stale || data?.fetchedAt === 0 ? (
        <div className="panel-inset p-3 text-xs text-forge-gold">
          {data?.fetchedAt
            ? `Showing prices saved ${new Date(data.fetchedAt).toLocaleString()}. A refresh is due.`
            : "No prices saved yet. Queue a refresh, or wait for the collector."}
        </div>
      ) : null}

      <PriceRefresh league={data?.league || searchParams.league || leagues?.[0]?.value || ""} />

      {error || !data || !leagues ? (
        <div className="panel p-8 text-center text-forge-gold/80">
          <p>Could not load price data right now.</p>
          {error ? (
            <p className="mt-2 text-xs text-forge-gold/80">{error}</p>
          ) : null}
        </div>
      ) : (
        <PriceExplorer
          leagues={leagues}
          data={data}
          focus={searchParams.focus}
        />
      )}
    </div>
  );
}
