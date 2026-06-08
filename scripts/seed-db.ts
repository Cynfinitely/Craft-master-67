/**
 * Builds data/poe2.db from the JSON snapshot in data/snapshot/.
 *
 * Run with: npm run data:seed  (or `npm run data:setup` to refresh + seed)
 */
import { createClient, type InStatement } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import {
  baseItemsFile,
  itemClassesFile,
  modsFile,
  tagsFile,
} from "./lib/repoe-schema";

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "snapshot");
const DB_PATH = path.join(process.cwd(), "data", "poe2.db");

// Mod domains relevant to item crafting. Other domains (monster, area, etc.)
// are skipped to keep the database focused.
const MOD_DOMAINS = new Set(["item", "crafted", "desecrated"]);

// Core equippable gear item classes (by item_classes.category_id). Anything
// outside this set (currency, gems, maps, soul cores, etc.) is marked
// non-craftable so it stays out of the base browser and planner.
const CRAFTABLE_CATEGORIES = new Set([
  // Martial / caster weapons
  "One Hand Mace",
  "Two Hand Mace",
  "One Hand Sword",
  "Two Hand Sword",
  "One Hand Axe",
  "Two Hand Axe",
  "Dagger",
  "Claw",
  "Bow",
  "Crossbow",
  "Wand",
  "Sceptre",
  "Staff",
  "Warstaff",
  "Spear",
  "Flail",
  // Armour
  "Body Armour",
  "Helmet",
  "Gloves",
  "Boots",
  // Off-hand
  "Shield",
  "Buckler",
  "Focus",
  // Jewellery
  "Ring",
  "Amulet",
  "Belt",
  // Ranged off-hand
  "Quiver",
]);

const DDL = `
DROP TABLE IF EXISTS mod_spawn_weights;
DROP TABLE IF EXISTS mods;
DROP TABLE IF EXISTS base_tags;
DROP TABLE IF EXISTS bases;
DROP TABLE IF EXISTS item_classes;

CREATE TABLE item_classes (
  name TEXT PRIMARY KEY,
  category TEXT,
  category_id TEXT
);

CREATE TABLE bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  item_class TEXT NOT NULL,
  domain TEXT,
  drop_level INTEGER NOT NULL DEFAULT 0,
  release_state TEXT,
  inv_width INTEGER,
  inv_height INTEGER,
  requirements TEXT,
  properties TEXT,
  implicits TEXT,
  tags TEXT,
  visual_dds TEXT,
  craftable INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX bases_name_idx ON bases(name);
CREATE INDEX bases_class_idx ON bases(item_class);
CREATE INDEX bases_craftable_idx ON bases(craftable);

CREATE TABLE base_tags (
  base_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (base_id, tag)
);
CREATE INDEX base_tags_tag_idx ON base_tags(tag);

CREATE TABLE mods (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  domain TEXT NOT NULL,
  generation_type TEXT NOT NULL,
  required_level INTEGER NOT NULL DEFAULT 1,
  is_essence_only INTEGER NOT NULL DEFAULT 0,
  text TEXT,
  groups TEXT,
  stats TEXT,
  adds_tags TEXT,
  implicit_tags TEXT
);
CREATE INDEX mods_domain_gen_idx ON mods(domain, generation_type);
CREATE INDEX mods_type_idx ON mods(type);

CREATE TABLE mod_spawn_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mod_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  tag TEXT NOT NULL,
  weight INTEGER NOT NULL
);
CREATE INDEX msw_mod_idx ON mod_spawn_weights(mod_id);
CREATE INDEX msw_tag_idx ON mod_spawn_weights(tag);

-- user data tables (created if missing; not dropped on reseed)
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

function readSnapshot<T>(file: string): T {
  const full = path.join(SNAPSHOT_DIR, file);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Missing snapshot file: ${full}\nRun \`npm run data:refresh\` first.`,
    );
  }
  return JSON.parse(fs.readFileSync(full, "utf8")) as T;
}

async function runStatements(
  client: ReturnType<typeof createClient>,
  statements: InStatement[],
  chunkSize = 2000,
): Promise<void> {
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    await client.batch(chunk, "write");
  }
}

async function main() {
  // Start from a clean database file.
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const client = createClient({ url: `file:${DB_PATH}` });

  console.log("Creating schema...");
  await client.executeMultiple(DDL);

  console.log("Parsing snapshot...");
  const rawClasses = itemClassesFile.parse(readSnapshot("item_classes.json"));
  const rawBases = baseItemsFile.parse(readSnapshot("base_items.json"));
  const rawMods = modsFile.parse(readSnapshot("mods.json"));
  // tags.json is validated but we don't need a dedicated table for it.
  tagsFile.parse(readSnapshot("tags.json"));

  /* ---- item classes ---- */
  const classStmts: InStatement[] = Object.entries(rawClasses).map(
    ([name, c]) => ({
      sql: "INSERT INTO item_classes (name, category, category_id) VALUES (?, ?, ?)",
      args: [name, c.category ?? null, c.category_id ?? null],
    }),
  );
  console.log(`Inserting ${classStmts.length} item classes...`);
  await runStatements(client, classStmts);

  /* ---- bases + base_tags ---- */
  const baseStmts: InStatement[] = [];
  const baseTagStmts: InStatement[] = [];
  let craftableCount = 0;
  for (const [id, b] of Object.entries(rawBases)) {
    const tags = b.tags ?? [];
    const categoryId = rawClasses[b.item_class]?.category_id ?? null;
    const craftable =
      categoryId !== null &&
      CRAFTABLE_CATEGORIES.has(categoryId) &&
      (b.release_state ?? "released") === "released"
        ? 1
        : 0;
    if (craftable) craftableCount++;
    baseStmts.push({
      sql: `INSERT INTO bases
        (id, name, item_class, domain, drop_level, release_state, inv_width, inv_height, requirements, properties, implicits, tags, visual_dds, craftable)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        b.name,
        b.item_class,
        b.domain ?? null,
        b.drop_level ?? 0,
        b.release_state ?? null,
        b.inventory_width ?? null,
        b.inventory_height ?? null,
        b.requirements ? JSON.stringify(b.requirements) : null,
        b.properties ? JSON.stringify(b.properties) : null,
        JSON.stringify(b.implicits ?? []),
        JSON.stringify(tags),
        b.visual_identity?.dds_file ?? null,
        craftable,
      ],
    });
    for (const tag of tags) {
      baseTagStmts.push({
        sql: "INSERT OR IGNORE INTO base_tags (base_id, tag) VALUES (?, ?)",
        args: [id, tag],
      });
    }
  }
  console.log(
    `Inserting ${baseStmts.length} bases (${craftableCount} craftable)...`,
  );
  await runStatements(client, baseStmts);
  console.log(`Inserting ${baseTagStmts.length} base-tag rows...`);
  await runStatements(client, baseTagStmts);

  /* ---- mods + spawn weights ---- */
  const modStmts: InStatement[] = [];
  const weightStmts: InStatement[] = [];
  let modCount = 0;
  for (const [id, m] of Object.entries(rawMods)) {
    if (!MOD_DOMAINS.has(m.domain)) continue;
    modCount++;
    modStmts.push({
      sql: `INSERT INTO mods
        (id, name, type, domain, generation_type, required_level, is_essence_only, text, groups, stats, adds_tags, implicit_tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        m.name ?? null,
        m.type ?? null,
        m.domain,
        m.generation_type,
        m.required_level ?? 1,
        m.is_essence_only ? 1 : 0,
        m.text ?? null,
        JSON.stringify(m.groups ?? []),
        JSON.stringify(m.stats ?? []),
        JSON.stringify(m.adds_tags ?? []),
        JSON.stringify(m.implicit_tags ?? []),
      ],
    });
    const weights = m.spawn_weights ?? [];
    weights.forEach((w, ord) => {
      weightStmts.push({
        sql: "INSERT INTO mod_spawn_weights (mod_id, ord, tag, weight) VALUES (?, ?, ?, ?)",
        args: [id, ord, w.tag, w.weight],
      });
    });
  }
  console.log(`Inserting ${modCount} mods...`);
  await runStatements(client, modStmts);
  console.log(`Inserting ${weightStmts.length} spawn-weight rows...`);
  await runStatements(client, weightStmts);

  // Quick sanity counts.
  const counts = await client.batch(
    [
      "SELECT COUNT(*) AS n FROM bases",
      "SELECT COUNT(*) AS n FROM mods",
      "SELECT COUNT(*) AS n FROM mod_spawn_weights",
    ],
    "read",
  );
  console.log(
    `Done. bases=${counts[0].rows[0].n}, mods=${counts[1].rows[0].n}, weights=${counts[2].rows[0].n}`,
  );
  console.log(`Database written to ${DB_PATH}`);
  client.close();
}

main().catch((err) => {
  console.error("\nSeed failed:", err);
  process.exit(1);
});
