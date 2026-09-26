import {
  OMEN,
  ORB_MIN_LEVEL,
  exaltSideOmen,
  orbApiId,
  type OrbKind,
  type OrbTier,
} from "../engine/actions";
import { rollable, type FillOptions } from "../engine/fill";
import type { Mod } from "../engine/state";
import { modSatisfies } from "../engine/state";
import type { Side, Target } from "../types";
import type { Applies, CraftContext, StepDraft } from "./types";

export const OK: Applies = { ok: true };

export function no(reason: string): Applies {
  return { ok: false, reason };
}

export function required(ctx: CraftContext): Target[] {
  return ctx.targets.filter((t) => !t.optional);
}

export function hasDesecratedTarget(ctx: CraftContext): boolean {
  return ctx.targets.some((t) => t.desecrated && !t.optional);
}

/** Every required target can roll from the normal pool (no desecrated-only targets). */
export function allRollable(ctx: CraftContext): Applies {
  const bad = required(ctx).find((t) => !rollable(ctx.pool, t));
  return bad ? no(`"${label(ctx, bad.group)}" can't be rolled by orbs`) : OK;
}

export function label(ctx: CraftContext, group: string): string {
  return ctx.labels.get(group) ?? group;
}

export function targetList(ctx: CraftContext, ts: Target[] = required(ctx)): string {
  return ts.map((t) => label(ctx, t.group)).join(", ");
}

export function maxMinLevel(ctx: CraftContext): number {
  let m = 0;
  for (const t of ctx.targets) if (!t.optional && t.minLevel > m) m = t.minLevel;
  return m;
}

/**
 * Orb tiers worth trying: the regular orb always; Greater / Perfect only
 * when some required tier is at least their minimum modifier level (they
 * cost more and exclude the low tiers of the targets too).
 */
export function orbTiers(ctx: CraftContext, kind: OrbKind): OrbTier[] {
  const need = maxMinLevel(ctx);
  const out: OrbTier[] = [0];
  if (need >= ORB_MIN_LEVEL[kind][1]) out.push(1);
  if (need >= ORB_MIN_LEVEL[kind][2]) out.push(2);
  return out;
}

export const TIER_LABEL = ["regular", "Greater", "Perfect"] as const;

export function orbName(ctx: CraftContext, kind: OrbKind, tier: OrbTier): string {
  return ctx.prices.name(orbApiId(kind, tier));
}

/** Cartesian product of option lists. */
export function product<T extends object>(
  dims: { [K in keyof T]: readonly T[K][] },
): T[] {
  let out: Partial<T>[] = [{}];
  for (const k of Object.keys(dims) as (keyof T)[]) {
    const next: Partial<T>[] = [];
    for (const partial of out) for (const v of dims[k]) next.push({ ...partial, [k]: v });
    out = next;
  }
  return out as T[];
}

/** Predicate for the desecration reveal: a mod that fills any target. */
export function wantsFor(targets: Target[]): (m: Mod) => boolean {
  return (m) => targets.some((t) => modSatisfies(m, t));
}

/** Targets reachable by desecration (in the desecrated pool for their side). */
export function desecratableTargets(ctx: CraftContext): Target[] {
  const pool = ctx.desecPool;
  if (!pool || !ctx.bone) return [];
  return ctx.targets.filter((t) => {
    const g = pool.byGroup.get(t.group);
    return g && g.side === t.side;
  });
}

export function sideName(side: Side): string {
  return side === "prefix" ? "prefix" : "suffix";
}

/* ----------------------------- step text ----------------------------- */

export function fillSteps(ctx: CraftContext, fill: FillOptions): StepDraft[] {
  const exalt = orbName(ctx, "exalt", fill.exaltTier);
  const steps: StepDraft[] = [
    {
      title: `Directed ${exalt} slams`,
      detail:
        `For each missing target, slam ${exalt} with ${ctx.prices.name(exaltSideOmen("prefix"))} / ` +
        `${ctx.prices.name(exaltSideOmen("suffix"))} to force its side (skip the omen when the other side is already full or needs nothing).` +
        (fill.exaltTier > 0
          ? ` ${TIER_LABEL[fill.exaltTier]} Exalts only add modifiers of level ${ORB_MIN_LEVEL.exalt[fill.exaltTier]}+.`
          : ""),
      currency: exalt,
    },
  ];
  if (fill.double) {
    steps.push({
      title: "Double-slam the last two",
      detail: `When the open slots exactly match the missing targets, add ${ctx.prices.name(OMEN.greaterExalt)} so one Exalt adds two mods.`,
      currency: ctx.prices.name(OMEN.greaterExalt),
    });
  }
  steps.push(
    fill.cleanup
      ? {
          title: "Clean up misses",
          detail:
            "When the target's side is full of junk, use Orb of Annulment with the matching Sinistral/Dextral Annulment omen, then slam again. The annul is random within the side, so it can remove a finished mod.",
          currency: ctx.prices.name("annul"),
        }
      : {
          title: "On a miss, start over",
          detail: "When the target's side fills with junk, stop and start again on a fresh base — cheaper than annulling on this goal.",
        },
  );
  return steps;
}

export function fillOptionsLabels(fill: FillOptions): string[] {
  const out = [`${TIER_LABEL[fill.exaltTier]} Exalts`];
  out.push(fill.cleanup ? "annul misses" : "restart on miss");
  if (fill.double) out.push("Greater Exaltation double-slam");
  return out;
}

export function fillKey(fill: FillOptions): string {
  return `x${fill.exaltTier}${fill.cleanup ? "c" : "r"}${fill.double ? "d" : ""}`;
}

export function fluxStep(ctx: CraftContext): StepDraft[] {
  if (!ctx.flux) return [];
  const target = label(ctx, ctx.flux.targetGroup);
  return [
    {
      title: `${ctx.flux.name} if the resistance landed as another element`,
      detail: `Any elemental resistance counts while crafting: ${ctx.flux.name} converts every elemental resistance on the item to ${target} at the same tier. Skip it if ${target} landed directly.`,
      currency: ctx.flux.name,
    },
  ];
}
