/** Format an exalted-orb amount for display. */
export function formatExaltedOnly(cost: number | null): string {
  if (cost == null) return "n/a";
  if (cost >= 1000) return `${(cost / 1000).toFixed(1)}k ex`;
  if (cost >= 10) return `${Math.round(cost)} ex`;
  if (cost >= 1) return `${cost.toFixed(1)} ex`;
  return `${cost.toFixed(2)} ex`;
}

/** Format a divine-orb amount for display. */
export function formatDivineOnly(divine: number): string {
  if (divine >= 100) return `${Math.round(divine)} div`;
  if (divine >= 10) return `${divine.toFixed(1)} div`;
  if (divine >= 1) return `${divine.toFixed(2)} div`;
  return `${divine.toFixed(3)} div`;
}

/** Format cost in exalted orbs, optionally with divine equivalent in parentheses. */
export function formatCost(
  costExalted: number | null,
  divinePriceExalted?: number,
): string {
  const ex = formatExaltedOnly(costExalted);
  if (costExalted == null || !divinePriceExalted || divinePriceExalted <= 0) {
    return ex;
  }
  return `${ex} (${formatDivineOnly(costExalted / divinePriceExalted)})`;
}
