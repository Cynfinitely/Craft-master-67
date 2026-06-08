import "server-only";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import { getDb } from "@/db";
import { bases, itemClasses, modSpawnWeights, mods } from "@/db/schema";
import type {
  BaseDetail,
  BaseSummary,
  EligibleMod,
  ItemClassInfo,
  ModPool,
  ModStat,
} from "./types";

const DEFAULT_GEN_TYPES = ["prefix", "suffix"] as const;
const SQL_VAR_CHUNK = 400;

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function chunked<T>(
  ids: string[],
  fn: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += SQL_VAR_CHUNK) {
    out.push(...(await fn(ids.slice(i, i + SQL_VAR_CHUNK))));
  }
  return out;
}

type BaseRow = typeof bases.$inferSelect;

function toBaseSummary(row: BaseRow): BaseSummary {
  return {
    id: row.id,
    name: row.name,
    itemClass: row.itemClass,
    dropLevel: row.dropLevel,
    tags: parseJson<string[]>(row.tags, []),
  };
}

function toBaseDetail(row: BaseRow): BaseDetail {
  return {
    ...toBaseSummary(row),
    domain: row.domain,
    releaseState: row.releaseState,
    invWidth: row.invWidth,
    invHeight: row.invHeight,
    requirements: parseJson<Record<string, number> | null>(
      row.requirements,
      null,
    ),
    properties: parseJson<Record<string, unknown> | null>(row.properties, null),
    implicits: parseJson<string[]>(row.implicits, []),
    visualDds: row.visualDds,
  };
}

/* ----------------------------- item classes ----------------------------- */

export async function listItemClasses(): Promise<ItemClassInfo[]> {
  const db = getDb();
  const rows = await db.select().from(itemClasses).orderBy(asc(itemClasses.name));
  return rows.map((r) => ({
    name: r.name,
    category: r.category,
    categoryId: r.categoryId,
  }));
}

/** Item classes that actually have at least one base, grouped by category. */
export async function listCraftableCategories(): Promise<
  { category: string; classes: string[] }[]
> {
  const db = getDb();
  const rows = await db
    .select({ itemClass: bases.itemClass, category: itemClasses.categoryId })
    .from(bases)
    .leftJoin(itemClasses, eq(bases.itemClass, itemClasses.name))
    .where(eq(bases.craftable, 1))
    .groupBy(bases.itemClass);

  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const cat = r.category ?? "Other";
    if (!map.has(cat)) map.set(cat, new Set());
    map.get(cat)!.add(r.itemClass);
  }
  return [...map.entries()]
    .map(([category, set]) => ({
      category,
      classes: [...set].sort(),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/* ----------------------------- bases ----------------------------- */

export interface SearchBasesParams {
  q?: string;
  itemClass?: string;
  limit?: number;
  offset?: number;
}

export async function searchBases(
  params: SearchBasesParams = {},
): Promise<BaseSummary[]> {
  const db = getDb();
  const { q, itemClass, limit = 60, offset = 0 } = params;

  const conditions = [eq(bases.craftable, 1)];
  if (q && q.trim()) conditions.push(like(bases.name, `%${q.trim()}%`));
  if (itemClass) conditions.push(eq(bases.itemClass, itemClass));

  const rows = await db
    .select()
    .from(bases)
    .where(and(...conditions))
    .orderBy(asc(bases.name))
    .limit(limit)
    .offset(offset);

  return rows.map(toBaseSummary);
}

export async function getBase(id: string): Promise<BaseDetail | null> {
  const db = getDb();
  const rows = await db.select().from(bases).where(eq(bases.id, id)).limit(1);
  return rows[0] ? toBaseDetail(rows[0]) : null;
}

/* ----------------------------- modifier pool ----------------------------- */

/**
 * Computes the modifiers that can roll on an item with the given tags at the
 * given item level, using PoE first-match spawn-weight semantics: a mod's
 * effective weight is the weight of the FIRST spawn-weight entry (by order)
 * whose tag the item carries. Zero-weight entries earlier in the list block
 * the mod entirely.
 */
export async function getEligibleMods(
  itemTags: string[],
  itemLevel: number,
  options: { generationTypes?: readonly string[]; includeEssenceOnly?: boolean } = {},
): Promise<EligibleMod[]> {
  const db = getDb();
  const generationTypes = options.generationTypes ?? DEFAULT_GEN_TYPES;
  const includeEssenceOnly = options.includeEssenceOnly ?? false;
  const tagSet = new Set(itemTags);
  if (tagSet.size === 0) return [];

  // 1) Candidate mods: any mod with a spawn weight whose tag this item carries.
  const candidateRows = await db
    .selectDistinct({ modId: modSpawnWeights.modId })
    .from(modSpawnWeights)
    .where(inArray(modSpawnWeights.tag, itemTags));
  const candidateIds = candidateRows.map((r) => r.modId);
  if (!candidateIds.length) return [];

  // 2) Load every spawn-weight row for those mods (need ordering + blockers).
  const weightRows = await chunked(candidateIds, (chunk) =>
    db
      .select()
      .from(modSpawnWeights)
      .where(inArray(modSpawnWeights.modId, chunk))
      .orderBy(asc(modSpawnWeights.modId), asc(modSpawnWeights.ord)),
  );

  const byMod = new Map<string, { tag: string; weight: number; ord: number }[]>();
  for (const w of weightRows) {
    if (!byMod.has(w.modId)) byMod.set(w.modId, []);
    byMod.get(w.modId)!.push({ tag: w.tag, weight: w.weight, ord: w.ord });
  }

  // 3) First-match effective weight.
  const effective = new Map<string, number>();
  for (const [modId, rows] of byMod) {
    rows.sort((a, b) => a.ord - b.ord);
    let w = 0;
    for (const r of rows) {
      if (tagSet.has(r.tag)) {
        w = r.weight;
        break;
      }
    }
    if (w > 0) effective.set(modId, w);
  }
  const eligibleIds = [...effective.keys()];
  if (!eligibleIds.length) return [];

  // 4) Load mod metadata and apply domain / generation / level / essence filters.
  const modRows = await chunked(eligibleIds, (chunk) =>
    db
      .select()
      .from(mods)
      .where(
        and(
          inArray(mods.id, chunk),
          eq(mods.domain, "item"),
          inArray(mods.generationType, [...generationTypes]),
        ),
      ),
  );

  const result: EligibleMod[] = [];
  for (const m of modRows) {
    if (m.requiredLevel > itemLevel) continue;
    if (m.isEssenceOnly && !includeEssenceOnly) continue;
    result.push({
      id: m.id,
      name: m.name,
      type: m.type,
      generationType: m.generationType,
      requiredLevel: m.requiredLevel,
      isEssenceOnly: Boolean(m.isEssenceOnly),
      text: m.text,
      groups: parseJson<string[]>(m.groups, []),
      stats: parseJson<ModStat[]>(m.stats, []),
      implicitTags: parseJson<string[]>(m.implicitTags, []),
      weight: effective.get(m.id) ?? 0,
    });
  }

  // Sort by weight desc, then required level.
  result.sort((a, b) => b.weight - a.weight || a.requiredLevel - b.requiredLevel);
  return result;
}

/** Resolves a set of mod ids to their display text (used for implicits). */
export async function getModTexts(
  ids: string[],
): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const db = getDb();
  const rows = await chunked(ids, (chunk) =>
    db
      .select({ id: mods.id, text: mods.text })
      .from(mods)
      .where(inArray(mods.id, chunk)),
  );
  return new Map(rows.map((r) => [r.id, r.text]));
}

export async function getModPool(
  baseId: string,
  itemLevel: number,
): Promise<ModPool | null> {
  const base = await getBase(baseId);
  if (!base) return null;

  const all = await getEligibleMods(base.tags, itemLevel);
  const prefixes = all.filter((m) => m.generationType === "prefix");
  const suffixes = all.filter((m) => m.generationType === "suffix");

  return {
    base,
    itemLevel,
    prefixes,
    suffixes,
    prefixTotalWeight: prefixes.reduce((s, m) => s + m.weight, 0),
    suffixTotalWeight: suffixes.reduce((s, m) => s + m.weight, 0),
  };
}
