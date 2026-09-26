import { directedFill, type FillOptions } from "../engine/fill";
import { OK, allRollable, fillKey, fillOptionsLabels, fillSteps, label, no, orbTiers } from "./helpers";
import { defineTechnique, type AlloyOption } from "./types";

interface Choice {
  alloy: AlloyOption;
  fill: FillOptions;
}

export const alloyExalt = defineTechnique<Choice>({
  id: "alloy-exalt",
  name: "Alloy + directed Exalts",
  summary: "Rare base, an Alloy for its guaranteed mod, then directed Exalts for the rest.",
  modes: ["craft"],
  applies(ctx) {
    const r = allRollable(ctx);
    if (!r.ok) return r;
    return ctx.alloys.length ? OK : no("No Alloy guarantees a target");
  },
  choices(ctx) {
    const out: Choice[] = [];
    for (const alloy of ctx.alloys)
      for (const exaltTier of orbTiers(ctx, "exalt"))
        for (const cleanup of [true, false])
          out.push({ alloy, fill: { exaltTier, cleanup, double: false } });
    return out;
  },
  key: (c) => `${c.alloy.apiId}:${fillKey(c.fill)}`,
  run(c, t, ctx) {
    t.transmute();
    t.augment();
    t.regal();
    t.alloy(c.alloy);
    directedFill(t, ctx.targets, c.fill);
  },
  describe: (c, ctx) => [
    {
      title: "Transmute, Augment, Regal",
      detail: `Rare ${ctx.baseName} with 3 mods.`,
      currency: ctx.prices.name("regal"),
    },
    {
      title: `${c.alloy.name} for ${label(ctx, c.alloy.group)}`,
      detail: "Removes a random mod and adds the Alloy's fixed mod (0.5: one crafted mod per item).",
      currency: c.alloy.name,
    },
    ...fillSteps(ctx, c.fill),
  ],
  options: (c) => [c.alloy.name, ...fillOptionsLabels(c.fill)],
  pros: () => ["Deterministic mod early, before the expensive slams."],
  cons: () => ["Alloys are league currency and rarely listed."],
});
