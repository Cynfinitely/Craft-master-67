import { inflateSync } from "node:zlib";

/**
 * Path of Building (PoB2) build-code handling — pure string/buffer work so it
 * can be unit-tested without a database. A PoB code is url-safe base64 over
 * zlib-deflated XML; items are embedded as plain text inside <Item> tags.
 * poe.ninja's "Copy PoB code" produces exactly this format.
 */

/** Decodes a PoB build code into its XML payload (null if not a PoB code). */
export function decodePobCode(code: string): string | null {
  const cleaned = code.trim().replace(/\s+/g, "");
  if (cleaned.length < 40 || !/^[A-Za-z0-9_\-+/=]+$/.test(cleaned)) {
    return null;
  }
  const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const xml = inflateSync(Buffer.from(b64, "base64")).toString("utf8");
    return xml.includes("<PathOfBuilding") || xml.includes("<Item")
      ? xml
      : null;
  } catch {
    return null;
  }
}

/** Extracts the raw item text blocks from PoB XML. */
export function extractPobItems(xml: string): string[] {
  const out: string[] = [];
  // (?:\s[^>]*)?> keeps the container tag <Items> from matching.
  const re = /<Item(?:\s[^>]*)?>([\s\S]*?)<\/Item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const text = m[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .trim();
    if (text) out.push(text);
  }
  return out;
}

export interface PobParsedItem {
  rarity: string | null;
  nameLine: string | null;
  baseLine: string | null;
  itemLevel: number | null;
  /** Rolled explicit mod lines ({...} annotations stripped). */
  explicitLines: string[];
}

/** Lines that are item metadata, never mod text. */
const POB_META =
  /^(Unique ID|Item Level|Quality|Sockets|LevelReq|Level|Implicits|Radius|Limited to|Rune|Crucible|Catalyst|Variant|Selected Variant|League|Source|Talisman Tier|Armour|Evasion|Energy Shield|Ward|Prefix|Suffix|Influence|Requires|Has Alt Variant|Cluster Jewel|Grants Skill):/i;
const POB_FLAG = /^(Corrupted|Mirrored|Split|Fractured Item|Shaper Item|Elder Item)$/i;

/**
 * Parses one PoB item text block. PoB format has no "{ Prefix Modifier }"
 * anchors — explicit mods are bare stat lines after the implicits, possibly
 * prefixed with {tags:...}/{crafted}/{fractured}/{range:...} annotations.
 */
export function parsePobItemText(text: string): PobParsedItem {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const item: PobParsedItem = {
    rarity: null,
    nameLine: null,
    baseLine: null,
    itemLevel: null,
    explicitLines: [],
  };

  const headerNames: string[] = [];
  let implicitsLeft = 0;
  let pastHeader = false;

  for (const raw of lines) {
    const rar = raw.match(/^Rarity:\s*(.+)$/i);
    if (rar) {
      item.rarity = rar[1].trim().toUpperCase();
      continue;
    }
    const il = raw.match(/^Item Level:\s*(\d+)/i);
    if (il) {
      item.itemLevel = Number.parseInt(il[1], 10);
      pastHeader = true;
      continue;
    }
    const imp = raw.match(/^Implicits:\s*(\d+)/i);
    if (imp) {
      implicitsLeft = Number.parseInt(imp[1], 10);
      pastHeader = true;
      continue;
    }
    if (POB_META.test(raw) || POB_FLAG.test(raw)) {
      pastHeader = true;
      continue;
    }

    // Annotation-only handling: strip every leading {...} block.
    const line = raw.replace(/^(\{[^}]*\})+/, "").trim();
    if (!line) continue;
    // Skip explicit per-line markers PoB sometimes leaves inline.
    if (/\((implicit|enchant|rune|scourge)\)$/i.test(line)) continue;

    if (!pastHeader) {
      headerNames.push(line);
      continue;
    }
    if (implicitsLeft > 0) {
      implicitsLeft--;
      continue;
    }
    item.explicitLines.push(line);
  }

  if (headerNames.length === 1) {
    item.baseLine = headerNames[0];
  } else if (headerNames.length >= 2) {
    item.nameLine = headerNames.slice(0, -1).join(" ");
    item.baseLine = headerNames[headerNames.length - 1];
  }
  return item;
}
