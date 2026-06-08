import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Loads the poe2scout-sourced material catalog from data/snapshot/materials.json
 * (produced by `npm run data:materials`). This replaces the old hand-curated
 * catalog: it carries real effect text, per-item-class essence values, stack
 * sizes, and icons, and joins to live prices by `apiId`.
 */

export interface Material {
  apiId: string;
  name: string;
  /** Raw poe2scout category id (e.g. "essences"). */
  category: string;
  /** Human-readable group label (e.g. "Essences"). */
  label: string;
  /** Effect lines as shown in-game (per-class values for essences). */
  effect: string[];
  description: string | null;
  iconUrl: string | null;
  stackSize: number | null;
  maxStackSize: number | null;
  /** Essence/upgrade tier parsed from the name, when present. */
  tier: MaterialTier | null;
}

export type MaterialTier = "Lesser" | "Normal" | "Greater" | "Perfect";

interface Snapshot {
  source: string;
  league: string;
  fetchedAt: string;
  count: number;
  materials: Omit<Material, "tier">[];
}

// Display order for category groups. Anything not listed is appended after.
const LABEL_ORDER = [
  "Currency",
  "Essences",
  "Runes & Soul Cores",
  "Fragments",
  "Ritual",
  "Breach",
  "Abyss",
  "Expedition",
  "Ultimatum",
  "Delirium",
  "Incursion",
  "Vault Keys",
  "Vaal / Corruption",
  "Uncut Gems",
  "Lineage Support Gems",
  "Idols",
];

let cache: Material[] | null = null;

function parseTier(name: string): MaterialTier | null {
  if (/\bperfect\b/i.test(name)) return "Perfect";
  if (/\bgreater\b/i.test(name)) return "Greater";
  if (/\blesser\b/i.test(name)) return "Lesser";
  // An essence with no qualifier is the base ("Normal") tier.
  if (/\bessence\b/i.test(name)) return "Normal";
  return null;
}

export function getMaterials(): Material[] {
  if (cache) return cache;
  const file = path.join(process.cwd(), "data", "snapshot", "materials.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${file}. Run \`npm run data:materials\` to fetch the catalog.`,
    );
  }
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  cache = snap.materials.map((m) => ({ ...m, tier: parseTier(m.name) }));
  return cache;
}

export function getMaterialsMeta(): { league: string; fetchedAt: string } {
  const file = path.join(process.cwd(), "data", "snapshot", "materials.json");
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  return { league: snap.league, fetchedAt: snap.fetchedAt };
}

export function getEssences(): Material[] {
  return getMaterials().filter((m) => m.category === "essences");
}

/** Materials grouped by display label, in a curated order. */
export function materialsByCategory(): { label: string; items: Material[] }[] {
  const groups = new Map<string, Material[]>();
  for (const m of getMaterials()) {
    if (!groups.has(m.label)) groups.set(m.label, []);
    groups.get(m.label)!.push(m);
  }
  return [...groups.entries()]
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      const ia = LABEL_ORDER.indexOf(a.label);
      const ib = LABEL_ORDER.indexOf(b.label);
      return (
        (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) ||
        a.label.localeCompare(b.label)
      );
    });
}
