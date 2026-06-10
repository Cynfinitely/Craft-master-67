/**
 * Samples live trade listings for an item class into `market_samples`.
 *
 * Usage:
 *   npm run market:sample -- --class "Helmet" [--base "Commander Greathelm"] [--league "Runes of Aldur"]
 */
import { sampleMarket } from "../src/lib/market/sampler";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function resolveLeague(): Promise<string> {
  const res = await fetch("https://poe2scout.com/api/poe2/Leagues", {
    headers: { Accept: "application/json" },
  });
  const leagues = (await res.json()) as { Value: string; IsCurrent?: boolean }[];
  const sc = leagues.find((l) => l.IsCurrent && !l.Value.startsWith("HC"));
  return sc?.Value ?? leagues.find((l) => l.IsCurrent)?.Value ?? "Standard";
}

async function main() {
  const itemClass = arg("class");
  if (!itemClass) {
    console.error('Missing --class, e.g. --class "Helmet"');
    process.exit(1);
  }
  const league = arg("league") ?? (await resolveLeague());
  console.log(`Sampling ${itemClass} listings in "${league}"...`);
  const res = await sampleMarket({
    league,
    itemClass,
    baseType: arg("base"),
  });
  console.log(
    `Fetched ${res.fetched} listings (${res.totalListings} matching online), stored ${res.inserted} samples.`,
  );
}

main().catch((err) => {
  console.error("\nSampling failed:", err);
  process.exit(1);
});
