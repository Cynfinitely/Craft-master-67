import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { metaItems, type MetaItemRow } from "@/db/schema";

/**
 * Meta demand store: rare items imported from ladder builds (PoB2 codes).
 * These tell the tool which bases + explicit combos players actually wear —
 * the demand side that probes/samples (supply side) can't see.
 */

export interface MetaItem {
  id: number;
  league: string;
  itemClass: string;
  baseId: string | null;
  baseName: string | null;
  groups: string[];
  labels: string[];
  sourceLabel: string | null;
  addedAt: number;
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function toMetaItem(row: MetaItemRow): MetaItem {
  return {
    id: row.id,
    league: row.league,
    itemClass: row.itemClass,
    baseId: row.baseId,
    baseName: row.baseName,
    groups: parseJsonArray(row.groups),
    labels: parseJsonArray(row.labels),
    sourceLabel: row.sourceLabel,
    addedAt: row.addedAt,
  };
}

export async function addMetaItems(
  items: {
    league: string;
    itemClass: string;
    baseId?: string | null;
    baseName?: string | null;
    groups: string[];
    labels: string[];
    sourceLabel?: string | null;
  }[],
): Promise<number> {
  if (items.length === 0) return 0;
  await ensureAppTables();
  const now = Date.now();
  await getDb()
    .insert(metaItems)
    .values(
      items.map((i) => ({
        league: i.league,
        itemClass: i.itemClass,
        baseId: i.baseId ?? null,
        baseName: i.baseName ?? null,
        groups: JSON.stringify(i.groups),
        labels: JSON.stringify(i.labels),
        sourceLabel: i.sourceLabel ?? null,
        addedAt: now,
      })),
    );
  return items.length;
}

export async function listMetaItems(
  league: string,
  itemClass?: string | null,
): Promise<MetaItem[]> {
  await ensureAppTables();
  const conditions = [eq(metaItems.league, league)];
  if (itemClass) conditions.push(eq(metaItems.itemClass, itemClass));
  const rows = await getDb()
    .select()
    .from(metaItems)
    .where(and(...conditions))
    .orderBy(desc(metaItems.addedAt))
    .limit(500);
  return rows.map(toMetaItem);
}

export async function deleteMetaItem(id: number): Promise<void> {
  await ensureAppTables();
  await getDb().delete(metaItems).where(eq(metaItems.id, id));
}

/**
 * Distinct meta combos for a class, with how many imported builds wear them.
 * Usage count is the demand-strength signal for ranking and probing.
 */
export async function getMetaCombos(
  league: string,
  itemClass: string,
): Promise<{ groups: string[]; labels: string[]; uses: number }[]> {
  const items = await listMetaItems(league, itemClass);
  const byKey = new Map<
    string,
    { groups: string[]; labels: string[]; uses: number }
  >();
  for (const item of items) {
    if (item.groups.length === 0) continue;
    const key = [...item.groups].sort().join("+");
    const entry = byKey.get(key);
    if (entry) entry.uses++;
    else byKey.set(key, { groups: item.groups, labels: item.labels, uses: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.uses - a.uses);
}
