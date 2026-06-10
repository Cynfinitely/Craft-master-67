/**
 * Mod-group -> trade-stat mapping coverage report.
 *
 * For every item class, builds the trade stat map over the class's eligible
 * mod pool (normal + desecrated) and lists the groups that could NOT be
 * mapped — those are invisible to probes, sale estimates and snipe filters
 * until an override is added in src/lib/trade/overrides.ts.
 *
 * Run with: npm run trade:coverage [-- --class "Belt"] [--ilvl 82]
 */
// The lib modules import "server-only"; stub it out for CLI usage.
const Module = require("node:module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: unknown[]) {
  if (request === "server-only") {
    return require("node:path").join(
      __dirname,
      "../node_modules/server-only/empty.js",
    );
  }
  return origResolve.call(this, request, ...rest);
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { getEligibleMods, searchBases } = await import(
    "../src/lib/data/queries"
  );
  const { buildModStatMap } = await import("../src/lib/trade/modMap");
  const { CLASS_TO_TRADE_CATEGORY } = await import(
    "../src/lib/market/categories"
  );
  const { groupByModGroup, modLabel } = await import("../src/lib/data/format");

  const onlyClass = arg("class");
  const itemLevel = Number.parseInt(arg("ilvl") ?? "82", 10) || 82;
  const classes = onlyClass
    ? [onlyClass]
    : Object.keys(CLASS_TO_TRADE_CATEGORY);

  let totalGroups = 0;
  let totalUnmapped = 0;

  for (const itemClass of classes) {
    const bases = await searchBases({ itemClass, limit: 500 });
    if (bases.length === 0) continue;
    const tagSet = new Set<string>();
    for (const b of bases) for (const t of b.tags) tagSet.add(t);
    const tags = [...tagSet];
    const mods = [
      ...(await getEligibleMods(tags, itemLevel)),
      ...(await getEligibleMods(tags, itemLevel, { domains: ["desecrated"] })),
    ];
    const statMap = await buildModStatMap(mods);
    const groups = groupByModGroup(mods);
    const unmapped = groups.filter(
      (g) => !(statMap.groupToStats.get(g.group)?.length ?? 0),
    );
    totalGroups += groups.length;
    totalUnmapped += unmapped.length;

    const pct = groups.length
      ? Math.round(((groups.length - unmapped.length) / groups.length) * 100)
      : 100;
    console.log(
      `${itemClass}: ${groups.length - unmapped.length}/${groups.length} groups mapped (${pct}%)`,
    );
    for (const g of unmapped) {
      console.log(`  UNMAPPED ${g.group}  "${modLabel(g.mods[0])}"`);
    }
  }

  console.log(
    `\nTotal: ${totalGroups - totalUnmapped}/${totalGroups} mapped — ${totalUnmapped} unmapped group/class pairs.`,
  );
  if (totalUnmapped > 0) {
    console.log(
      "Add overrides for important groups in src/lib/trade/overrides.ts.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
