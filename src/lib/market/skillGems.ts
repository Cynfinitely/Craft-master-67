import "server-only";
import fs from "node:fs";
import path from "node:path";
import { baseItemsFile } from "../../../scripts/lib/repoe-schema";
import { fetchGemItemCatalog } from "@/lib/trade/client";

const SNAPSHOT_PATH = path.join(process.cwd(), "data", "snapshot", "base_items.json");

/** Gems that cannot be corrupted (Kalguuran skills, etc.). Extend as needed. */
export const NON_CORRUPTABLE_GEMS = new Set<string>([
  "Remnants of Kalguur",
]);

export interface SkillGemEntry {
  /** Trade query `type` — the gem display name, e.g. "Comet". */
  type: string;
}

let cachedCatalog: SkillGemEntry[] | null = null;

function isKalguuran(tags: string[] | undefined, name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes("kalguur")) return true;
  for (const tag of tags ?? []) {
    if (tag.toLowerCase().includes("kalguur")) return true;
  }
  return false;
}

/**
 * All released active skill gems from the repoe snapshot, excluding
 * known uncorruptable (Kalguuran) skills. Names match PoE2 trade `type`.
 */
export async function loadActiveSkillGems(): Promise<SkillGemEntry[]> {
  if (cachedCatalog) return cachedCatalog;

  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  const items = baseItemsFile.parse(raw);

  const gems: SkillGemEntry[] = [];
  for (const entry of Object.values(items)) {
    if (entry.item_class !== "Active Skill Gem") continue;
    if (entry.release_state && entry.release_state !== "released") continue;
    const name = entry.name?.trim();
    if (!name) continue;
    if (NON_CORRUPTABLE_GEMS.has(name)) continue;
    if (isKalguuran(entry.tags, name)) continue;
    gems.push({ type: name });
  }

  gems.sort((a, b) => a.type.localeCompare(b.type));

  // Optional: keep only names the trade site knows about (when catalog loads).
  try {
    const tradeGems = await fetchGemItemCatalog();
    if (tradeGems.length > 0) {
      const tradeTypes = new Set(tradeGems.map((g) => g.type));
      cachedCatalog = gems.filter((g) => tradeTypes.has(g.type));
      return cachedCatalog;
    }
  } catch {
    /* snapshot list is fine without trade cross-check */
  }

  cachedCatalog = gems;
  return cachedCatalog;
}

/** Clears in-memory cache (tests / after snapshot refresh). */
export function clearSkillGemCache(): void {
  cachedCatalog = null;
}
