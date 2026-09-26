import Link from "next/link";
import { listFavorites, listSavedPlans } from "@/lib/user/queries";
import { repricePlan } from "@/lib/craft";
import { SavedPlansList, type PlanDrift } from "@/components/plans/SavedPlansList";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const [plans, favorites] = await Promise.all([listSavedPlans(), listFavorites()]);

  // Re-price each saved plan's cheapest method at today's currency prices from
  // its stored shopping list (no re-simulation) to show cost drift.
  const drift: Record<number, PlanDrift> = {};
  for (const p of plans.slice(0, 20)) {
    const savedCheapest = p.plan.methods?.[0];
    if (savedCheapest?.estCostExalted == null) continue;
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
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">Saved Plans &amp; Favorites</h1>
        <p className="mt-1 text-sm text-forge-gold/80">Your crafting plans and favorite bases, stored locally.</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Saved crafting plans
        </h2>
        <SavedPlansList initial={plans} drift={drift} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">Favorite bases</h2>
        {favorites.length === 0 ? (
          <div className="panel p-6 text-center text-forge-gold/80">
            No favorites yet. Star a base from the Items &amp; Mods page.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.map((f) => (
              <Link
                key={f.baseId}
                href={`/items?base=${encodeURIComponent(f.baseId)}`}
                className="panel flex min-h-11 min-w-0 items-center justify-between gap-3 px-4 py-3 transition-colors hover:border-forge-gold/50"
              >
                <span className="min-w-0 truncate text-rarity-normal">{f.name}</span>
                <span className="shrink-0 text-xs text-forge-gold/80">{f.itemClass}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
