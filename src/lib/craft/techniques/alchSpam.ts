import { OK, allRollable, no, required, targetList } from "./helpers";
import { defineTechnique } from "./types";

export const alchSpam = defineTechnique<Record<string, never>>({
  id: "alch-spam",
  name: "Alchemy spam",
  summary: "Orb of Alchemy on white bases (4 random mods) until one lands every target.",
  modes: ["craft"],
  applies(ctx) {
    const r = allRollable(ctx);
    if (!r.ok) return r;
    if (required(ctx).length > 4) return no("Alchemy adds only 4 mods");
    return OK;
  },
  choices: () => [{}],
  key: () => "",
  run(_c, t) {
    t.alchemy();
  },
  describe(_c, ctx) {
    return [
      {
        title: `Alchemy a white ${ctx.baseName}`,
        detail: `Orb of Alchemy makes it Rare with 4 random mods. Keep it if it has ${targetList(ctx)}; otherwise use the next base.`,
        currency: ctx.prices.name("alch"),
      },
    ];
  },
  options: () => [],
  pros: () => ["Cheapest per attempt, no decisions."],
  cons: () => ["Burns a base per attempt; only realistic for 1-2 common targets."],
});
