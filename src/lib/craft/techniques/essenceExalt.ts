import type { OrbTier } from "../engine/actions";
import { directedFill, type FillOptions } from "../engine/fill";
import { OK, allRollable, fillKey, fillOptionsLabels, fillSteps, no, orbTiers } from "./helpers";
import { essenceChoices, essenceOpenSteps, openWithEssence } from "./essenceOpen";
import { defineTechnique, type EssenceOption } from "./types";

interface Choice {
  essence: EssenceOption;
  fill: FillOptions;
}

export const essenceExalt = defineTechnique<Choice>({
  id: "essence-exalt",
  name: "Essence + directed Exalts",
  summary: "Guarantee the hardest mod with an essence, then omen-directed Exalt slams for the rest.",
  modes: ["craft"],
  applies(ctx) {
    const r = allRollable(ctx);
    if (!r.ok) return r;
    return ctx.essences.length ? OK : no("No essence guarantees a target at its tier");
  },
  choices(ctx) {
    const out: Choice[] = [];
    for (const essence of essenceChoices(ctx))
      for (const exaltTier of orbTiers(ctx, "exalt") as OrbTier[])
        for (const cleanup of [true, false])
          out.push({ essence, fill: { exaltTier, cleanup, double: false } });
    return out;
  },
  key: (c) => `${c.essence.apiId}:${fillKey(c.fill)}`,
  run(c, t, ctx) {
    openWithEssence(t, c.essence);
    directedFill(t, ctx.targets, c.fill);
  },
  describe: (c, ctx) => [...essenceOpenSteps(ctx, c.essence), ...fillSteps(ctx, c.fill)],
  options: (c) => [c.essence.name, ...fillOptionsLabels(c.fill)],
  pros: (c, ctx) => [`${ctx.labels.get(c.essence.group) ?? c.essence.group} is guaranteed.`],
  cons: () => ["Uses the item's one crafted-mod slot."],
});
