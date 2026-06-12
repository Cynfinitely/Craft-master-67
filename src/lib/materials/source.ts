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

/* ----- crafting-function taxonomy ----- */

export type MaterialTab = "essentials" | "league" | "gems";

const LEAGUE_LABELS = new Set([
  "Breach",
  "Ritual",
  "Abyss",
  "Expedition",
  "Delirium",
  "Incursion",
  "Ultimatum",
  "Vaal / Corruption",
  "Fragments",
]);

const GEMS_LABELS = new Set([
  "Uncut Gems",
  "Lineage Support Gems",
  "Idols",
  "Vault Keys",
]);

export function isOmen(m: Material): boolean {
  return /\bomen\b/i.test(m.name);
}

export function isSoulCore(m: Material): boolean {
  return /\bsoul core\b/i.test(m.name);
}

export function materialTab(m: Material): MaterialTab {
  if (
    m.label === "Currency" ||
    m.label === "Essences" ||
    m.category === "runes" ||
    isOmen(m)
  ) {
    return "essentials";
  }
  if (GEMS_LABELS.has(m.label)) return "gems";
  if (LEAGUE_LABELS.has(m.label)) return "league";
  return "gems";
}

function essenceFamily(name: string): string {
  return name
    .replace(/^(Lesser |Greater |Perfect )/i, "")
    .replace(/^Essence of /i, "")
    .trim();
}

export interface EssenceRow {
  family: string;
  tiers: Partial<Record<MaterialTier, Material>>;
}

/** Essence families as a tier matrix (Lesser / Normal / Greater / Perfect). */
export function essenceMatrix(): EssenceRow[] {
  const map = new Map<string, EssenceRow>();
  for (const m of getMaterials()) {
    if (m.category !== "essences") continue;
    const family = essenceFamily(m.name);
    if (!map.has(family)) map.set(family, { family, tiers: {} });
    const tier = m.tier ?? "Normal";
    map.get(family)!.tiers[tier] = m;
  }
  return [...map.values()].sort((a, b) => a.family.localeCompare(b.family));
}

const CURRENCY_FAMILIES: { family: string; pattern: RegExp }[] = [
  { family: "Orb of Transmutation", pattern: /orb of transmutation/i },
  { family: "Orb of Augmentation", pattern: /orb of augmentation/i },
  { family: "Exalted Orb", pattern: /exalted orb/i },
  { family: "Chaos Orb", pattern: /chaos orb/i },
  { family: "Regal Orb", pattern: /regal orb/i },
  { family: "Jeweller's Orb", pattern: /jeweller'?s orb/i },
  { family: "Orb of Alchemy", pattern: /orb of alchemy/i },
  { family: "Orb of Annulment", pattern: /orb of annulment/i },
];

export interface CurrencyRow {
  family: string;
  tiers: Partial<Record<MaterialTier, Material>>;
}

/** Tiered crafting orbs grouped into rows. */
export function currencyTierRows(): CurrencyRow[] {
  const currency = getMaterials().filter((m) => m.category === "currency");
  const used = new Set<string>();
  const rows: CurrencyRow[] = [];

  for (const { family, pattern } of CURRENCY_FAMILIES) {
    const items = currency.filter((m) => pattern.test(m.name));
    if (items.length === 0) continue;
    for (const m of items) used.add(m.apiId);
    const tiers: Partial<Record<MaterialTier, Material>> = {};
    for (const m of items) {
      const tier = m.tier ?? "Normal";
      tiers[tier] = m;
    }
    rows.push({ family, tiers });
  }
  return rows;
}

/** Non-tiered currency (Divine, Vaal, scraps, shards, etc.). */
export function currencyMisc(): Material[] {
  const tieredIds = new Set(
    currencyTierRows()
      .flatMap((r) => Object.values(r.tiers))
      .map((m) => m!.apiId),
  );
  return getMaterials()
    .filter((m) => m.category === "currency" && !tieredIds.has(m.apiId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function omens(): Material[] {
  return getMaterials()
    .filter(isOmen)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function soulCores(): Material[] {
  return getMaterials()
    .filter((m) => m.category === "runes" && isSoulCore(m))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function runes(): Material[] {
  return getMaterials()
    .filter((m) => m.category === "runes" && !isSoulCore(m))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface LeagueGroup {
  label: string;
  items: Material[];
}

/** League-drop materials grouped by label (Ritual excludes omens). */
export function leagueGroups(): LeagueGroup[] {
  const groups = new Map<string, Material[]>();
  for (const m of getMaterials()) {
    if (materialTab(m) !== "league") continue;
    if (m.label === "Ritual" && isOmen(m)) continue;
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

export function gemsAndOther(): LeagueGroup[] {
  const groups = new Map<string, Material[]>();
  for (const m of getMaterials()) {
    if (materialTab(m) !== "gems") continue;
    if (!groups.has(m.label)) groups.set(m.label, []);
    groups.get(m.label)!.push(m);
  }
  return [...groups.entries()]
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
