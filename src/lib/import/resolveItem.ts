import "server-only";
import { getModPool, searchBases } from "@/lib/data/queries";
import { cleanModText } from "@/lib/data/format";
import type { EligibleMod } from "@/lib/data/types";
import { parseItem, normalizeStatLine, type ParsedMod } from "./parseItem";

export interface ResolvedMod {
  name: string | null;
  kind: "prefix" | "suffix";
  group: string;
  tierLevel: number;
  /** Display value, e.g. "+(98-124) to Stun Threshold". */
  value: string;
  desecrated: boolean;
}

export interface ResolvedItem {
  ok: boolean;
  baseId: string | null;
  baseName: string | null;
  itemClass: string | null;
  itemLevel: number;
  /** Encoded as "Group@<requiredLevel>" for solveFromBase. */
  desiredGroups: string[];
  matched: ResolvedMod[];
  warnings: string[];
  requiresDesecration: boolean;
  requiresRuneforging: boolean;
}

function stripBasePrefixes(line: string): string {
  // 0.5 runeforged bases prepend "Runeforged"; quality words can also appear.
  return line.replace(/^\s*(Runeforged|Superior)\s+/i, "").trim();
}

/** Finds the base whose name is the longest match within the base-type line. */
async function matchBase(
  itemClass: string | null,
  baseTypeLine: string | null,
): Promise<{ id: string; name: string } | null> {
  if (!baseTypeLine) return null;
  const target = stripBasePrefixes(baseTypeLine).toLowerCase();
  const candidates = await searchBases({
    itemClass: itemClass ?? undefined,
    limit: 1000,
  });
  let best: { id: string; name: string } | null = null;
  for (const b of candidates) {
    const n = b.name.toLowerCase();
    if (target === n || target.includes(n)) {
      if (!best || b.name.length > best.name.length) {
        best = { id: b.id, name: b.name };
      }
    }
  }
  return best;
}

function matchMod(
  parsed: ParsedMod,
  pool: EligibleMod[],
): EligibleMod | null {
  const wantName = parsed.name?.trim().toLowerCase() ?? null;
  const wantText = parsed.statLines.length
    ? normalizeStatLine(parsed.statLines.join(" "))
    : null;

  const byName = wantName
    ? pool.filter((m) => (m.name ?? "").trim().toLowerCase() === wantName)
    : [];

  const pickByText = (cands: EligibleMod[]): EligibleMod | null => {
    if (cands.length === 1) return cands[0];
    if (cands.length === 0) return null;
    if (wantText) {
      const exact = cands.find(
        (m) => normalizeStatLine(cleanModText(m.text)) === wantText,
      );
      if (exact) return exact;
    }
    // Fall back to the highest tier (deepest required level).
    return [...cands].sort((a, b) => b.requiredLevel - a.requiredLevel)[0];
  };

  if (byName.length) return pickByText(byName);

  // No name match (e.g. desecrated-only naming): match by normalized text.
  if (wantText) {
    const byText = pool.filter(
      (m) => normalizeStatLine(cleanModText(m.text)) === wantText,
    );
    if (byText.length) return pickByText(byText);
  }
  return null;
}

export async function resolveItem(raw: string): Promise<ResolvedItem> {
  const parsed = parseItem(raw);
  const warnings: string[] = [];
  const itemLevel = parsed.itemLevel ?? 82;

  const base = await matchBase(parsed.itemClass, parsed.baseTypeLine);
  if (!base) {
    return {
      ok: false,
      baseId: null,
      baseName: null,
      itemClass: parsed.itemClass,
      itemLevel,
      desiredGroups: [],
      matched: [],
      warnings: [
        `Could not match a base item from "${parsed.baseTypeLine ?? "?"}"${
          parsed.itemClass ? ` (${parsed.itemClass})` : ""
        }. It may be a new 0.5 base not in the current data snapshot.`,
      ],
      requiresDesecration: parsed.mods.some((m) => m.desecrated),
      requiresRuneforging: parsed.runicWard != null,
    };
  }

  const pool = await getModPool(base.id, itemLevel);
  const prefixes = pool?.prefixes ?? [];
  const suffixes = pool?.suffixes ?? [];

  const matched: ResolvedMod[] = [];
  const seen = new Set<string>();
  let requiresDesecration = false;

  for (const pm of parsed.mods) {
    const poolForKind = pm.kind === "prefix" ? prefixes : suffixes;
    const hit = matchMod(pm, poolForKind);
    if (!hit) {
      warnings.push(
        `Could not match ${pm.desecrated ? "desecrated " : ""}${pm.kind} "${
          pm.name ?? pm.statLines[0] ?? "?"
        }".`,
      );
      if (pm.desecrated) requiresDesecration = true;
      continue;
    }
    const group = hit.groups[0] ?? hit.id;
    if (pm.desecrated) requiresDesecration = true;
    const key = `${group}@${hit.requiredLevel}`;
    if (seen.has(group)) continue; // one target per group
    seen.add(group);
    matched.push({
      name: hit.name,
      kind: pm.kind,
      group,
      tierLevel: hit.requiredLevel,
      value: cleanModText(hit.text) || pm.statLines.join(" "),
      desecrated: pm.desecrated,
    });
  }

  const desiredGroups = matched.map(
    (m) => `${m.group}@${m.tierLevel}${m.desecrated ? "~d" : ""}`,
  );

  if (parsed.runeLines.length) {
    warnings.push(
      `Ignored ${parsed.runeLines.length} rune line(s) — those come from socketed runes, not crafting.`,
    );
  }

  return {
    ok: matched.length > 0,
    baseId: base.id,
    baseName: base.name,
    itemClass: parsed.itemClass,
    itemLevel,
    desiredGroups,
    matched,
    warnings,
    requiresDesecration,
    requiresRuneforging: parsed.runicWard != null,
  };
}
