import { OMEN, necroSideOmen } from "../engine/actions";
import type { Target } from "../types";
import { label } from "./helpers";
import type { CraftContext, StepDraft } from "./types";

export function desecrateStep(ctx: CraftContext, t: Target, echoes: boolean): StepDraft {
  const bone = ctx.prices.name(ctx.bone ?? "ancient-rib");
  const omen = ctx.prices.name(necroSideOmen(t.side));
  const mod = label(ctx, t.group);
  return {
    title: `Desecrate for ${mod}`,
    detail:
      `${bone} with ${omen} adds a hidden ${t.side}` +
      (echoes ? `; with ${ctx.prices.name(OMEN.echoes)} the Well of Souls shows 5 options` : "; the Well of Souls shows 3 options") +
      `. Pick ${mod} if offered. If the ${t.side}es are full, Essence of the Abyss first replaces one of them (0.5: one desecrated mod per item).`,
    currency: bone,
  };
}
