import type { Trial } from "../engine/actions";
import { label } from "./helpers";
import type { CraftContext, EssenceOption, StepDraft } from "./types";

/** Opens a fresh base with an essence: Transmute → essence, or a Rare → Perfect essence. */
export function openWithEssence(t: Trial, e: EssenceOption): void {
  if (e.perfect) {
    t.transmute();
    t.augment();
    t.regal();
  } else {
    t.transmute();
  }
  t.essence(e);
}

export function essenceOpenSteps(ctx: CraftContext, e: EssenceOption): StepDraft[] {
  const mod = label(ctx, e.group);
  if (e.perfect) {
    return [
      {
        title: "Transmute, Augment, Regal",
        detail: `Rare ${ctx.baseName} with 3 mods.`,
        currency: ctx.prices.name("regal"),
      },
      {
        title: `${e.name} for ${mod}`,
        detail: `Removes a random mod and adds ${mod} (0.5: one crafted mod per item).`,
        currency: e.name,
      },
    ];
  }
  return [
    {
      title: "Transmute",
      detail: `Orb of Transmutation on a white ${ctx.baseName}.`,
      currency: ctx.prices.name("transmute"),
    },
    {
      title: `${e.name} for ${mod}`,
      detail: `Upgrades the Magic item to Rare and guarantees ${mod} (0.5: one crafted mod per item).`,
      currency: e.name,
    },
  ];
}

/** Up to `n` essence options per distinct target group, cheapest first. */
export function essenceChoices(ctx: CraftContext, n = 2): EssenceOption[] {
  const byGroup = new Map<string, EssenceOption[]>();
  for (const e of ctx.essences) {
    const arr = byGroup.get(e.group) ?? [];
    arr.push(e);
    byGroup.set(e.group, arr);
  }
  const out: EssenceOption[] = [];
  for (const arr of byGroup.values()) {
    arr.sort((a, b) => ctx.prices.price(a.apiId) - ctx.prices.price(b.apiId));
    out.push(...arr.slice(0, n));
  }
  return out;
}
