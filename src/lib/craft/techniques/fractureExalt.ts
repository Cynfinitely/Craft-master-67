import { directedFill, type FillOptions } from "../engine/fill";
import { isNeeded, targetSatisfied } from "../engine/state";
import type { Target } from "../types";
import {
  OK,
  allRollable,
  fillKey,
  fillOptionsLabels,
  fillSteps,
  label,
  no,
  orbTiers,
  required,
} from "./helpers";
import { defineTechnique } from "./types";

interface Choice {
  key: Target;
  fill: FillOptions;
}

export const fractureExalt = defineTechnique<Choice>({
  id: "fracture-exalt",
  name: "Alchemy → Fracture → directed Exalts",
  summary:
    "Alchemy until the key mod lands, Fracture to lock it (random pick of the mods), annul the rest, then directed Exalts.",
  modes: ["craft"],
  applies(ctx) {
    const r = allRollable(ctx);
    if (!r.ok) return r;
    return required(ctx).length >= 2 ? OK : no("Fracturing only pays off with 2+ targets");
  },
  choices(ctx) {
    const out: Choice[] = [];
    for (const key of required(ctx).slice(0, 3))
      for (const exaltTier of orbTiers(ctx, "exalt"))
        for (const cleanup of [true, false])
          out.push({ key, fill: { exaltTier, cleanup, double: false } });
    return out;
  },
  key: (c) => `${c.key.group}:${fillKey(c.fill)}`,
  run(c, t, ctx) {
    t.alchemy();
    if (!targetSatisfied(t.item, c.key)) return;
    t.fracture();
    const locked = t.item.mods.find((m) => m.fractured);
    if (!locked || !isNeeded(locked, ctx.targets)) return;
    directedFill(t, ctx.targets, c.fill);
  },
  describe: (c, ctx) => [
    {
      title: `Alchemy until ${label(ctx, c.key.group)}`,
      detail: `Orb of Alchemy on white ${ctx.baseName}s until one has ${label(ctx, c.key.group)}.`,
      currency: ctx.prices.name("alch"),
    },
    {
      title: "Fracturing Orb",
      detail: "Locks one random mod (of 4). If it locked a target mod, continue; otherwise sell or discard.",
      currency: ctx.prices.name("fracturing-orb"),
    },
    ...fillSteps(ctx, c.fill),
  ],
  options: (c, ctx) => [`fracture ${label(ctx, c.key.group)}`, ...fillOptionsLabels(c.fill)],
  pros: () => ["A fractured mod can't be removed by annul cleanup."],
  cons: () => ["The fracture picks randomly among 4 mods."],
});
