import { getClient, getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { tradeStats } from "@/db/schema";
import { fetchTradeStatCatalog, type TradeStatEntry } from "./client";

/**
 * Local mirror of the trade site's searchable stat catalog (`trade_stats`
 * table). Synced lazily at runtime (the underlying fetch is cached for 24h)
 * or explicitly via `npm run trade:stats`.
 */

let memo: TradeStatEntry[] | null = null;

/** Fetches the stat catalog and mirrors it into the `trade_stats` table. */
export async function syncTradeStats(): Promise<number> {
  await ensureAppTables();
  const entries = await fetchTradeStatCatalog();
  if (entries.length === 0) return 0;

  const client = getClient();
  const statements = entries.map((e) => ({
    sql: "INSERT OR REPLACE INTO trade_stats (id, text, type) VALUES (?, ?, ?)",
    args: [e.id, e.text, e.type],
  }));
  for (let i = 0; i < statements.length; i += 2000) {
    await client.batch(statements.slice(i, i + 2000), "write");
  }
  memo = entries;
  return entries.length;
}

/**
 * Returns the stat catalog, preferring the local mirror and syncing from the
 * trade API when the mirror is empty. Returns [] when offline with no mirror.
 */
export async function getTradeStats(): Promise<TradeStatEntry[]> {
  if (memo) return memo;
  await ensureAppTables();
  try {
    const rows = await getDb().select().from(tradeStats);
    if (rows.length > 0) {
      memo = rows.map((r) => ({ id: r.id, text: r.text, type: r.type }));
      return memo;
    }
  } catch {
    /* fall through to live sync */
  }
  try {
    await syncTradeStats();
    return memo ?? [];
  } catch {
    return [];
  }
}
