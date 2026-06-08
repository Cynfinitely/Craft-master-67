/**
 * Parses the text produced by Path of Exile 2's in-game "Copy Item" (Ctrl+C).
 * Pure string handling only (no DB access) so it can run anywhere.
 *
 * The clipboard format is a series of blocks separated by dashed lines, e.g.:
 *
 *   Item Class: Boots
 *   Rarity: Rare
 *   Pandemonium Span
 *   Runeforged Cinched Boots
 *   --------
 *   Quality: +20% (augmented)
 *   Runic Ward: 50 (augmented)
 *   --------
 *   Item Level: 82
 *   --------
 *   { Prefix Modifier "Phantasm's" (Tier: 3) — Evasion }
 *   72(68-79)% increased Evasion Rating
 *   { Suffix Modifier "of Granite Skin" (Tier: 6) }
 *   +115(98-124) to Stun Threshold
 *   { Desecrated Suffix Modifier "of Flexure" (Tier: 1) — Evasion }
 *   Gain Deflection Rating equal to 21(21-23)% of Evasion Rating
 */

export interface ParsedMod {
  kind: "prefix" | "suffix";
  /** True for desecrated (Well of Souls) modifiers. */
  desecrated: boolean;
  /** Affix name, e.g. "Phantasm's" or "of Granite Skin". */
  name: string | null;
  /** Tier number shown in the clipboard, e.g. 3. */
  tier: number | null;
  /** Descriptive tags after the em dash, lower-cased (e.g. ["evasion"]). */
  tags: string[];
  /** Raw rolled stat line(s) for the modifier. */
  statLines: string[];
}

export interface ParsedItem {
  itemClass: string | null;
  rarity: string | null;
  /** Flavor/rare name line (not the base type). */
  nameLine: string | null;
  /** Base type line, e.g. "Runeforged Cinched Boots". */
  baseTypeLine: string | null;
  itemLevel: number | null;
  quality: number | null;
  /** Runic Ward value (0.5 Verisium runeforging), if present. */
  runicWard: number | null;
  /** Lines added by socketed runes (suffixed "(rune)"). */
  runeLines: string[];
  mods: ParsedMod[];
}

const DASH_LINE = /^[-—\s]{3,}$/;
const MOD_ANCHOR =
  /^\{\s*(Desecrated\s+)?(Prefix|Suffix)\s+Modifier\b(?:\s+"([^"]+)")?(?:\s*\(Tier:\s*(\d+)\))?(?:\s*[—–-]\s*(.+?))?\s*\}$/i;

function num(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : null;
}

/** Returns true for property/metadata lines we don't treat as mod stats. */
function isMetaLine(line: string): boolean {
  return (
    /^(Item Class|Rarity|Quality|Sockets|Requires|Item Level|Level|Stack Size|Corrupted|Unidentified|Note):/i.test(
      line,
    ) ||
    /\((augmented|implicit|rune|enchant|crafted|fractured)\)\s*$/i.test(line) ||
    /^(Armour|Evasion Rating|Energy Shield|Runic Ward|Block chance|Spirit|Physical Damage|Critical|Attacks per Second|Elemental Damage|Reload Time):/i.test(
      line,
    )
  );
}

export function parseItem(raw: string): ParsedItem {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim());

  const item: ParsedItem = {
    itemClass: null,
    rarity: null,
    nameLine: null,
    baseTypeLine: null,
    itemLevel: null,
    quality: null,
    runicWard: null,
    runeLines: [],
    mods: [],
  };

  // First pass: header fields, item level, properties, rune lines.
  const headerNames: string[] = [];
  let inHeader = true;
  let seenAnchor = false;

  for (const line of lines) {
    if (!line) continue;
    if (DASH_LINE.test(line)) {
      inHeader = false;
      continue;
    }

    const ic = line.match(/^Item Class:\s*(.+)$/i);
    if (ic) {
      item.itemClass = ic[1].trim();
      continue;
    }
    const rar = line.match(/^Rarity:\s*(.+)$/i);
    if (rar) {
      item.rarity = rar[1].trim();
      continue;
    }
    const il = line.match(/^Item Level:\s*(\d+)/i);
    if (il) {
      item.itemLevel = Number.parseInt(il[1], 10);
      continue;
    }
    const ql = line.match(/^Quality:\s*\+?(\d+)/i);
    if (ql) {
      item.quality = Number.parseInt(ql[1], 10);
      continue;
    }
    const rw = line.match(/^Runic Ward:\s*(\d+)/i);
    if (rw) {
      item.runicWard = Number.parseInt(rw[1], 10);
      continue;
    }
    if (/\(rune\)\s*$/i.test(line)) {
      item.runeLines.push(line.replace(/\s*\(rune\)\s*$/i, "").trim());
      continue;
    }

    if (MOD_ANCHOR.test(line)) seenAnchor = true;

    // Header name lines: non key:value lines before any mod/section content.
    if (inHeader && !seenAnchor && !isMetaLine(line) && !item.itemLevel) {
      headerNames.push(line);
    }
  }

  if (headerNames.length === 1) {
    item.baseTypeLine = headerNames[0];
  } else if (headerNames.length >= 2) {
    item.nameLine = headerNames.slice(0, -1).join(" ");
    item.baseTypeLine = headerNames[headerNames.length - 1];
  }

  // Second pass: modifiers. Anchors start a mod; following non-meta, non-dash
  // lines are its stat line(s) until the next anchor.
  let current: ParsedMod | null = null;
  for (const line of lines) {
    if (!line || DASH_LINE.test(line)) continue;
    const m = line.match(MOD_ANCHOR);
    if (m) {
      const tags = (m[5] ?? "")
        .split(/[,/]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      current = {
        kind: m[2].toLowerCase() === "prefix" ? "prefix" : "suffix",
        desecrated: Boolean(m[1]),
        name: m[3] ?? null,
        tier: m[4] ? Number.parseInt(m[4], 10) : null,
        tags,
        statLines: [],
      };
      item.mods.push(current);
      continue;
    }
    if (current && !isMetaLine(line)) {
      current.statLines.push(line);
    }
  }

  return item;
}

/**
 * Reduces a rolled stat line to a comparable template by removing the rolled
 * value and its range, e.g. "72(68-79)% increased Evasion Rating" ->
 * "% increased evasion rating". Used to disambiguate same-named affixes.
 */
export function normalizeStatLine(line: string): string {
  return line
    .toLowerCase()
    .replace(/\d+(\.\d+)?\s*\(\s*-?\d+(\.\d+)?\s*-\s*-?\d+(\.\d+)?\s*\)/g, "#")
    .replace(/[+\-]?\d+(\.\d+)?/g, "#")
    .replace(/#+/g, "#")
    .replace(/[^a-z#% ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export { num as parseLeadingNumber };
