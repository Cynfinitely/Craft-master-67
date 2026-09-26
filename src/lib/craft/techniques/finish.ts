import type { OrbTier } from "../engine/actions";
import { directedFill, type FillOptions } from "../engine/fill";
import { targetSatisfied } from "../engine/state";
import type { Target } from "../types";
import {
  OK,
  desecratableTargets,
  fillKey,
  fillOptionsLabels,
  fillSteps,
  label,
  no,
  orbTiers,
  product,
  wantsFor,
} from "./helpers";
import { desecrateStep } from "./desecrateStep";
import { defineTechnique, type CraftContext, type EssenceOption } from "./types";

function missing(ctx: CraftContext): Target[] {
  const start = ctx.start;
  if (!start) return [];
  return ctx.targets.filter((t) => !t.optional && !targetSatisfied(start, t));
}

const START_STEP = (ctx: CraftContext) => ({
  title: "Start from your item",
  detail: `Your ${ctx.baseName} with its current mods. A bricked attempt means buying or finding another copy at the base cost you entered.`,
});

export const finishSlam = defineTechnique<FillOptions>({
  id: "finish-slam",
  name: "Finish with directed Exalts",
  summary: "Omen-directed Exalt slams into the open slots of your item.",
  modes: ["finish"],
  applies(ctx) {
    if (!missing(ctx).length) return no("Nothing missing");
    return OK;
  },
  choices: (ctx) =>
    product<{ exaltTier: OrbTier; cleanup: boolean; double: boolean }>({
      exaltTier: orbTiers(ctx, "exalt"),
      cleanup: [true, false],
      double: [false, true],
    }),
  key: fillKey,
  run(c, t, ctx) {
    directedFill(t, ctx.targets, c);
  },
  describe: (c, ctx) => [START_STEP(ctx), ...fillSteps(ctx, c)],
  options: (c) => fillOptionsLabels(c),
  pros: () => ["Keeps everything already on the item."],
  cons: () => ["A full side of junk needs annulling first."],
});

interface DesecChoice {
  desec: Target;
  echoes: boolean;
  fill: FillOptions;
}

export const finishDesecrate = defineTechnique<DesecChoice>({
  id: "finish-desecrate",
  name: "Finish with desecration",
  summary: "Desecrate a missing target into an open slot, then directed Exalts for anything left.",
  modes: ["finish"],
  applies(ctx) {
    const miss = missing(ctx);
    const desec = desecratableTargets(ctx).filter((t) => miss.includes(t));
    if (!desec.length) return no("No missing target can be desecrated");
    if (ctx.start?.mods.some((m) => m.desecrated)) return no("Item already has a desecrated mod");
    return OK;
  },
  choices(ctx) {
    const miss = missing(ctx);
    const out: DesecChoice[] = [];
    for (const desec of desecratableTargets(ctx).filter((t) => miss.includes(t)))
      for (const echoes of [false, true])
        for (const cleanup of [true, false])
          out.push({ desec, echoes, fill: { exaltTier: 0, cleanup, double: false } });
    return out;
  },
  key: (c) => `${c.desec.group}:${c.echoes ? "e" : ""}${fillKey(c.fill)}`,
  run(c, t, ctx) {
    t.desecrate({
      bone: ctx.bone!,
      side: c.desec.side,
      abyss: true,
      echoes: c.echoes,
      want: wantsFor([c.desec]),
    });
    directedFill(t, ctx.targets, c.fill);
  },
  describe: (c, ctx) => [START_STEP(ctx), desecrateStep(ctx, c.desec, c.echoes), ...fillSteps(ctx, c.fill)],
  options: (c, ctx) => [
    `desecrate for ${label(ctx, c.desec.group)}`,
    c.echoes ? "Abyssal Echoes (5 options)" : "3 reveal options",
    ...fillOptionsLabels(c.fill),
  ],
  pros: () => ["You choose the mod from the reveal instead of rolling it."],
  cons: () => ["One desecrated mod per item; a bad reveal still takes the slot."],
});

interface EssChoice {
  essence: EssenceOption;
  fill: FillOptions;
}

export const finishEssence = defineTechnique<EssChoice>({
  id: "finish-essence",
  name: "Finish with a Perfect Essence",
  summary: "Perfect Essence removes a random mod and adds a missing target, then directed Exalts.",
  modes: ["finish"],
  applies(ctx) {
    const miss = new Set(missing(ctx).map((t) => t.group));
    if (!ctx.essences.some((e) => e.perfect && miss.has(e.group)))
      return no("No Perfect Essence adds a missing target");
    if (ctx.start?.mods.some((m) => m.crafted)) return no("Item already has a crafted mod");
    return OK;
  },
  choices(ctx) {
    const miss = new Set(missing(ctx).map((t) => t.group));
    const out: EssChoice[] = [];
    for (const essence of ctx.essences.filter((e) => e.perfect && miss.has(e.group)))
      for (const cleanup of [true, false])
        out.push({ essence, fill: { exaltTier: 0, cleanup, double: false } });
    return out;
  },
  key: (c) => `${c.essence.apiId}:${fillKey(c.fill)}`,
  run(c, t, ctx) {
    t.essence(c.essence);
    directedFill(t, ctx.targets, c.fill);
  },
  describe: (c, ctx) => [
    START_STEP(ctx),
    {
      title: `${c.essence.name} for ${label(ctx, c.essence.group)}`,
      detail: "Removes a random non-fractured mod (it can hit a mod you want) and adds the essence mod.",
      currency: c.essence.name,
    },
    ...fillSteps(ctx, c.fill),
  ],
  options: (c) => [c.essence.name, ...fillOptionsLabels(c.fill)],
  pros: () => ["Guaranteed mod without a free slot."],
  cons: () => ["The removed mod is random."],
});