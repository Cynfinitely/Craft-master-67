/**
 * Seeds tablet combo prices for one league.
 *
 * Samples the expensive rare listings for every tablet, then floor-prices
 * the strongest 2-prefix + 2-suffix combinations. Pauses on trade rate limits.
 *
 *   npx tsx --require ./scripts/shim-server-only.cjs scripts/seed-tablet-combos.ts "Forbidden Rites"
 */
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { ensureAppTables } from "../src/db/ensure";
import { tabletComboResults } from "../src/db/schema";
import { runTabletScanBatch } from "../src/lib/tablets/scan";

const league = process.argv[2] || "Forbidden Rites";
const maxCombosPerTablet = Number(process.argv[3] ?? 5);
const scanStartedAt = Date.now();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(
    `Seeding up to ${maxCombosPerTablet} combos per tablet for "${league}"…`,
  );
  await ensureAppTables();
  await getDb().delete(tabletComboResults).where(eq(tabletComboResults.league, league));
  for (let step = 1; step < 400; step++) {
    let res;
    try {
      res = await runTabletScanBatch({
        league,
        scanStartedAt,
        maxCombosPerTablet,
        onProgress: (text) => console.log(`  ${text}`),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`step ${step} failed: ${message} — retrying in 20s`);
      await sleep(20_000);
      continue;
    }
    console.log(
      `step ${step}: priced ${res.priced}/${res.total} done=${res.done} rateLimit=${res.stoppedForRateLimit}`,
    );
    if (res.done) {
      console.log(`Seed complete for ${league}.`);
      return;
    }
    const wait = res.stoppedForRateLimit
      ? Math.min(15 * 60 * 1000, Math.max(8_000, res.rateLimitRetryMs ?? 20_000))
      : 2_000;
    if (res.stoppedForRateLimit) {
      console.log(`Waiting ${Math.round(wait / 1000)}s for the trade rate limit…`);
    }
    await sleep(wait);
  }
  throw new Error("Seed stopped after too many steps");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
