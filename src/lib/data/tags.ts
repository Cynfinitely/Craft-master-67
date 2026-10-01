/**
 * Descriptive modifier tags we surface in the UI, with colour styling. These
 * are the build-relevant tags (we skip granular internals like
 * "fire_resistance" when "fire" + "resistance" already convey it).
 */
export const TAG_STYLES: Record<string, string> = {
  life: "border-rose-200 bg-rose-100 text-rose-800",
  mana: "border-sky-200 bg-sky-100 text-sky-800",
  fire: "border-orange-200 bg-orange-100 text-orange-800",
  cold: "border-cyan-200 bg-cyan-100 text-cyan-800",
  lightning: "border-yellow-200 bg-yellow-100 text-yellow-800",
  chaos: "border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800",
  physical: "border-zinc-200 bg-zinc-100 text-zinc-800",
  elemental: "border-teal-200 bg-teal-100 text-teal-800",
  resistance: "border-emerald-200 bg-emerald-100 text-emerald-800",
  attack: "border-red-200 bg-red-100 text-red-800",
  caster: "border-indigo-200 bg-indigo-100 text-indigo-800",
  minion: "border-lime-200 bg-lime-100 text-lime-800",
  speed: "border-green-200 bg-green-100 text-green-800",
  critical: "border-amber-200 bg-amber-100 text-amber-800",
  defences: "border-slate-200 bg-slate-100 text-slate-800",
  ailment: "border-purple-200 bg-purple-100 text-purple-800",
  attribute: "border-stone-200 bg-stone-100 text-stone-800",
};

export const NOTABLE_TAGS = Object.keys(TAG_STYLES);

const NOTABLE_SET = new Set(NOTABLE_TAGS);

/** Filters a mod's implicit tags down to the notable, displayable subset. */
export function notableTags(tags: string[]): string[] {
  return tags.filter((t) => NOTABLE_SET.has(t));
}

export function tagStyle(tag: string): string {
  return TAG_STYLES[tag] ?? "border-forge-border bg-forge-panel2 text-forge-muted";
}
