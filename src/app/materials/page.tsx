import {
  MaterialsBrowser,
  type MaterialGroup,
} from "@/components/materials/MaterialsBrowser";
import { getMaterialsMeta, materialsByCategory } from "@/lib/materials/source";
import { getPriceByApiId } from "@/lib/pricing/poe2scout";

export const metadata = {
  title: "Crafting Materials | PoE2 Crafting Helper",
};

// Re-fetch live prices at most hourly; the material catalog itself is static.
export const revalidate = 3600;

export default async function MaterialsPage() {
  const byCategory = materialsByCategory();
  const meta = getMaterialsMeta();
  const prices = await getPriceByApiId();

  const groups: MaterialGroup[] = byCategory.map((g) => ({
    label: g.label,
    items: g.items.map((m) => ({
      apiId: m.apiId,
      name: m.name,
      label: m.label,
      tier: m.tier,
      effect: m.effect,
      description: m.description,
      iconUrl: m.iconUrl,
      stackSize: m.stackSize,
      maxStackSize: m.maxStackSize,
      priceExalted: prices.get(m.apiId) ?? null,
    })),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-forge-goldbright">
          Crafting Materials
        </h1>
        <p className="mt-1 text-sm text-forge-gold/60">
          Every Path of Exile 2 crafting currency and material, with its exact
          in-game effect and a live market price. Essences list their guaranteed
          modifier values per item class. Prices are from poe2scout for{" "}
          <span className="text-forge-gold/80">{meta.league}</span>.
        </p>
      </div>
      <MaterialsBrowser groups={groups} />
    </div>
  );
}
