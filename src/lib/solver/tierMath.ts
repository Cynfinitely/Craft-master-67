import type { EligibleMod } from "@/lib/data/types";

/**
 * Tier-outcome math for blind rolls (Exalt slams, chaos rerolls, ...).
 *
 * A slam doesn't pick a tier you want — it rolls a spawn-weighted random
 * tier, and high tiers carry LOW weights. Everything that prices a "finish
 * by slamming X" plan must therefore value the EXPECTED outcome, not the
 * best one. This module is pure (no server imports) so it's unit-testable.
 */

export interface TierProfile {
  /** Spawn-weight-average modifier level of the rolled tier. */
  expectedLevel: number;
  /** Spawn-weight-average mid-roll value of the mod's first stat. */
  expectedValue: number;
  /** Highest tier's modifier level present in the pool. */
  topLevel: number;
  /** Mid-roll value of the highest tier. */
  topValue: number;
  /** P(rolling one of the top two tiers). */
  pTopTwo: number;
  tierCount: number;
}

/**
 * Profile of a blind roll over one mod group. `mods` are the group's
 * eligible tiers at the item's ilvl (already gated by the caller).
 */
export function slamTierProfile(mods: EligibleMod[]): TierProfile | null {
  const tiers = mods
    .filter((m) => m.weight > 0)
    .map((m) => ({
      level: m.requiredLevel,
      weight: m.weight,
      value: m.stats.length ? (m.stats[0].min + m.stats[0].max) / 2 : 0,
    }))
    .sort((a, b) => b.level - a.level);
  if (tiers.length === 0) return null;

  const totalWeight = tiers.reduce((s, t) => s + t.weight, 0);
  let expectedLevel = 0;
  let expectedValue = 0;
  for (const t of tiers) {
    expectedLevel += (t.weight / totalWeight) * t.level;
    expectedValue += (t.weight / totalWeight) * t.value;
  }
  const topTwoWeight = tiers
    .slice(0, 2)
    .reduce((s, t) => s + t.weight, 0);

  return {
    expectedLevel: Math.round(expectedLevel),
    expectedValue: Math.round(expectedValue * 10) / 10,
    topLevel: tiers[0].level,
    topValue: Math.round(tiers[0].value * 10) / 10,
    pTopTwo: tiers.length <= 2 ? 1 : topTwoWeight / totalWeight,
    tierCount: tiers.length,
  };
}

/** Honest one-liner about what a slam on this group really yields. */
export function slamOddsNote(label: string, p: TierProfile): string {
  if (p.tierCount <= 1) {
    return `"${label}" has a single tier — any hit is a full hit.`;
  }
  const pct = Math.round(p.pTopTwo * 100);
  return (
    `A slam rolls a random tier of "${label}": average outcome ≈ ${p.expectedValue}` +
    ` (top tier is ${p.topValue}); only ~${pct}% chance of the top two tiers.` +
    ` EV below is priced at the average outcome, not the best case.`
  );
}

/**
 * Conservative value floor used to find comparable listings for a slam
 * outcome: slightly under the expected roll so "similar or better" listings
 * match without anchoring on top-tier asks.
 */
export function slamValueFloor(p: TierProfile): number {
  return Math.max(1, Math.floor(p.expectedValue * 0.9));
}
