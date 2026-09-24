import { cleanModText, normalizeStat } from "@/lib/data/format";

/**
 * Pure tablet-catalog, combo, price-filter, and stash-regex helpers.
 * No database and no trade calls — the scanner and the page both use these.
 */

export interface RawTabletMod {
  id: string;
  name: string | null;
  generationType: string;
  text: string | null;
  groups: string[];
  requiredLevel: number;
  spawnWeights: { tag: string; weight: number }[];
}

export interface RawTabletBase {
  id: string;
  name: string;
  tags: string[];
  releaseState: string | null;
  domain: string | null;
  itemClass: string;
}

export interface TabletAffix {
  group: string;
  side: "prefix" | "suffix";
  /** Mod name, or the effect text when the mod is unnamed. */
  label: string;
  /** Cleaned effect text used for the stash regex. */
  text: string;
  /** Normalized stat lines used to match trade listings. */
  norms: string[];
}

export interface TabletCatalogEntry {
  id: string;
  name: string;
  tags: string[];
  prefixes: TabletAffix[];
  suffixes: TabletAffix[];
}

export interface ComboMod {
  group: string;
  side: "prefix" | "suffix";
  label: string;
}

export interface FourModCombo {
  key: string;
  prefixes: ComboMod[];
  suffixes: ComboMod[];
}

export type PriceCurrency = "chaos" | "exalted" | "divine";

const TABLET_CLASS = "TowerAugmentation";

/** First spawn-weight entry whose tag the item carries. Zero blocks the mod. */
export function effectiveSpawnWeight(
  weights: { tag: string; weight: number }[],
  itemTags: string[],
): number {
  const tagSet = new Set(itemTags);
  for (const w of weights) {
    if (tagSet.has(w.tag)) return w.weight;
  }
  return 0;
}

function affixLabel(name: string | null, text: string): string {
  const trimmed = name?.trim() ?? "";
  if (trimmed) return trimmed;
  const first = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return first || "Unknown mod";
}

function normsFor(text: string | null): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => normalizeStat(line))
    .filter(Boolean);
}

/**
 * Released tablet bases with the prefixes and suffixes that can actually roll,
 * grouped so only one tier of a mod group is listed.
 */
export function buildTabletCatalog(
  bases: RawTabletBase[],
  mods: RawTabletMod[],
): TabletCatalogEntry[] {
  const affixMods = mods.filter(
    (m) => m.generationType === "prefix" || m.generationType === "suffix",
  );
  const tablets = bases
    .filter(
      (b) =>
        b.domain === "tablet" &&
        b.itemClass === TABLET_CLASS &&
        (b.releaseState ?? "released") === "released",
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return tablets.map((base) => {
    const groups = new Map<string, TabletAffix & { level: number }>();
    for (const mod of affixMods) {
      if (effectiveSpawnWeight(mod.spawnWeights, base.tags) <= 0) continue;
      const side = mod.generationType === "prefix" ? "prefix" : "suffix";
      const group = mod.groups[0] ?? mod.id;
      const text = cleanModText(mod.text);
      const key = `${side}:${group}`;
      const existing = groups.get(key);
      const norms = normsFor(mod.text);
      if (!existing) {
        groups.set(key, {
          group,
          side,
          label: affixLabel(mod.name, text),
          text,
          norms,
          level: mod.requiredLevel,
        });
        continue;
      }
      const seen = new Set(existing.norms);
      for (const n of norms) {
        if (!seen.has(n)) existing.norms.push(n);
      }
      if (mod.requiredLevel >= existing.level && text) {
        existing.text = text;
        existing.level = mod.requiredLevel;
        if (!mod.name?.trim()) existing.label = affixLabel(null, text);
      }
    }
    const affixes = [...groups.values()].map(({ level: _level, ...affix }) => affix);
    affixes.sort((a, b) => a.label.localeCompare(b.label));
    return {
      id: base.id,
      name: base.name,
      tags: base.tags,
      prefixes: affixes.filter((a) => a.side === "prefix"),
      suffixes: affixes.filter((a) => a.side === "suffix"),
    };
  });
}

export function comboKey(prefixes: { group: string }[], suffixes: { group: string }[]): string {
  const p = prefixes.map((m) => m.group).sort();
  const s = suffixes.map((m) => m.group).sort();
  return `p:${p.join("+")}|s:${s.join("+")}`;
}

/**
 * A listing is a combo only when it has exactly two distinct prefix groups
 * and two distinct suffix groups. Anything else, including a repeated group,
 * is discarded.
 */
export function extractFourModCombo(mods: ComboMod[]): FourModCombo | null {
  if (mods.length !== 4) return null;
  const groups = new Set(mods.map((m) => m.group));
  if (groups.size !== mods.length) return null;
  const prefixes = mods.filter((m) => m.side === "prefix");
  const suffixes = mods.filter((m) => m.side === "suffix");
  if (prefixes.length !== 2 || suffixes.length !== 2) return null;
  const orderedP = [...prefixes].sort((a, b) => a.group.localeCompare(b.group));
  const orderedS = [...suffixes].sort((a, b) => a.group.localeCompare(b.group));
  return {
    key: comboKey(orderedP, orderedS),
    prefixes: orderedP,
    suffixes: orderedS,
  };
}

export interface ListingModRef {
  /** In-game mod name from the trade listing, when present. */
  name: string | null;
  /** Trade stat hashes on that explicit mod. */
  hashes: string[];
}

/**
 * Resolves each explicit mod on a listing to a catalog affix.
 * Name match wins; otherwise a normalized stat-text match.
 */
export function matchListingAffixes(
  listingMods: ListingModRef[],
  affixes: TabletAffix[],
  statText: Map<string, string>,
): ComboMod[] {
  const byLabel = new Map<string, TabletAffix>();
  const byNorm = new Map<string, TabletAffix>();
  for (const affix of affixes) {
    byLabel.set(affix.label.toLowerCase(), affix);
    for (const norm of affix.norms) {
      if (!byNorm.has(norm)) byNorm.set(norm, affix);
    }
  }

  const matched: ComboMod[] = [];
  for (const mod of listingMods) {
    const named = mod.name?.trim().toLowerCase();
    let affix = named ? byLabel.get(named) : undefined;
    if (!affix) {
      for (const hash of mod.hashes) {
        const norm = normalizeStat(statText.get(hash) ?? "");
        if (!norm) continue;
        affix = byNorm.get(norm);
        if (affix) break;
      }
    }
    if (!affix) continue;
    matched.push({ group: affix.group, side: affix.side, label: affix.label });
  }
  return matched;
}

/** Groups trade explicit rows that belong to the same item mod. */
/**
 * Turns a trade listing into catalog mods. Uses mod names when the trade
 * payload has them, and explicit text lines when stat hashes are missing.
 */
function corePhrase(norm: string): string {
  return norm
    .replace(/#/g, " ")
    .replace(/\b(map has|in map|in your maps)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lineTextAndHash(line: unknown): { text: string; hash: string } {
  if (typeof line === "string") return { text: line, hash: "" };
  if (line && typeof line === "object") {
    const row = line as { description?: unknown; hash?: unknown };
    return {
      text: typeof row.description === "string" ? row.description : "",
      hash: typeof row.hash === "string" ? row.hash : "",
    };
  }
  return { text: "", hash: "" };
}

/** Trade payloads use `stat.explicit.stat_N`. Searches want `explicit.stat_N`. */
export function tradeExplicitId(hash: string): string {
  const bare = hash.replace(/^stat\./, "");
  if (bare.startsWith("explicit.")) return bare;
  if (bare.startsWith("stat_")) return `explicit.${bare}`;
  return bare;
}

export function resolveListingMods(opts: {
  stats: { hash: string; name: string | null }[];
  lines: unknown[];
  affixes: TabletAffix[];
  statText: Map<string, string>;
}): { mods: ComboMod[]; statIds: string[] } {
  const byNorm = new Map<string, TabletAffix>();
  for (const affix of opts.affixes) {
    for (const norm of affix.norms) {
      if (!byNorm.has(norm)) byNorm.set(norm, affix);
    }
  }
  const hashByNorm = new Map<string, string>();
  for (const [id, text] of opts.statText) {
    const norm = normalizeStat(text);
    if (!norm || hashByNorm.has(norm)) continue;
    hashByNorm.set(norm, id.startsWith("explicit.") ? id : `explicit.${id}`);
  }

  const mods: ComboMod[] = [];
  const seen = new Set<string>();
  const statIds = new Set<string>();
  const push = (affix: TabletAffix) => {
    if (seen.has(affix.group)) return;
    seen.add(affix.group);
    mods.push({ group: affix.group, side: affix.side, label: affix.label });
  };

  for (const affix of matchListingAffixes(
    groupListingStats(opts.stats.filter((s) => s.name || s.hash)),
    opts.affixes,
    opts.statText,
  )) {
    const full = opts.affixes.find((a) => a.group === affix.group && a.side === affix.side);
    if (full) push(full);
  }
  const findAffix = (text: string): TabletAffix | undefined => {
    const norm = normalizeStat(text);
    const exact = byNorm.get(norm);
    if (exact) return exact;
    const core = corePhrase(norm);
    if (core.length < 8) return undefined;
    for (const affix of opts.affixes) {
      for (const n of affix.norms) {
        const other = corePhrase(n);
        if (!other) continue;
        if (other === core || other.includes(core) || core.includes(other)) return affix;
      }
    }
    return undefined;
  };

  for (const line of opts.lines) {
    const parsed = lineTextAndHash(line);
    if (!parsed.text) continue;
    const affix = findAffix(parsed.text);
    if (affix) push(affix);
    if (affix && parsed.hash) statIds.add(tradeExplicitId(parsed.hash));
  }

  for (const stat of opts.stats) {
    if (!stat.hash) continue;
    statIds.add(tradeExplicitId(stat.hash));
  }
  if (statIds.size === 0) {
    for (const line of opts.lines) {
      const parsed = lineTextAndHash(line);
      if (!parsed.text) continue;
      const id = hashByNorm.get(normalizeStat(parsed.text));
      if (id) statIds.add(id);
    }
  }
  return { mods, statIds: [...statIds] };
}

export function groupListingStats(
  stats: { hash: string; name: string | null }[],
): ListingModRef[] {
  const groups: ListingModRef[] = [];
  const index = new Map<string, ListingModRef>();
  for (const stat of stats) {
    const key = `${stat.name ?? ""}|${stat.hash}`;
    const nameKey = stat.name?.trim() ? `name:${stat.name.trim().toLowerCase()}` : key;
    let group = index.get(nameKey);
    if (!group) {
      group = { name: stat.name, hashes: [] };
      index.set(nameKey, group);
      groups.push(group);
    }
    if (!group.hashes.includes(stat.hash)) group.hashes.push(stat.hash);
  }
  return groups;
}

export function thresholdToExalted(
  amount: number,
  currency: PriceCurrency,
  rates: { chaosExalted: number; divineExalted: number },
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (currency === "divine") return amount * (rates.divineExalted > 0 ? rates.divineExalted : 0);
  if (currency === "chaos") return amount * (rates.chaosExalted > 0 ? rates.chaosExalted : 0);
  return amount;
}

/** Zero or empty minimums keep every row, including ones still waiting on a price. */
export function comboMeetsMinimum(
  floorExalted: number | null,
  minExalted: number,
): boolean {
  if (!Number.isFinite(minExalted) || minExalted <= 0) return true;
  if (floorExalted == null || !Number.isFinite(floorExalted)) return false;
  return floorExalted + 1e-6 >= minExalted;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A short, number-free phrase from a mod line for an in-game stash search. */
export function stashFragment(text: string): string {
  const cleaned = cleanModText(text).split("\n")[0] ?? "";
  const stripped = cleaned
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d+(\.\d+)?/g, " ")
    .replace(/[%+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

/**
 * In-game stash regex: every checked mod must appear (positive lookaheads).
 * Empty when nothing is checked.
 */
export function buildStashRegex(texts: string[]): string {
  const fragments = texts.map(stashFragment).filter(Boolean);
  if (fragments.length === 0) return "";
  return fragments.map((f) => `(?=.*${escapeRegex(f)})`).join("");
}

export interface RateLimitErrorLike {
  status?: number;
  retryAfterMs?: number;
  message?: string;
}

export function isRateLimitError(err: unknown): err is RateLimitErrorLike {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (status === 429) return true;
  const message = err instanceof Error ? err.message : "";
  return /rate-limited|\b429\b/i.test(message);
}

export interface RateLimitedBatchResult {
  processed: number;
  searches: number;
  stoppedForRateLimit: boolean;
  rateLimitRetryMs?: number;
}

/**
 * Runs searches one at a time. A rate-limit error stops the batch immediately
 * so no further search is issued.
 */
export async function runRateLimitedBatch<T>(opts: {
  tasks: T[];
  search: (task: T) => Promise<void>;
  getCooldownMs?: () => Promise<number>;
  maxInlineWaitMs?: number;
}): Promise<RateLimitedBatchResult> {
  const maxInlineWaitMs = opts.maxInlineWaitMs ?? 15_000;
  const getCooldownMs = opts.getCooldownMs ?? (async () => 0);
  let processed = 0;
  let searches = 0;

  for (const task of opts.tasks) {
    const cooldownMs = await getCooldownMs();
    if (cooldownMs > maxInlineWaitMs) {
      return {
        processed,
        searches,
        stoppedForRateLimit: true,
        rateLimitRetryMs: cooldownMs,
      };
    }
    try {
      searches += 1;
      await opts.search(task);
      processed += 1;
    } catch (err) {
      if (isRateLimitError(err)) {
        const retryAfterMs =
          typeof err.retryAfterMs === "number" && err.retryAfterMs > 0
            ? err.retryAfterMs
            : 60_000;
        return {
          processed,
          searches,
          stoppedForRateLimit: true,
          rateLimitRetryMs: retryAfterMs,
        };
      }
      throw err;
    }
  }

  return { processed, searches, stoppedForRateLimit: false };
}

/** Cheapest and median of a price sample. Drops lowballs under 25% of the median. */
export function floorAndMedian(prices: number[]): {
  floor: number | null;
  median: number | null;
} {
  const finite = prices.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (finite.length === 0) return { floor: null, median: null };
  const mid = medianOf(finite);
  const kept = finite.filter((n) => n >= mid * 0.25);
  const sample = kept.length > 0 ? kept : finite;
  return { floor: sample[0], median: medianOf(sample) };
}

function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
