/**
 * Sell-through math (pure, unit-testable). The trade API exposes no sales
 * feed, but listings that vanish from the order book between two probes of
 * the same combo ≈ sold — the most direct demand signal available.
 */

/** Minimum gap between snapshots before a disappearance rate is trusted. */
export const SELL_THROUGH_MIN_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Items sold per day, estimated as the cheapest previously-seen listings
 * that have since vanished. Listings can also be delisted (not sold), so
 * this is an upper-bound proxy — but unlike "new listings per day" it
 * measures actual outflow, not inflow.
 */
export function computeSellThrough(
  prevIds: string[],
  currentIds: Iterable<string>,
  windowMs: number,
): number | null {
  if (prevIds.length === 0 || windowMs < SELL_THROUGH_MIN_WINDOW_MS) {
    return null;
  }
  const cur = new Set(currentIds);
  const gone = prevIds.filter((id) => !cur.has(id)).length;
  const perDay = gone / (windowMs / 86_400_000);
  return Math.round(perDay * 100) / 100;
}
