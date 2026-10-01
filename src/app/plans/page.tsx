import Link from "next/link";
import { listFavorites, listSavedPlans } from "@/lib/user/queries";
import { repricePlan } from "@/lib/craft";
import { SavedPlansList, type PlanDrift } from "@/components/plans/SavedPlansList";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Saved Plans",
};

/** Plans re-priced on each visit (newest first); older plans show no drift. */
const REPRICE_LIMIT = 20;
const REPRICE_CONCURRENCY = 4;

/** Run `fn` over `items` with at most `limit` calls in flight. */
async function forEachLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export default async function PlansPage() {
  const [plans, favorites] = await Promise.all([listSavedPlans(), listFavorites()]);

  // Re-price each saved plan's cheapest method at today's currency prices from
  // its stored shopping list (no re-simulation) to show cost drift.
  const drift: Record<number, PlanDrift> = {};
  await forEachLimited(plans.slice(0, REPRICE_LIMIT), REPRICE_CONCURRENCY, async (p) => {
    const savedCheapest = p.plan.methods?.[0];
    if (savedCheapest?.estCostExalted == null) return;
    try {
      const now = (await repricePlan(p.plan)).get(savedCheapest.id);
      if (now != null) {
        drift[p.id] = {
          savedCostExalted: savedCheapest.estCostExalted,
          nowCostExalted: now,
          divinePriceExalted: p.plan.divinePriceExalted ?? 0,
        };
      }
    } catch {
      /* drift is optional */
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saved Plans & Favorites"
        description="Your crafting plans and favorite bases, stored locally."
      />

      <section aria-labelledby="saved-plans-heading" className="space-y-2">
        <h2 id="saved-plans-heading" className="section-title">
          Saved crafting plans
        </h2>
        {plans.length > REPRICE_LIMIT ? (
          <p className="text-xs text-forge-muted">
            Price drift shown for the {REPRICE_LIMIT} most recent plans.
          </p>
        ) : null}
        <SavedPlansList initial={plans} drift={drift} />
      </section>

      <section aria-labelledby="favorites-heading" className="space-y-2">
        <h2 id="favorites-heading" className="section-title">
          Favorite bases
        </h2>
        {favorites.length === 0 ? (
          <EmptyState
            title="No favorite bases yet"
            action={
              <Link href="/items" className="btn btn-primary tap">
                Browse items
              </Link>
            }
          >
            Star a base on the Items &amp; Mods page to keep it here.
          </EmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.map((f) => (
              <li key={f.baseId} className="min-w-0">
                <Link
                  href={`/items?base=${encodeURIComponent(f.baseId)}`}
                  className="panel flex min-h-11 min-w-0 items-center justify-between gap-3 px-4 py-3 transition-colors hover:border-forge-gold/50"
                >
                  <span className="min-w-0 truncate font-medium text-rarity-normal" title={f.name}>
                    {f.name}
                  </span>
                  {f.itemClass ? (
                    <span className="shrink-0 text-xs text-forge-muted">{f.itemClass}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
