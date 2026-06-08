/**
 * Descriptive modifier tags we surface in the UI, with colour styling. These
 * are the build-relevant tags (we skip granular internals like
 * "fire_resistance" when "fire" + "resistance" already convey it).
 */
export const TAG_STYLES: Record<string, string> = {
  life: "bg-rose-900/50 text-rose-200",
  mana: "bg-sky-900/50 text-sky-200",
  fire: "bg-orange-900/50 text-orange-200",
  cold: "bg-cyan-900/50 text-cyan-200",
  lightning: "bg-yellow-900/50 text-yellow-200",
  chaos: "bg-fuchsia-900/50 text-fuchsia-200",
  physical: "bg-zinc-700/60 text-zinc-200",
  elemental: "bg-teal-900/50 text-teal-200",
  resistance: "bg-emerald-900/50 text-emerald-200",
  attack: "bg-red-900/50 text-red-200",
  caster: "bg-indigo-900/50 text-indigo-200",
  minion: "bg-lime-900/50 text-lime-200",
  speed: "bg-green-900/50 text-green-200",
  critical: "bg-amber-900/50 text-amber-200",
  defences: "bg-slate-700/60 text-slate-200",
  ailment: "bg-purple-900/50 text-purple-200",
  attribute: "bg-stone-700/60 text-stone-200",
};

export const NOTABLE_TAGS = Object.keys(TAG_STYLES);

const NOTABLE_SET = new Set(NOTABLE_TAGS);

/** Filters a mod's implicit tags down to the notable, displayable subset. */
export function notableTags(tags: string[]): string[] {
  return tags.filter((t) => NOTABLE_SET.has(t));
}

export function tagStyle(tag: string): string {
  return TAG_STYLES[tag] ?? "bg-forge-bg/60 text-forge-gold/70";
}
