import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Item classes (e.g. "Body Armour", "Amulet") with their high-level category.
 */
export const itemClasses = sqliteTable("item_classes", {
  name: text("name").primaryKey(),
  category: text("category"),
  categoryId: text("category_id"),
});

/**
 * Base item types. JSON columns hold the raw nested structures from the
 * repoe export (requirements, properties, implicits, tags).
 */
export const bases = sqliteTable(
  "bases",
  {
    id: text("id").primaryKey(), // metadata path
    name: text("name").notNull(),
    itemClass: text("item_class").notNull(),
    domain: text("domain"),
    dropLevel: integer("drop_level").notNull().default(0),
    releaseState: text("release_state"),
    invWidth: integer("inv_width"),
    invHeight: integer("inv_height"),
    requirements: text("requirements"), // json
    properties: text("properties"), // json
    implicits: text("implicits"), // json string[]
    tags: text("tags"), // json string[]
    visualDds: text("visual_dds"),
    craftable: integer("craftable").notNull().default(0),
  },
  (t) => ({
    nameIdx: index("bases_name_idx").on(t.name),
    classIdx: index("bases_class_idx").on(t.itemClass),
    craftableIdx: index("bases_craftable_idx").on(t.craftable),
  }),
);

/**
 * Join table: which tags a base item carries. Used for reverse lookups
 * ("which bases can roll this mod").
 */
export const baseTags = sqliteTable(
  "base_tags",
  {
    baseId: text("base_id")
      .notNull()
      .references(() => bases.id),
    tag: text("tag").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.baseId, t.tag] }),
    tagIdx: index("base_tags_tag_idx").on(t.tag),
  }),
);

/**
 * Modifiers. `groups` is a JSON array of mod-group ids (only one mod per
 * group can appear on an item). `stats` and `addsTags` are JSON.
 */
export const mods = sqliteTable(
  "mods",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    type: text("type"),
    domain: text("domain").notNull(),
    generationType: text("generation_type").notNull(),
    requiredLevel: integer("required_level").notNull().default(1),
    isEssenceOnly: integer("is_essence_only").notNull().default(0),
    text: text("text"),
    groups: text("groups"), // json string[]
    stats: text("stats"), // json {id,min,max}[]
    addsTags: text("adds_tags"), // json string[]
    implicitTags: text("implicit_tags"), // json string[]
  },
  (t) => ({
    domainGenIdx: index("mods_domain_gen_idx").on(t.domain, t.generationType),
    typeIdx: index("mods_type_idx").on(t.type),
  }),
);

/**
 * Per-tag spawn weights for a mod, preserving order (`ord`). The effective
 * weight of a mod for a given base is the weight of the FIRST entry whose tag
 * the base carries (first-match semantics, including zero-weight blockers).
 */
export const modSpawnWeights = sqliteTable(
  "mod_spawn_weights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    modId: text("mod_id")
      .notNull()
      .references(() => mods.id),
    ord: integer("ord").notNull(),
    tag: text("tag").notNull(),
    weight: integer("weight").notNull(),
  },
  (t) => ({
    modIdx: index("msw_mod_idx").on(t.modId),
    tagIdx: index("msw_tag_idx").on(t.tag),
  }),
);

/* ----------------------------- user data ----------------------------- */

/**
 * Saved crafting plans (persistence feature). `payload` is a JSON blob of the
 * solver inputs/outputs so plans can be reopened.
 */
export const savedPlans = sqliteTable("saved_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  baseId: text("base_id"),
  payload: text("payload").notNull(), // json
  createdAt: integer("created_at").notNull(),
});

/**
 * Favorite base items.
 */
export const favorites = sqliteTable("favorites", {
  baseId: text("base_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

/**
 * Short-lived cache of poe.ninja responses (it updates hourly).
 */
export const priceCache = sqliteTable("price_cache", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(), // json
  fetchedAt: integer("fetched_at").notNull(),
});

export type BaseRow = typeof bases.$inferSelect;
export type ModRow = typeof mods.$inferSelect;
export type SpawnWeightRow = typeof modSpawnWeights.$inferSelect;
export type SavedPlanRow = typeof savedPlans.$inferSelect;
