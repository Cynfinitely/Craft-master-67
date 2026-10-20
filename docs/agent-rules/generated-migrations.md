# Database schema changes — HARD STOP

Adapted from the dev-standards "generated migrations" rule. This repo has no migration tool (no drizzle-kit, no migration files), so schema changes are hand-written DDL under the constraints below. If a migration tool is introduced later, replace this file with the standard generate-only rule.

## Where the schema lives

| Tables                                                                             | DDL                                                                                | Notes                                                                                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Reference data (`item_classes`, `bases`, `base_tags`, `mods`, `mod_spawn_weights`) | `scripts/seed-db.ts` only                                                          | Rebuilt from `data/snapshot/*.json` by `npm run data:seed`. Change the snapshot or the seed script, never the live tables. |
| App-owned (`saved_plans`, `favorites`, `price_cache`)                              | `src/db/ensure.ts` (`APP_TABLES_DDL`) **and** `scripts/seed-db.ts`, kept identical | Hold user data. `ensureAppTables()` runs the DDL on existing databases, so every statement must be safe to re-run.         |
| Drizzle types                                                                      | `src/db/schema.ts`                                                                 | Must match the DDL above.                                                                                                  |

## Never (without the human's explicit go-ahead)

- `DROP` a table, column, or index on an app-owned table.
- Rename a column or change its type.
- Rewrite or backfill existing user data.
- Run DDL or data changes against the remote database (`LIBSQL_URL` set). Check `.env` before running any script that writes; a local `.env` may point at hosted libSQL.

## Required workflow for an app-owned table change

1. Additive and idempotent only: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, or `ALTER TABLE … ADD COLUMN` behind an existence check (SQLite has no `ADD COLUMN IF NOT EXISTS`; check `PRAGMA table_info` first). New columns must be nullable or have a default.
2. Make the same change in `src/db/ensure.ts` and `scripts/seed-db.ts`, and update `src/db/schema.ts`.
3. Verify against a database created by the previous code: it must upgrade in place via `ensureAppTables()` without losing rows. Then verify a fresh `npm run data:seed`.
4. Anything that cannot be expressed additively: stop and ask the human.
