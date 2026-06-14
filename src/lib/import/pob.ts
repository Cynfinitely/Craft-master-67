import "server-only";
import { getEligibleMods, getModPool, searchBases } from "@/lib/data/queries";
import { cleanModText, modLabel } from "@/lib/data/format";
import type { EligibleMod } from "@/lib/data/types";
import { normalizeStatLine } from "./parseItem";
import {
  decodePobCode,
  extractPobItems,
  parsePobItemText,
} from "./pobParse";

/**
 * Resolves PoB2 build items (rare gear) against the local game data: base
 * type + explicit-mod groups. The output feeds the meta-demand store — which
 * bases and explicit combos ladder builds actually wear.
 */

export interface ResolvedMetaItem {
  itemClass: string;
  baseId: string;
  baseName: string;
  itemLevel: number;
  groups: string[];
  labels: string[];
  /** Explicit lines we could not map to a mod group. */
  unmatched: string[];
}

function stripBasePrefixes(line: string): string {
  return line.replace(/^\s*(Runeforged|Superior)\s+/i, "").trim();
}

async function matchBase(
  baseLine: string,
): Promise<{ id: string; name: string } | null> {
  const target = stripBasePrefixes(baseLine).toLowerCase();
  if (!target) return null;
  // Exact-ish name search first, then longest-contained-name fallback.
  const direct = await searchBases({ q: stripBasePrefixes(baseLine), limit: 10 });
  for (const b of direct) {
    if (b.name.toLowerCase() === target) return { id: b.id, name: b.name };
  }
  const candidates = await searchBases({ limit: 3000 });
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

/** Canonical mod-line key: normalized template with the spacing around
 * value placeholders collapsed ("+(41-45)%" and "+42%" both yield "#%"). */
function modLineKey(line: string): string {
  return normalizeStatLine(line).replace(/\s*#\s*/g, "#");
}

/** Resolves ONE PoB item text block (rare items only). */
export async function resolvePobItem(
  text: string,
): Promise<ResolvedMetaItem | null> {
  const parsed = parsePobItemText(text);
  if (parsed.rarity !== "RARE" || !parsed.baseLine) return null;

  const base = await matchBase(parsed.baseLine);
  if (!base) return null;
  const itemLevel = parsed.itemLevel ?? 82;

  const pool = await getModPool(base.id, Math.max(itemLevel, 82));
  if (!pool) return null;
  const desecMods = await getEligibleMods(pool.base.tags, Math.max(itemLevel, 82), {
    domains: ["desecrated"],
  });

  // Highest-tier-first so a rolled line maps to its group regardless of tier.
  const byNormText = new Map<string, EligibleMod>();
  const all = [...pool.prefixes, ...pool.suffixes, ...desecMods].sort(
    (a, b) => a.requiredLevel - b.requiredLevel,
  );
  for (const m of all) {
    const norm = modLineKey(cleanModText(m.text));
    if (norm) byNormText.set(norm, m);
  }

  const groups: string[] = [];
  const labels: string[] = [];
  const unmatched: string[] = [];
  for (const line of parsed.explicitLines) {
    const hit = byNormText.get(modLineKey(line)) ?? null;
    if (!hit) {
      unmatched.push(line);
      continue;
    }
    const group = hit.groups[0] ?? hit.id;
    if (groups.includes(group)) continue;
    groups.push(group);
    labels.push(modLabel(hit));
  }
  if (groups.length === 0) return null;

  return {
    itemClass: pool.base.itemClass,
    baseId: base.id,
    baseName: base.name,
    itemLevel,
    groups,
    labels,
    unmatched,
  };
}

export interface PobImportResult {
  items: ResolvedMetaItem[];
  /** Item blocks found in the input (resolved or not). */
  totalBlocks: number;
  warnings: string[];
}

/**
 * Imports gear from a pasted PoB2 build code (or raw PoB item text blocks):
 * decodes, extracts items, resolves each rare to base + mod groups.
 */
export async function importPobText(raw: string): Promise<PobImportResult> {
  const warnings: string[] = [];
  let blocks: string[];

  const xml = decodePobCode(raw);
  if (xml) {
    blocks = extractPobItems(xml);
    if (blocks.length === 0) {
      warnings.push("The PoB code decoded but contained no items.");
    }
  } else if (/Rarity:/i.test(raw)) {
    // Raw item text — split on blank lines between "Rarity:" headers.
    blocks = raw
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => /Rarity:/i.test(b));
  } else {
    return {
      items: [],
      totalBlocks: 0,
      warnings: [
        "Input is neither a PoB build code nor item text (expected a base64 code or blocks starting with \"Rarity:\").",
      ],
    };
  }

  const items: ResolvedMetaItem[] = [];
  let skippedNonRare = 0;
  for (const block of blocks) {
    try {
      const resolved = await resolvePobItem(block);
      if (resolved) {
        items.push(resolved);
        if (resolved.unmatched.length > 0) {
          warnings.push(
            `${resolved.baseName}: ${resolved.unmatched.length} mod line(s) didn't map (${resolved.unmatched
              .slice(0, 2)
              .join("; ")}${resolved.unmatched.length > 2 ? "; …" : ""}).`,
          );
        }
      } else {
        skippedNonRare++;
      }
    } catch {
      skippedNonRare++;
    }
  }
  if (skippedNonRare > 0) {
    warnings.push(
      `${skippedNonRare} item(s) skipped (uniques, magic items, flasks/jewels outside the crafting pool, or unknown bases).`,
    );
  }
  return { items, totalBlocks: blocks.length, warnings };
}
