/**
 * Mirrors the PoE2 trade site's searchable stat catalog into the local
 * `trade_stats` table (used to map repoe mod groups to trade stat hashes).
 *
 * Run with: npm run trade:stats
 */
import { syncTradeStats } from "../src/lib/trade/stats";

async function main() {
  console.log("Fetching trade stat catalog...");
  const count = await syncTradeStats();
  console.log(`Synced ${count} trade stats into data/poe2.db`);
}

main().catch((err) => {
  console.error("\nSync failed:", err);
  process.exit(1);
});
