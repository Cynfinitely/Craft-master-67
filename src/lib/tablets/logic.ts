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
  /** Effect text used for the stash regex and trade stat match. */
  text?: string;
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

/** Catalog entries in scope, in catalog order. Throws when a name is not in the catalog. */
export function scopeCatalog<T extends { name: string }>(catalog: T[], tablets?: string[]): T[] {
  if (!tablets?.length) return catalog;
  const known = new Set(catalog.map((t) => t.name));
  const unknown = tablets.filter((name) => !known.has(name));
  if (unknown.length) throw new Error(`Unknown tablet: ${unknown.join(", ")}`);
  const wanted = new Set(tablets);
  return catalog.filter((t) => wanted.has(t.name));
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

function affixByNorm(affixes: TabletAffix[]): Map<string, TabletAffix> {
  const byNorm = new Map<string, TabletAffix>();
  for (const affix of affixes) {
    for (const norm of affix.norms) {
      if (!byNorm.has(norm)) byNorm.set(norm, affix);
    }
  }
  return byNorm;
}

function findAffixByText(
  text: string,
  affixes: TabletAffix[],
  byNorm: Map<string, TabletAffix>,
): TabletAffix | undefined {
  const norm = normalizeStat(text);
  const exact = byNorm.get(norm);
  if (exact) return exact;
  const core = corePhrase(norm);
  if (core.length < 8) return undefined;
  for (const affix of affixes) {
    for (const n of affix.norms) {
      const other = corePhrase(n);
      if (!other) continue;
      if (other === core || other.includes(core) || core.includes(other)) return affix;
    }
  }
  return undefined;
}

/** Maps modifier lines onto catalog affixes. One hit per mod group. */
export function matchTextsToAffixes(texts: string[], affixes: TabletAffix[]): ComboMod[] {
  const byNorm = affixByNorm(affixes);
  const mods: ComboMod[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const affix = findAffixByText(text, affixes, byNorm);
    if (!affix || seen.has(affix.group)) continue;
    seen.add(affix.group);
    mods.push({
      group: affix.group,
      side: affix.side,
      label: affix.label,
      text: affix.text || affix.label,
    });
  }
  return mods;
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
  const byNorm = affixByNorm(opts.affixes);
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
    mods.push({
      group: affix.group,
      side: affix.side,
      label: affix.label,
      text: affix.text || affix.label,
    });
  };

  for (const affix of matchListingAffixes(
    groupListingStats(opts.stats.filter((s) => s.name || s.hash)),
    opts.affixes,
    opts.statText,
  )) {
    const full = opts.affixes.find((a) => a.group === affix.group && a.side === affix.side);
    if (full) push(full);
  }
  for (const line of opts.lines) {
    const parsed = lineTextAndHash(line);
    if (!parsed.text) continue;
    const affix = findAffixByText(parsed.text, opts.affixes, byNorm);
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

/**
 * In-game search boxes are still 50 characters. 250 is the limit GGG has
 * said will arrive later; packing to 50 keeps a paste that works today.
 */
export const STASH_REGEX_LIMIT = 50;

const FRAGMENT_STOP = new Set([
  "map", "has", "the", "of", "to", "in", "and", "your", "with", "from", "for",
  "increased", "reduced", "chance", "contain", "additional", "more", "less",
]);

function fragmentWords(text: string): string[] {
  return stashFragment(text)
    .split(" ")
    .filter((word) => word.length >= 3 && !FRAGMENT_STOP.has(word.toLowerCase()));
}

/**
 * Shortest piece of a mod that does not appear on another mod in `pool`.
 * Stash search is case-insensitive and matches substrings, so 3–5 letters
 * are enough when they are unique.
 */
export function uniqueFragment(text: string, pool: string[]): string {
  const mine = stashFragment(text);
  const others = pool
    .map((entry) => stashFragment(entry))
    .filter((entry) => entry && entry.toLowerCase() !== mine.toLowerCase());
  const words = fragmentWords(mine);
  const candidates: string[] = [];
  for (const word of words) {
    const cap = Math.min(word.length, 5);
    for (let n = 3; n <= cap; n++) candidates.push(word.slice(0, n));
  }
  for (const frag of candidates) {
    if (!others.some((other) => other.toLowerCase().includes(frag.toLowerCase()))) return frag;
  }
  return (words[0] || mine).slice(0, 5);
}

/**
 * OR of per-combo AND groups, highest-value first. Each mod is shortened to
 * a unique fragment so several mods fit in the 50-character search box.
 */
export function packComboRegex(
  combos: string[][],
  limit = STASH_REGEX_LIMIT,
  pool: string[] = combos.flat(),
): { regex: string; included: number } {
  let regex = "";
  let included = 0;
  for (const texts of combos) {
    const parts = texts
      .map((text) => uniqueFragment(text, pool))
      .filter(Boolean)
      .map((frag) => `(?=.*${escapeRegex(frag)})`);
    if (parts.length === 0) continue;
    const wrapped = `(${parts.join("")})`;
    const next = regex ? `${regex}|${wrapped}` : wrapped;
    if (next.length > limit) break;
    regex = next;
    included += 1;
  }
  return { regex, included };
}

/** A price needs this many live listings before it is shown. */
export const MIN_CONFIRMED_LISTINGS = 3;

export function comboIsConfirmed(status: string, listingCount: number | null): boolean {
  return status === "priced" && (listingCount ?? 0) >= MIN_CONFIRMED_LISTINGS;
}

/* ----------------------------- confirm queue ----------------------------- */

/** Confirm searches allowed per refresh, on top of each tablet's sample. */
export const CONFIRM_BUDGET_PER_RUN = 20;
/** Listings fetched from each sample search (3 fetch calls). */
export const TABLET_SAMPLE_LISTINGS = 30;

/**
 * Price bands (chaos) each tablet's sample reads, cheapest first inside each
 * band. Sorting the whole market by price descending only reaches asks parked
 * at the search cap; the cheapest asks above 100c are the credible valuable ones.
 */
// Bounds are in chaos: a divine cap would drop every 100c+ ask when a divine is worth under 100c.
export const TABLET_SAMPLE_BANDS_CHAOS: { min: number; max: number }[] = [
  { min: 100, max: 2000 },
  { min: 30, max: 100 },
  { min: 10, max: 30 },
];

/** Sample bands as exalted-equivalent price filters. */
export function sampleBandsExalted(chaosExalted: number): { min: number; max: number }[] {
  return TABLET_SAMPLE_BANDS_CHAOS.map((b) => ({
    min: Math.max(1, Math.floor(b.min * chaosExalted)),
    max: Math.round(b.max * chaosExalted),
  }));
}
/** Confirmed and too-few-listings rows are rechecked after this long. */
export const CONFIRM_FRESH_MS = 6 * 60 * 60 * 1000;
/** A tablet's listing sample is reread after this long. */
export const SAMPLE_FRESH_MS = 60 * 60 * 1000;
/** Each tablet gets this many confirms before any tablet gets more. */
export const CONFIRM_TOP_PER_TABLET = 5;

export interface ConfirmQueueRow {
  id: string;
  tablet: string;
  status: string;
  sampledMaxExalted: number | null;
  sampleCount: number | null;
  fetchedAt: number;
}

export function needsConfirm(row: ConfirmQueueRow, now: number): boolean {
  if (row.status === "pending_floor") return true;
  if (row.status === "priced" || row.status === "thin") {
    return now - row.fetchedAt >= CONFIRM_FRESH_MS;
  }
  return false;
}

/** Sampled price weighted by how many sampled listings shared the combination. */
export function confirmScore(row: ConfirmQueueRow): number {
  return (row.sampledMaxExalted ?? 0) * Math.max(1, row.sampleCount ?? 1);
}

/**
 * Rows to confirm, best first: the top few of every tablet by score, then the
 * rest by score. Fresh rows are left out.
 */
export function orderConfirmQueue<T extends ConfirmQueueRow>(
  rows: T[],
  now: number,
  topPerTablet = CONFIRM_TOP_PER_TABLET,
): T[] {
  const byTablet = new Map<string, T[]>();
  for (const row of rows) {
    if (!needsConfirm(row, now)) continue;
    const list = byTablet.get(row.tablet) ?? [];
    list.push(row);
    byTablet.set(row.tablet, list);
  }
  const first: T[] = [];
  const rest: T[] = [];
  for (const list of byTablet.values()) {
    list.sort((a, b) => confirmScore(b) - confirmScore(a));
    first.push(...list.slice(0, topPerTablet));
    rest.push(...list.slice(topPerTablet));
  }
  const byScore = (a: T, b: T) => confirmScore(b) - confirmScore(a);
  return [...first.sort(byScore), ...rest.sort(byScore)];
}

/** The next row to confirm, or why there is none. */
export function nextConfirm<T extends ConfirmQueueRow>(
  rows: T[],
  now: number,
  spentThisRun: number,
  budget = CONFIRM_BUDGET_PER_RUN,
): { row: T | null; queued: number; budgetSpent: boolean } {
  const queue = orderConfirmQueue(rows, now);
  if (queue.length === 0) return { row: null, queued: 0, budgetSpent: false };
  if (spentThisRun >= budget) return { row: null, queued: queue.length, budgetSpent: true };
  return { row: queue[0], queued: queue.length, budgetSpent: false };
}

export interface ComboStatusCounts {
  confirmed: number;
  waiting: number;
  thin: number;
}

export function comboStatusCounts(
  rows: { status: string; listingCount: number | null }[],
): ComboStatusCounts {
  const counts = { confirmed: 0, waiting: 0, thin: 0 };
  for (const row of rows) {
    if (comboIsConfirmed(row.status, row.listingCount)) counts.confirmed++;
    else if (row.status === "pending_floor") counts.waiting++;
    else if (row.status === "thin" || row.status === "priced") counts.thin++;
  }
  return counts;
}

/** Listings above this many divines are treated as price-fixers. */
export const MAX_TABLET_PRICE_DIVINE = 10;

export interface TabletOverviewLine {
  baseType: string;
  /** Price in the overview's primary currency (divine for PoE 2 stash items). */
  primaryValue: number;
  listingCount: number;
  explicitModifiers: { text: string }[];
}

export interface GroupedTabletCombo {
  tablet: string;
  key: string;
  prefixes: ComboMod[];
  suffixes: ComboMod[];
  floorExalted: number;
  medianExalted: number;
  listingCount: number;
  sampleCount: number;
}

/**
 * Turns economy overview lines into 2-prefix + 2-suffix floors.
 * Lines that are not exactly those four mods, or that cost more than 10 div,
 * are ignored. `exaltedPerDivine` converts the overview's divine price.
 */
export function groupTabletOverview(
  lines: TabletOverviewLine[],
  catalog: TabletCatalogEntry[],
  exaltedPerDivine: number,
): GroupedTabletCombo[] {
  if (!(exaltedPerDivine > 0)) return [];
  const byName = new Map(catalog.map((t) => [t.name.toLowerCase(), t]));
  interface Bucket {
    tablet: string;
    prefixes: ComboMod[];
    suffixes: ComboMod[];
    prices: number[];
    listingCount: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const line of lines) {
    if (!(line.primaryValue > 0) || line.primaryValue > MAX_TABLET_PRICE_DIVINE) continue;
    const tablet = byName.get(line.baseType.trim().toLowerCase());
    if (!tablet) continue;
    const texts = line.explicitModifiers.map((m) => m.text).filter(Boolean);
    const combo = extractFourModCombo(
      matchTextsToAffixes(texts, [...tablet.prefixes, ...tablet.suffixes]),
    );
    if (!combo) continue;
    const exalted = line.primaryValue * exaltedPerDivine;
    const id = `${tablet.name}|${combo.key}`;
    const prev = buckets.get(id);
    if (!prev) {
      buckets.set(id, {
        tablet: tablet.name,
        prefixes: combo.prefixes,
        suffixes: combo.suffixes,
        prices: [exalted],
        listingCount: Math.max(0, line.listingCount || 0),
      });
    } else {
      prev.prices.push(exalted);
      prev.listingCount += Math.max(0, line.listingCount || 0);
    }
  }

  return [...buckets.entries()]
    .map(([id, bucket]) => {
      const { floor, median } = floorAndMedian(bucket.prices);
      return {
        tablet: bucket.tablet,
        key: id.slice(bucket.tablet.length + 1),
        prefixes: bucket.prefixes,
        suffixes: bucket.suffixes,
        floorExalted: floor ?? bucket.prices[0],
        medianExalted: median ?? bucket.prices[0],
        listingCount: bucket.listingCount,
        sampleCount: bucket.prices.length,
      };
    })
    .sort((a, b) => b.floorExalted - a.floorExalted);
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
