import { getClient } from "./index";

/**
 * Idempotent DDL for the app-owned tables, so a database seeded by an older
 * script picks them up without a full reseed. (scripts/seed-db.ts contains the
 * same statements for fresh databases.)
 */
export const APP_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS saved_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS favorites (
  base_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS price_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
`;

let ensured: Promise<void> | null = null;

/** Creates any missing app tables (cached; safe to call before every query). */
export function ensureAppTables(): Promise<void> {
  if (!ensured) {
    ensured = getClient()
      .executeMultiple(APP_TABLES_DDL)
      .catch((err) => {
        ensured = null; // allow a retry on transient failure
        throw err;
      });
  }
  return ensured;
}
