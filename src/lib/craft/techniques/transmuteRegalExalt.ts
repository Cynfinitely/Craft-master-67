import type { OrbTier } from "../engine/actions";
import { slamToFull } from "../engine/fill";
import { TIER_LABEL, allRollable, orbName, orbTiers, targetList } from "./helpers";
import { defineTechnique } from "./types";

interface Choice {
  exaltTier: OrbTier;
}

export const transmuteRegalExalt = defineTechnique<Choice>({
  id: "transmute-regal-exalt",
  name: "Transmute → Regal → blind Exalts",
  summary: "Magic ladder to Rare, then Exalt slams to 6 mods without omens.",
  modes: ["craft"],
  applies: allRollable,
  choices: (ctx) => orbTiers(ctx, "exalt").map((exaltTier) => ({ exaltTier })),
  key: (c) => `x${c.exaltTier}`,
  run(c, t) {
    t.transmute();
    t.augment();
    t.regal();
    slamToFull(t, c.exaltTier);
  },
  describe(c, ctx) {
    const exalt = orbName(ctx, "exalt", c.exaltTier);
    return [
      {
        title: "Transmute, Augment, Regal",
        detail: `Orb of Transmutation and Augmentation on a white ${ctx.baseName}, then a Regal Orb: Rare with 3 mods.`,
        currency: ctx.prices.name("regal"),
      },
      {
        title: `${exalt} to 6 mods`,
        detail: `Slam until full. Keep it if it has ${targetList(ctx)}; otherwise start over.`,
        currency: exalt,
      },
    ];
  },
  options: (c) => [`${TIER_LABEL[c.exaltTier]} Exalts`],
  pros: () => ["No omens needed."],
  cons: () => ["Every slam can land on either side; poor odds for 3+ targets."],
});
