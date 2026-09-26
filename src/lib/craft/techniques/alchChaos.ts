import type { OrbTier } from "../engine/actions";
import { requiredDone } from "../engine/state";
import { OK, TIER_LABEL, allRollable, no, orbName, orbTiers, product, required, targetList } from "./helpers";
import { defineTechnique } from "./types";

interface Choice {
  budget: number;
  tier: OrbTier;
}

export const alchChaos = defineTechnique<Choice>({
  id: "alch-chaos",
  name: "Alchemy + Chaos rerolls",
  summary: "Alchemy each base, then Chaos-reroll up to a budget chasing the targets.",
  modes: ["craft"],
  applies(ctx) {
    const r = allRollable(ctx);
    if (!r.ok) return r;
    if (required(ctx).length > 4) return no("Chaos rerolls keep a 4-mod item");
    return OK;
  },
  choices: (ctx) => product<Choice>({ budget: [5, 10, 25], tier: orbTiers(ctx, "chaos") }),
  key: (c) => `b${c.budget}t${c.tier}`,
  run(c, t, ctx) {
    t.alchemy();
    for (let i = 0; i < c.budget; i++) {
      if (requiredDone(t.item, ctx.targets)) return;
      if (!t.chaos(c.tier)) return;
    }
  },
  describe(c, ctx) {
    const chaos = orbName(ctx, "chaos", c.tier);
    return [
      {
        title: `Alchemy a white ${ctx.baseName}`,
        detail: "Orb of Alchemy: Rare with 4 random mods.",
        currency: ctx.prices.name("alch"),
      },
      {
        title: `Up to ${c.budget} ${chaos} rerolls`,
        detail: `Each ${chaos} removes a random mod and adds a new one. Stop when the item has ${targetList(ctx)}; after ${c.budget} misses, move to a fresh base.`,
        currency: chaos,
      },
    ];
  },
  options: (c) => [`${c.budget} rerolls per base`, `${TIER_LABEL[c.tier]} Chaos`],
  pros: () => ["Simple, uses common currency."],
  cons: () => ["Chaos can remove a mod you already hit."],
});
