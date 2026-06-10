import Link from "next/link";
import { listFavorites, listSavedPlans } from "@/lib/user/queries";
import { repriceMethods } from "@/lib/solver";
import type { DesiredMod } from "@/lib/solver/types";
import { SavedPlansList, type PlanDrift } from "@/components/plans/SavedPlansList";

export const dynamic = "force-dynamic";

function toRawGroup(d: DesiredMod): string {
  if (d.tierLevel == null) return d.group;
  return `${d.group}@${d.tierLevel}${d.desecrated ? "~d" : ""}`;
}

export default async function PlansPage() {
  const [plans, favorites] = await Promise.all([
    listSavedPlans(),
    listFavorites(),
  ]);

  // Re-price each saved plan's cheapest method at today's currency prices
  // (materials only, no trade calls) to show cost drift since it was saved.
  const drift: Record<number, PlanDrift> = {};
  for (const p of plans.slice(0, 10)) {
    const savedCheapest = p.plan.methods?.[0];
    if (!p.baseId || savedCheapest?.estCostExalted == null) continue;
    try {
      const raws = [
        ...p.plan.desiredPrefixes,
        ...p.plan.desiredSuffixes,
      ].map(toRawGroup);
      const map = await repriceMethods(p.baseId, p.plan.itemLevel, raws);
      const now = map?.get(savedCheapest.id);
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
        <h1 className="text-2xl font-bold text-forge-goldbright">
          Saved Plans &amp; Favorites
        </h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Your crafting plans and favorite bases, stored locally.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Saved crafting plans
        </h2>
        <SavedPlansList initial={plans} drift={drift} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-forge-gold/70">
          Favorite bases
        </h2>
        {favorites.length === 0 ? (
          <div className="panel p-6 text-center text-forge-gold/50">
            No favorites yet. Star a base from the Items &amp; Mods page.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {favorites.map((f) => (
              <Link
                key={f.baseId}
                href={`/items?base=${encodeURIComponent(f.baseId)}`}
                className="panel flex items-center justify-between px-4 py-3 transition-colors hover:border-forge-gold/50"
              >
                <span className="text-rarity-normal">{f.name}</span>
                <span className="text-xs text-forge-gold/40">
                  {f.itemClass}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
