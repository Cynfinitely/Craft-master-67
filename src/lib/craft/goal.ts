import type { CurrentMod, Side } from "./types";

/**
 * URL / saved-plan encoding of a goal entry:
 *   Group              any tier
 *   Group@60           tier with modifier level >= 60
 *   Group@60~d         desecrated-only
 *   Group@60~o         optional (nice to have)
 * Flags combine (`Group~d~o`). Older plans only used `@level` and `~d`.
 */
export interface GoalEntry {
  group: string;
  minLevel: number;
  desecrated: boolean;
  optional: boolean;
}

export function parseGoalEntry(raw: string): GoalEntry {
  const parts = raw.split("~");
  const head = parts[0];
  const flags = new Set(parts.slice(1));
  const at = head.indexOf("@");
  const group = at >= 0 ? head.slice(0, at) : head;
  const minLevel = at >= 0 ? Number.parseInt(head.slice(at + 1), 10) || 0 : 0;
  return {
    group,
    minLevel,
    desecrated: flags.has("d"),
    optional: flags.has("o"),
  };
}

export function formatGoalEntry(e: GoalEntry): string {
  let s = e.minLevel > 0 ? `${e.group}@${e.minLevel}` : e.group;
  if (e.desecrated) s += "~d";
  if (e.optional) s += "~o";
  return s;
}

export function parseGoalList(raw: string | undefined | null): GoalEntry[] {
  const seen = new Set<string>();
  const out: GoalEntry[] = [];
  for (const piece of (raw ?? "").split(",")) {
    if (!piece) continue;
    const e = parseGoalEntry(piece);
    if (!e.group || seen.has(e.group)) continue;
    seen.add(e.group);
    out.push(e);
  }
  return out;
}

/**
 * Current-mod encoding for finish mode: `Group@level:p|s` plus `~f`
 * (fractured) and `~d` (desecrated), comma separated.
 */
export function formatCurrentMods(mods: CurrentMod[]): string {
  return mods
    .map((m) => {
      let s = `${m.group}@${m.level}:${m.side === "prefix" ? "p" : "s"}`;
      if (m.fractured) s += "~f";
      if (m.desecrated) s += "~d";
      return s;
    })
    .join(",");
}

export function parseCurrentMods(raw: string | undefined | null): CurrentMod[] {
  const out: CurrentMod[] = [];
  for (const piece of (raw ?? "").split(",")) {
    if (!piece) continue;
    const [head, ...flags] = piece.split("~");
    const m = /^(.+?)@(\d+):(p|s)$/.exec(head);
    if (!m) continue;
    const side: Side = m[3] === "p" ? "prefix" : "suffix";
    out.push({
      group: m[1],
      level: Number.parseInt(m[2], 10) || 0,
      side,
      fractured: flags.includes("f") || undefined,
      desecrated: flags.includes("d") || undefined,
    });
  }
  return out;
}
