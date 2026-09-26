import type { OrbTier } from "../engine/actions";
import { directedFill, type FillOptions } from "../engine/fill";
import { allRollable, fillKey, fillOptionsLabels, fillSteps, orbTiers, product } from "./helpers";
import { defineTechnique } from "./types";

export const omenExalt = defineTechnique<FillOptions>({
  id: "omen-exalt",
  name: "Omen-directed Exalts",
  summary: "Magic ladder to Rare, then Sinistral/Dextral Exaltation slams per target.",
  modes: ["craft"],
  applies: allRollable,
  choices: (ctx) =>
    product<{ exaltTier: OrbTier; cleanup: boolean; double: boolean }>({
      exaltTier: orbTiers(ctx, "exalt"),
      cleanup: [true, false],
      double: [false, true],
    }),
  key: fillKey,
  run(c, t, ctx) {
    t.transmute();
    t.augment();
    t.regal();
    directedFill(t, ctx.targets, c);
  },
  describe(c, ctx) {
    return [
      {
        title: "Transmute, Augment, Regal",
        detail: `Orb of Transmutation and Augmentation on a white ${ctx.baseName}, then a Regal Orb: Rare with 3 mods.`,
        currency: ctx.prices.name("regal"),
      },
      ...fillSteps(ctx, c),
    ];
  },
  options: (c) => fillOptionsLabels(c),
  pros: () => ["Side omens stop slams from landing on the wrong side."],
  cons: () => ["Omens add up; annul cleanup can remove finished mods."],
});
