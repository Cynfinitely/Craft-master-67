/**
 * Typed builder for trade2 search queries. Centralizes the advanced filters
 * the snipe/finisher engines need: weighted-sum stat groups ("70+ combined
 * resistances"), empty-prefix/suffix pseudo filters (the heart of every
 * "snipe and finish" search), charm-slot implicits, rune sockets, and the
 * fractured/desecrated/unrevealed misc toggles.
 *
 * Verified against /api/trade2/data/filters and /data/stats (0.5 league).
 */

/* ----------------------------- stat ids ----------------------------- */

export const EMPTY_PREFIX_STAT = "pseudo.pseudo_number_of_empty_prefix_mods";
export const EMPTY_SUFFIX_STAT = "pseudo.pseudo_number_of_empty_suffix_mods";
export const EMPTY_AFFIX_STAT = "pseudo.pseudo_number_of_empty_affix_mods";
/** Belt implicit "Has # Charm Slot". */
export const CHARM_SLOT_STAT = "implicit.stat_1416292992";

export const PSEUDO_TOTAL_RES: Record<string, string> = {
  fire: "pseudo.pseudo_total_fire_resistance",
  cold: "pseudo.pseudo_total_cold_resistance",
  lightning: "pseudo.pseudo_total_lightning_resistance",
  chaos: "pseudo.pseudo_total_chaos_resistance",
};

/** Single-filter "+#% total Elemental Resistance" — much cheaper against the
 * unauthenticated query-complexity limit than a weight2 group. */
export const TOTAL_ELEM_RES_STAT = "pseudo.pseudo_total_elemental_resistance";

/* ----------------------------- group types ----------------------------- */

export interface StatFilter {
  id: string;
  min?: number;
  max?: number;
  /** Weighted-sum multiplier (weight2 groups only). */
  weight?: number;
}

export interface StatGroup {
  type: "and" | "count" | "weight2" | "not";
  filters: StatFilter[];
  /** Group-level bound: weighted-sum total or count of matching filters. */
  min?: number;
  max?: number;
}

/** Weighted sum of elemental resistances >= `minTotal` (the belt-recipe search). */
export function weightedResistanceGroup(
  minTotal: number,
  opts: { includeChaos?: boolean } = {},
): StatGroup {
  const elems = ["fire", "cold", "lightning", ...(opts.includeChaos ? ["chaos"] : [])];
  return {
    type: "weight2",
    filters: elems.map((e) => ({ id: PSEUDO_TOTAL_RES[e], weight: 1 })),
    min: minTotal,
  };
}

/* ----------------------------- query builder ----------------------------- */

export interface TradeQueryOpts {
  status?: "online" | "any";
  /** Exact base type (e.g. "Heavy Belt"). */
  type?: string;
  /** Trade category option (e.g. "accessory.belt") — broader than `type`. */
  category?: string;
  rarity?: "normal" | "magic" | "rare" | "nonunique";
  ilvlMin?: number;
  ilvlMax?: number;
  /** Plain AND filters: every stat id must be present. */
  statIds?: string[];
  /** AND filters with value bounds (e.g. total elemental res >= 70). */
  statFilters?: StatFilter[];
  /** Advanced stat groups (weighted sums, counts, nots). */
  statGroups?: StatGroup[];
  /** Minimum number of EMPTY prefix slots ("1 open prefix"). */
  emptyPrefixesMin?: number;
  /** Minimum number of EMPTY suffix slots ("1 open suffix"). */
  emptySuffixesMin?: number;
  /** Minimum "Has # Charm Slot" implicit value (belts). */
  charmSlotsMin?: number;
  /** Minimum augmentable (rune) sockets. */
  runeSocketsMin?: number;
  fractured?: boolean;
  corrupted?: boolean;
  desecrated?: boolean;
  /** Has unrevealed (veiled) desecrated mods. */
  unrevealed?: boolean;
  /** Buyout price ceiling, in Exalted Orbs (trade-side filter). */
  maxPriceExalted?: number;
  sort?: Record<string, "asc" | "desc">;
}

function boolOpt(v: boolean): { option: "true" | "false" } {
  return { option: v ? "true" : "false" };
}

/** Builds a trade2 search query object from typed options. */
export function buildTradeQuery(opts: TradeQueryOpts): Record<string, unknown> {
  const stats: Record<string, unknown>[] = [];

  const andFilters: StatFilter[] = [
    ...(opts.statIds ?? []).map((id) => ({ id })),
    ...(opts.statFilters ?? []),
  ];
  if (opts.emptyPrefixesMin != null) {
    andFilters.push({ id: EMPTY_PREFIX_STAT, min: opts.emptyPrefixesMin });
  }
  if (opts.emptySuffixesMin != null) {
    andFilters.push({ id: EMPTY_SUFFIX_STAT, min: opts.emptySuffixesMin });
  }
  if (opts.charmSlotsMin != null) {
    andFilters.push({ id: CHARM_SLOT_STAT, min: opts.charmSlotsMin });
  }
  stats.push({
    type: "and",
    filters: andFilters.map((f) => ({
      id: f.id,
      disabled: false,
      ...(f.min != null || f.max != null
        ? { value: { ...(f.min != null ? { min: f.min } : {}), ...(f.max != null ? { max: f.max } : {}) } }
        : {}),
    })),
  });

  for (const g of opts.statGroups ?? []) {
    stats.push({
      type: g.type,
      ...(g.min != null || g.max != null
        ? { value: { ...(g.min != null ? { min: g.min } : {}), ...(g.max != null ? { max: g.max } : {}) } }
        : {}),
      filters: g.filters.map((f) => ({
        id: f.id,
        disabled: false,
        ...(f.weight != null
          ? { value: { weight: f.weight } }
          : f.min != null || f.max != null
            ? { value: { ...(f.min != null ? { min: f.min } : {}), ...(f.max != null ? { max: f.max } : {}) } }
            : {}),
      })),
    });
  }

  const typeFilters: Record<string, unknown> = {};
  if (opts.category) typeFilters.category = { option: opts.category };
  if (opts.rarity) typeFilters.rarity = { option: opts.rarity };
  if (opts.ilvlMin != null || opts.ilvlMax != null) {
    typeFilters.ilvl = {
      ...(opts.ilvlMin != null ? { min: opts.ilvlMin } : {}),
      ...(opts.ilvlMax != null ? { max: opts.ilvlMax } : {}),
    };
  }

  const equipmentFilters: Record<string, unknown> = {};
  if (opts.runeSocketsMin != null) {
    equipmentFilters.rune_sockets = { min: opts.runeSocketsMin };
  }

  const miscFilters: Record<string, unknown> = {};
  if (opts.fractured != null) miscFilters.fractured_item = boolOpt(opts.fractured);
  if (opts.corrupted != null) miscFilters.corrupted = boolOpt(opts.corrupted);
  if (opts.desecrated != null) miscFilters.desecrated = boolOpt(opts.desecrated);
  if (opts.unrevealed != null) miscFilters.veiled = boolOpt(opts.unrevealed);

  const tradeFilters: Record<string, unknown> = {};
  if (opts.maxPriceExalted != null) {
    tradeFilters.price = { option: "exalted", max: opts.maxPriceExalted };
  }

  const filters: Record<string, unknown> = {};
  if (Object.keys(typeFilters).length) filters.type_filters = { filters: typeFilters };
  if (Object.keys(equipmentFilters).length)
    filters.equipment_filters = { filters: equipmentFilters };
  if (Object.keys(miscFilters).length) filters.misc_filters = { filters: miscFilters };
  if (Object.keys(tradeFilters).length) filters.trade_filters = { filters: tradeFilters };

  return {
    query: {
      status: { option: opts.status ?? "online" },
      ...(opts.type ? { type: opts.type } : {}),
      stats,
      filters,
    },
    sort: opts.sort ?? { price: "asc" },
  };
}
