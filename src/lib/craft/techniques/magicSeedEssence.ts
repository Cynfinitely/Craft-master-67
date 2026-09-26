import { directedFill, type FillOptions } from "../engine/fill";
import { targetSatisfied } from "../engine/state";
import type { Target } from "../types";
import {
  OK,
  TIER_LABEL,
  allRollable,
  fillKey,
  fillOptionsLabels,
  fillSteps,
  label,
  no,
  orbName,
  orbTiers,
  required,
} from "./helpers";
import type { OrbTier } from "../engine/actions";
import { essenceChoices } from "./essenceOpen";
import { defineTechnique, type EssenceOption } from "./types";

interface Choice {
  seed: Target;
  seedTier: OrbTier;
  essence: EssenceOption;
  fill: FillOptions;
}

export const magicSeedEssence = defineTechnique<Choice>({
  id: "magic-seed-essence",
  name: "Magic seed → Essence → directed Exalts",
  summary:
    "Transmute + Augment until the Magic item has a key target, then an essence makes it Rare with a second guaranteed mod.",
  modes: ["craft"],
  applies(ctx) {
    const r = allRollable(ctx);
    if (!r.ok) return r;
    if (!ctx.essences.some((e) => !e.perfect)) return no("No regular essence guarantees a target");
    if (required(ctx).length < 2) return no("Needs two or more targets");
    return OK;
  },
  choices(ctx) {
    const out: Choice[] = [];
    for (const essence of essenceChoices(ctx, 1).filter((e) => !e.perfect))
      for (const seed of required(ctx)) {
        if (seed.group === essence.group) continue;
        for (const seedTier of orbTiers(ctx, "transmute"))
          for (const cleanup of [true, false])
            out.push({ seed, seedTier, essence, fill: { exaltTier: 0, cleanup, double: true } });
      }
    return out;
  },
  key: (c) => `${c.seed.group}:t${c.seedTier}:${c.essence.apiId}:${fillKey(c.fill)}`,
  run(c, t, ctx) {
    t.transmute(c.seedTier);
    if (!targetSatisfied(t.item, c.seed)) t.augment(c.seedTier);
    if (!targetSatisfied(t.item, c.seed)) return;
    t.essence(c.essence);
    directedFill(t, ctx.targets, c.fill);
  },
  describe: (c, ctx) => [
    {
      title: `${TIER_LABEL[c.seedTier]} Transmute + Augment for ${label(ctx, c.seed.group)}`,
      detail: `${orbName(ctx, "transmute", c.seedTier)} then ${orbName(ctx, "augment", c.seedTier)} on a white ${ctx.baseName}. No ${label(ctx, c.seed.group)}? Use the next base.`,
      currency: orbName(ctx, "transmute", c.seedTier),
    },
    {
      title: `${c.essence.name} for ${label(ctx, c.essence.group)}`,
      detail: "Upgrades the Magic item to Rare and guarantees the essence mod.",
      currency: c.essence.name,
    },
    ...fillSteps(ctx, c.fill),
  ],
  options: (c, ctx) => [
    `seed ${label(ctx, c.seed.group)}`,
    `${TIER_LABEL[c.seedTier]} Transmute/Augment`,
    c.essence.name,
    ...fillOptionsLabels(c.fill),
  ],
  pros: () => ["Cheap seeding: misses only cost a Transmute and an Augment."],
  cons: () => ["Throws away many Magic bases."],
});
