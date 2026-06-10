/**
 * Deterministic progress-job ids for SSR-driven actions, computable on BOTH
 * sides: the server page registers the job under this id while it builds,
 * and the still-mounted client controls poll the same id during navigation.
 */
export function oppsProgressId(
  league: string,
  itemClass: string,
  ilvl: string,
  baseId?: string | null,
): string {
  return `opps:${league}:${itemClass}:${ilvl}:${baseId ?? ""}`;
}
