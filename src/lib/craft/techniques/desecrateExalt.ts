import { directedFill, type FillOptions } from "../engine/fill";
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
  wantsFor,
} from "./helpers";
import { desecrateStep } from "./desecrateStep";
import { defineTechnique } from "./types";

interface Choice {
  desec: Target;
  echoes: boolean;
  fill: FillOptions;
}

export const desecrateExalt = defineTechnique<Choice>({
  id: "desecrate-exalt",
  name: "Desecrate + directed Exalts",
  summary: "Magic ladder to Rare, desecrate one target at the Well of Souls, then directed Exalts.",
  modes: ["craft"],
  applies(ctx) {
    return desecratableTargets(ctx).length ? OK : no("No target can be desecrated on this class");
  },
  choices(ctx) {
    const out: Choice[] = [];
    for (const desec of desecratableTargets(ctx))
      for (const echoes of [false, true])
        for (const exaltTier of orbTiers(ctx, "exalt"))
          for (const cleanup of [true, false])
            out.push({ desec, echoes, fill: { exaltTier, cleanup, double: false } });
    return out;
  },
  key: (c) => `${c.desec.group}:${c.echoes ? "e" : ""}${fillKey(c.fill)}`,
  run(c, t, ctx) {
    t.transmute();
    t.augment();
    t.regal();
    t.desecrate({
      bone: ctx.bone!,
      side: c.desec.side,
      abyss: true,
      echoes: c.echoes,
      want: wantsFor([c.desec]),
    });
    directedFill(t, ctx.targets, c.fill);
  },
  describe: (c, ctx) => [
    {
      title: "Transmute, Augment, Regal",
      detail: `Rare ${ctx.baseName} with 3 mods.`,
      currency: ctx.prices.name("regal"),
    },
    desecrateStep(ctx, c.desec, c.echoes),
    ...fillSteps(ctx, c.fill),
  ],
  options: (c, ctx) => [
    `desecrate for ${label(ctx, c.desec.group)}`,
    c.echoes ? "Abyssal Echoes (5 options)" : "3 reveal options",
    ...fillOptionsLabels(c.fill),
  ],
  pros: () => ["Reaches desecrated-only mods; you pick from the reveal."],
  cons: () => ["A reveal without the target still takes the slot (one desecrated mod per item)."],
});
