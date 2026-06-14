import type { SnipeSpecMod } from "./specs";
import type { SnipeTemplate } from "./snipes";

/**
 * Pure spec -> scan-variant generation (no DB / trade access) so the
 * combinatorics are unit-testable. snipes.ts adapts its class context into
 * `SpecVariantContext` and runs the produced templates.
 */

export interface SpecVariantContext {
  itemClass: string;
  sideByGroup: Map<string, "prefix" | "suffix">;
  labelByGroup: Map<string, string>;
  /** Groups present in the normal (slammable) pool. */
  normalGroups: Set<string>;
  /** Trade stat ids per group (searchability). */
  groupToStats: Map<string, string[]>;
  /** Base id -> display name (pinned-base type filters). */
  baseNameById: Map<string, string>;
}

export interface SpecModResolved {
  group: string;
  label: string;
  side: "prefix" | "suffix";
  minLevel: number;
  /** Group exists only in the desecrated pool (finish = desecrate). */
  desecratedOnly: boolean;
  /** Has a trade-stat mapping (usable as a required search filter). */
  mapped: boolean;
}

export function resolveSpecMods(
  mods: SnipeSpecMod[],
  ctx: SpecVariantContext,
): { resolved: SpecModResolved[]; errors: string[] } {
  const resolved: SpecModResolved[] = [];
  const errors: string[] = [];
  const sides = { prefix: 0, suffix: 0 };
  for (const m of mods.slice(0, 6)) {
    const side = ctx.sideByGroup.get(m.group);
    if (!side) {
      errors.push(`"${m.group}" cannot roll on ${ctx.itemClass} — removed.`);
      continue;
    }
    sides[side]++;
    resolved.push({
      group: m.group,
      label: ctx.labelByGroup.get(m.group) ?? m.group,
      side,
      minLevel: m.minLevel ?? 0,
      desecratedOnly: !ctx.normalGroups.has(m.group),
      mapped: (ctx.groupToStats.get(m.group)?.length ?? 0) > 0,
    });
  }
  if (sides.prefix > 3 || sides.suffix > 3) {
    errors.push(
      `Target has ${sides.prefix} prefixes / ${sides.suffix} suffixes — rares cap at 3 per side.`,
    );
  }
  if (resolved.filter((m) => m.desecratedOnly).length > 1) {
    errors.push(
      "Two or more desecrated-only mods — 0.5 allows a single Desecrated modifier per item.",
    );
  }
  return { resolved, errors };
}

/** Buy cap as a fraction of the finished item's value: the margin must pay
 * for the finish currency, the miss risk, and the flip itself. */
export const SPEC_BUY_CAP_FRACTION = 0.35;
/** Trade searches are the scarce resource — cap the variants per scan. */
export const SPEC_MAX_VARIANTS = 5;

/**
 * Turns a spec into scan variants: for each finishable mod, search listings
 * carrying the other N-1 mods with the missing side open, price-capped at a
 * fraction of the finished item's value. Desecrate finishes first (strongest
 * 0.5 finish), then suffix slams, then prefix slams.
 */
export function templatesFromSpec(opts: {
  spec: { id: number; itemClass: string; baseId: string | null; name: string };
  resolved: SpecModResolved[];
  ctx: SpecVariantContext;
  finishedValue: number | null;
  warnings: string[];
}): SnipeTemplate[] {
  const { spec, resolved, ctx, finishedValue, warnings } = opts;
  const pinnedBaseName = spec.baseId
    ? (ctx.baseNameById.get(spec.baseId) ?? null)
    : null;
  const ilvlMin = Math.max(
    65,
    ...resolved.map((m) => m.minLevel).filter((l) => l > 0),
  );
  const minLevelByGroup: Record<string, number> = {};
  for (const m of resolved) {
    if (m.minLevel > 0) minLevelByGroup[m.group] = m.minLevel;
  }
  const maxPriceExalted =
    finishedValue != null
      ? Math.max(2, Math.round(finishedValue * SPEC_BUY_CAP_FRACTION))
      : undefined;

  const ordered = [...resolved].sort((a, b) => {
    const rank = (m: SpecModResolved) =>
      m.desecratedOnly ? 0 : m.side === "suffix" ? 1 : 2;
    return rank(a) - rank(b);
  });

  const out: SnipeTemplate[] = [];
  for (const missing of ordered) {
    if (out.length >= SPEC_MAX_VARIANTS) {
      warnings.push(
        `Variant "missing ${missing.label}" skipped — at most ${SPEC_MAX_VARIANTS} searches per scan.`,
      );
      continue;
    }
    const rest = resolved.filter((m) => m.group !== missing.group);
    if (rest.length === 0) continue;
    const unmappedRest = rest.filter((m) => !m.mapped);
    if (unmappedRest.length > 0) {
      warnings.push(
        `Variant "missing ${missing.label}" skipped — ${unmappedRest
          .map((m) => m.label)
          .join(", ")} has no trade-stat mapping to filter on.`,
      );
      continue;
    }
    out.push({
      id: `spec-${spec.id}-${missing.group}`,
      name: `${spec.name}: missing ${missing.label}`,
      description: `Listings with ${rest
        .map((m) => m.label)
        .join(" + ")} and an open ${missing.side} — finish by ${
        missing.desecratedOnly ? "desecrating" : "slamming"
      } ${missing.label}.`,
      itemClass: spec.itemClass,
      source: "custom",
      requiredGroups: rest.map((m) => m.group),
      query: {
        rarity: "rare",
        ilvlMin,
        ...(pinnedBaseName ? { type: pinnedBaseName } : {}),
        ...(missing.side === "prefix"
          ? { emptyPrefixesMin: 1 }
          : { emptySuffixesMin: 1 }),
        ...(maxPriceExalted != null ? { maxPriceExalted } : {}),
      },
      finish: missing.desecratedOnly
        ? {
            kind: "desecrate",
            side: missing.side,
            candidates: [missing.group],
          }
        : { kind: "slam", side: missing.side, candidates: [missing.group] },
      minLevelByGroup,
    });
  }
  return out;
}
