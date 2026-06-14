import { runIncrementalScan } from "../src/lib/market/scanner";
import { getCurrentLeagueName } from "../src/lib/pricing/poe2scout";

const league = process.argv[2] ?? (await getCurrentLeagueName().catch(() => "Standard"));
const itemClass = process.argv[3] ?? "Ring";

runIncrementalScan({ league, itemClass, probeBudget: 20 })
  .then((r) => {
    console.log(
      `Scan complete: probed ${r.probed} combos, ${r.sampled} samples for ${r.itemClass} (${league})`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
