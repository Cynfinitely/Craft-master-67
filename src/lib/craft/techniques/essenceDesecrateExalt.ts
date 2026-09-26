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
import { essenceChoices, essenceOpenSteps, openWithEssence } from "./essenceOpen";
import { desecrateStep } from "./desecrateStep";
import { defineTechnique, type EssenceOption } from "./types";

interface Choice {
  essence: EssenceOption;
  desec: Target;
  echoes: boolean;
  fill: FillOptions;
}

export const essenceDesecrateExalt = defineTechnique<Choice>({
  id: "essence-desecrate-exalt",
  name: "Essence → Desecrate → directed Exalts",
  summary:
    "Essence-lock one mod, desecrate a second at the Well of Souls, then directed Exalts (with a Greater Exaltation double-slam) for the rest.",
  modes: ["craft"],
  applies(ctx) {
    if (!ctx.essences.length) return no("No essence guarantees a target at its tier");
    if (!desecratableTargets(ctx).length) return no("No target can be desecrated on this class");
    return OK;
  },
  choices(ctx) {
    const out: Choice[] = [];
    for (const essence of essenceChoices(ctx, 1))
      for (const desec of desecratableTargets(ctx)) {
        if (desec.group === essence.group) continue;
        for (const echoes of [false, true])
          for (const cleanup of [true, false])
            for (const exaltTier of orbTiers(ctx, "exalt"))
              out.push({ essence, desec, echoes, fill: { exaltTier, cleanup, double: true } });
      }
    return out;
  },
  key: (c) => `${c.essence.apiId}:${c.desec.group}:${c.echoes ? "e" : ""}${fillKey(c.fill)}`,
  run(c, t, ctx) {
    openWithEssence(t, c.essence);
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
    ...essenceOpenSteps(ctx, c.essence),
    desecrateStep(ctx, c.desec, c.echoes),
    ...fillSteps(ctx, c.fill),
  ],
  options: (c, ctx) => [
    c.essence.name,
    `desecrate for ${label(ctx, c.desec.group)}`,
    c.echoes ? "Abyssal Echoes (5 options)" : "3 reveal options",
    ...fillOptionsLabels(c.fill),
  ],
  pros: () => ["Two mods are chosen, not rolled."],
  cons: () => ["Bones and Necromancy omens are pricey; a bad reveal still fills the slot."],
});
