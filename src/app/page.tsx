import Link from "next/link";

const FEATURES = [
  {
    href: "/items",
    title: "Items & Modifiers",
    desc: "Search any base item and see every prefix and suffix that can roll on it, grouped by mod group with tiers, value ranges, item-level requirements and spawn weights.",
  },
  {
    href: "/materials",
    title: "Crafting Materials",
    desc: "A reference for Path of Exile 2 crafting currencies and materials \u2014 essences, omens, runes, catalysts and more \u2014 with what each one does.",
  },
  {
    href: "/craft",
    title: "Crafting Planner",
    desc: "Pick a base and the modifiers you want, then get a step-by-step crafting path with rough odds. Or describe a goal and get a base recommendation.",
  },
  {
    href: "/price",
    title: "Price Check",
    desc: "Look up live currency values from poe2scout and estimate the rough cost of a crafting plan.",
  },
  {
    href: "/market",
    title: "Market Intel",
    desc: "Sample live trade listings to learn which explicit-mod combinations actually sell, and for how much.",
  },
  {
    href: "/opportunities",
    title: "Craft Opportunities",
    desc: "Cross live market values with crafting costs to find the most profitable items to craft right now.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="panel p-8">
        <h1 className="text-3xl font-bold text-forge-goldbright">
          Path of Exile 2 Crafting Helper
        </h1>
        <p className="mt-3 max-w-2xl text-forge-gold/80">
          A local-first toolkit for planning crafts in Path of Exile 2. Explore
          the modifier pools of any item, learn what crafting materials do, plan
          a path to the item you want, and estimate the cost.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/items" className="btn btn-primary">
            Browse items &amp; mods
          </Link>
          <Link href="/craft" className="btn">
            Plan a craft
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="panel group p-5 transition-colors hover:border-forge-gold/50"
          >
            <h2 className="text-lg font-semibold text-forge-goldbright group-hover:text-forge-gold">
              {f.title}
            </h2>
            <p className="mt-2 text-sm text-forge-gold/70">{f.desc}</p>
          </Link>
        ))}
      </section>

      <section className="panel-inset p-4 text-sm text-forge-gold/60">
        <p>
          Note: Path of Exile 2 is still evolving and crafting mechanics change
          between patches. Modifier data is a snapshot from the community
          repoe-fork export, and crafting odds shown here are approximations
          meant to guide decisions, not exact in-game probabilities.
        </p>
      </section>
    </div>
  );
}
