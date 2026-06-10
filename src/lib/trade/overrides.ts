/**
 * Manual mod-group -> trade-stat-id overrides for cases the normalized-text
 * matcher can't resolve (reworded stats, merged lines, trade-only pseudo
 * wording). Keyed by repoe mod group id; values are trade stat hashes.
 *
 * Add entries here when `npm run trade:coverage` (or /market) reports an
 * unmapped group. All ids verified against the local `trade_stats` mirror.
 */
export const GROUP_STAT_OVERRIDES: Record<string, string[]> = {
  // Mod text says "reduced", the trade catalog indexes the inverse
  // "#% increased Attribute Requirements" (searched with negative values).
  LocalAttributeRequirements: ["explicit.stat_3639275092"],
  // "Equipment and Skill Gems have #% reduced/increased Attribute Requirements"
  GlobalItemAttributeRequirements: ["explicit.stat_752930724"],
  // "Hits have #% reduced Critical Hit Chance against you" — catalog stores
  // the "increased" wording.
  ChanceToTakeCriticalStrike: ["explicit.stat_4270096386"],
  // "#% reduced Slowing Potency of Debuffs on You"
  SlowPotency: ["explicit.stat_924253255"],
  // "+# metres to Dodge Roll distance" (boots).
  DodgeRoll: ["explicit.stat_258119672"],
  // Focus-only: the catalog text contains a literal newline, which breaks
  // the line-by-line normalizer.
  ChanceToGainAnAdditionalInfusion: ["explicit.stat_3927679277"],
  // NOTE: ReducedAilmentDuration is intentionally NOT mapped — the same
  // group rolls "reduced Poison Duration" on belts but "reduced Bleeding
  // Duration" on body armour, which are different trade stats. A single
  // global mapping would build wrong AND-filters for one of the classes.
  // NOTE: DazeBuildup "(10-20)% chance to Daze on Hit" has no matching
  // searchable trade stat in the current catalog.
};
