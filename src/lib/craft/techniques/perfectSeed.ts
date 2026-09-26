import { ORB_MIN_LEVEL, type OrbTier } from "../engine/actions";
import { directedFill, type FillOptions } from "../engine/fill";
import {
  OK,
  TIER_LABEL,
  allRollable,
  fillKey,
  fillOptionsLabels,
  fillSteps,
  maxMinLevel,
  no,
  orbName,
  orbTiers,
  product,
} from "./helpers";
import { defineTechnique } from "./types";

interface Choice {
  seedTier: OrbTier;
  fill: FillOptions;
}

export const perfectSeed = defineTechnique<Choice>({
  id: "perfect-seed",
  name: "Greater/Perfect seed + directed Exalts",
  summary:
    "Greater or Perfect Transmute, Augment and Regal so the first three mods are high tier, then omen-directed Exalts.",
  modes: ["craft"],
  applies(ctx) {
    const r = allRollable(ctx);
    if (!r.ok) return r;
    if (maxMinLevel(ctx) < ORB_MIN_LEVEL.regal[1]) return no("No high-tier target to seed");
    return OK;
  },
  choices(ctx) {
    const seeds = orbTiers(ctx, "regal").filter((t) => t > 0);
    return product<{ seedTier: OrbTier; exaltTier: OrbTier; cleanup: boolean }>({
      seedTier: seeds,
      exaltTier: orbTiers(ctx, "exalt"),
      cleanup: [true, false],
    }).map(({ seedTier, exaltTier, cleanup }) => ({
      seedTier,
      fill: { exaltTier, cleanup, double: false },
    }));
  },
  key: (c) => `s${c.seedTier}${fillKey(c.fill)}`,
  run(c, t, ctx) {
    t.transmute(c.seedTier);
    t.augment(c.seedTier);
    t.regal(c.seedTier);
    directedFill(t, ctx.targets, c.fill);
  },
  describe(c, ctx) {
    const tier = TIER_LABEL[c.seedTier];
    return [
      {
        title: `${tier} Transmute, Augment, Regal`,
        detail:
          `${orbName(ctx, "transmute", c.seedTier)} and ${orbName(ctx, "augment", c.seedTier)} only add modifiers of level ` +
          `${ORB_MIN_LEVEL.transmute[c.seedTier]}+ / ${ORB_MIN_LEVEL.augment[c.seedTier]}+, and ${orbName(ctx, "regal", c.seedTier)} ${ORB_MIN_LEVEL.regal[c.seedTier]}+.`,
        currency: orbName(ctx, "regal", c.seedTier),
      },
      ...fillSteps(ctx, c.fill),
    ];
  },
  options: (c) => [`${TIER_LABEL[c.seedTier]} seed orbs`, ...fillOptionsLabels(c.fill)],
  pros: () => ["The first three mods skip every low tier."],
  cons: () => ["Greater/Perfect orbs are expensive."],
});
