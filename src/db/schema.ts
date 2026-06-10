import {
  index,
  integer,
  primaryKey,
  real,
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
 * Short-lived cache of poe2scout price responses (it updates hourly).
 */
export const priceCache = sqliteTable("price_cache", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(), // json
  fetchedAt: integer("fetched_at").notNull(),
});

/* ----------------------------- trade / market ----------------------------- */

/**
 * Generic cache for PoE2 trade API responses (searches, listings, stat
 * catalog). Keys are endpoint-specific; TTL is decided by the reader.
 */
export const tradeCache = sqliteTable("trade_cache", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(), // json
  fetchedAt: integer("fetched_at").notNull(),
});

/**
 * Searchable stat catalog from the trade API (`/api/trade2/data/stats`):
 * stat hash ids (e.g. "explicit.stat_3299347043") with display text and type.
 */
export const tradeStats = sqliteTable(
  "trade_stats",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    type: text("type").notNull(), // explicit | implicit | pseudo | rune | ...
  },
  (t) => ({
    typeIdx: index("trade_stats_type_idx").on(t.type),
  }),
);

/**
 * Sampled trade listings of finished (rare) items, used to learn which
 * explicit-mod combinations sell for how much. `stats` holds the listing's
 * explicit mods as JSON: [{ hash, name, tier, level, values }].
 */
export const marketSamples = sqliteTable(
  "market_samples",
  {
    listingId: text("listing_id").primaryKey(),
    league: text("league").notNull(),
    itemClass: text("item_class"),
    baseType: text("base_type").notNull(),
    name: text("name"),
    ilvl: integer("ilvl"),
    rarity: text("rarity"),
    priceAmount: real("price_amount"),
    priceCurrency: text("price_currency"),
    priceExalted: real("price_exalted"),
    indexedAt: text("indexed_at"),
    fetchedAt: integer("fetched_at").notNull(),
    stats: text("stats").notNull(), // json ListingStat[]
    source: text("source").notNull().default("trade"),
  },
  (t) => ({
    classIdx: index("market_samples_class_idx").on(t.league, t.itemClass),
    baseIdx: index("market_samples_base_idx").on(t.league, t.baseType),
  }),
);

/**
 * Manually-entered sale records (fallback when the trade API is unreachable,
 * or to record actual sales). `groups` is a JSON array of mod-group ids.
 */
export const manualSales = sqliteTable("manual_sales", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  league: text("league").notNull(),
  itemClass: text("item_class"),
  baseType: text("base_type").notNull(),
  ilvl: integer("ilvl"),
  priceExalted: real("price_exalted").notNull(),
  groups: text("groups").notNull(), // json string[]
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

/**
 * Targeted combo probes: one stat-filtered trade search per explicit-mod
 * combination, recording exact supply and ask prices. Far more precise than
 * inferring combo value from random samples. `comboKey` is the sorted trade
 * stat ids joined with "+"; `groups` is the matching repoe mod groups (JSON).
 */
export const comboProbes = sqliteTable(
  "combo_probes",
  {
    id: text("id").primaryKey(), // `${league}|${itemClass}|${comboKey}`
    league: text("league").notNull(),
    itemClass: text("item_class").notNull(),
    comboKey: text("combo_key").notNull(),
    groups: text("groups").notNull(), // json string[]
    labels: text("labels").notNull(), // json string[] (display names)
    /** Total online listings matching the combo (supply). */
    listingCount: integer("listing_count").notNull(),
    /** Cheapest ask among fetched listings, in Exalted. */
    minAskExalted: real("min_ask_exalted"),
    /** Median ask of the cheapest fetched listings, in Exalted. */
    medianAskExalted: real("median_ask_exalted"),
    /** Listings indexed within the last day (demand/velocity proxy). */
    recentCount: integer("recent_count"),
    tradeUrl: text("trade_url"),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => ({
    classIdx: index("combo_probes_class_idx").on(t.league, t.itemClass),
    fetchedIdx: index("combo_probes_fetched_idx").on(t.fetchedAt),
  }),
);

export type BaseRow = typeof bases.$inferSelect;
export type ModRow = typeof mods.$inferSelect;
export type SpawnWeightRow = typeof modSpawnWeights.$inferSelect;
export type SavedPlanRow = typeof savedPlans.$inferSelect;
export type MarketSampleRow = typeof marketSamples.$inferSelect;
export type ManualSaleRow = typeof manualSales.$inferSelect;
