/**
 * Manual mod-group -> trade-stat-id overrides for cases the normalized-text
 * matcher can't resolve (reworded stats, merged lines, trade-only pseudo
 * wording). Keyed by repoe mod group id; values are trade stat hashes.
 *
 * Add entries here when /market or the planner reports an unmapped group.
 */
export const GROUP_STAT_OVERRIDES: Record<string, string[]> = {};
