import { getClient } from "./index";

/**
 * Idempotent DDL for tables added after the original seed script shipped.
 * Lets an existing data/poe2.db pick up new tables without a full reseed.
 * (scripts/seed-db.ts contains the same statements for fresh databases.)
 */
export const APP_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS trade_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trade_stats (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_stats_type_idx ON trade_stats(type);
CREATE TABLE IF NOT EXISTS market_samples (
  listing_id TEXT PRIMARY KEY,
  league TEXT NOT NULL,
  item_class TEXT,
  base_type TEXT NOT NULL,
  name TEXT,
  ilvl INTEGER,
  rarity TEXT,
  price_amount REAL,
  price_currency TEXT,
  price_exalted REAL,
  indexed_at TEXT,
  fetched_at INTEGER NOT NULL,
  stats TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'trade'
);
CREATE INDEX IF NOT EXISTS market_samples_class_idx ON market_samples(league, item_class);
CREATE INDEX IF NOT EXISTS market_samples_base_idx ON market_samples(league, base_type);
CREATE TABLE IF NOT EXISTS manual_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league TEXT NOT NULL,
  item_class TEXT,
  base_type TEXT NOT NULL,
  ilvl INTEGER,
  price_exalted REAL NOT NULL,
  groups TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS combo_probes (
  id TEXT PRIMARY KEY,
  league TEXT NOT NULL,
  item_class TEXT NOT NULL,
  combo_key TEXT NOT NULL,
  groups TEXT NOT NULL,
  labels TEXT NOT NULL,
  listing_count INTEGER NOT NULL,
  min_ask_exalted REAL,
  median_ask_exalted REAL,
  recent_count INTEGER,
  trade_url TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS combo_probes_class_idx ON combo_probes(league, item_class);
CREATE INDEX IF NOT EXISTS combo_probes_fetched_idx ON combo_probes(fetched_at);
CREATE TABLE IF NOT EXISTS listing_snapshots (
  probe_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  price_exalted REAL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (probe_id, listing_id)
);
CREATE INDEX IF NOT EXISTS listing_snapshots_probe_idx ON listing_snapshots(probe_id);
CREATE TABLE IF NOT EXISTS snipe_specs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league TEXT NOT NULL,
  item_class TEXT NOT NULL,
  base_id TEXT,
  name TEXT NOT NULL,
  mods TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league TEXT NOT NULL,
  item_class TEXT NOT NULL,
  base_id TEXT,
  base_name TEXT,
  groups TEXT NOT NULL,
  labels TEXT NOT NULL DEFAULT '[]',
  source_label TEXT,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS meta_items_class_idx ON meta_items(league, item_class);
`;

/** Columns added to existing tables after they shipped (idempotent ALTERs —
 * each runs in its own statement and "duplicate column" errors are ignored). */
const COLUMN_MIGRATIONS = [
  "ALTER TABLE combo_probes ADD COLUMN sell_through_per_day REAL",
];

let ensured: Promise<void> | null = null;

/** Creates any missing app tables (cached; safe to call before every query). */
export function ensureAppTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const client = getClient();
      await client.executeMultiple(APP_TABLES_DDL);
      for (const sql of COLUMN_MIGRATIONS) {
        try {
          await client.execute(sql);
        } catch {
          /* column already exists */
        }
      }
    })().catch((err) => {
      ensured = null; // allow a retry on transient failure
      throw err;
    });
  }
  return ensured;
}
