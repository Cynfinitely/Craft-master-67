import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { snipeSpecs, type SnipeSpecRow } from "@/db/schema";

/**
 * User-defined snipe targets: the exact item the user wants to hunt partials
 * for — item class, optional pinned base, and up to six mod groups with
 * optional tier floors. The scanner (snipes.ts) turns a spec into "all but
 * one mod, open slot" trade searches.
 */

export interface SnipeSpecMod {
  group: string;
  /** Required modifier level of the rolled tier (0/absent = any tier). */
  minLevel?: number;
}

export interface SnipeSpec {
  id: number;
  league: string;
  itemClass: string;
  baseId: string | null;
  name: string;
  mods: SnipeSpecMod[];
  createdAt: number;
}

function toSpec(row: SnipeSpecRow): SnipeSpec {
  let mods: SnipeSpecMod[] = [];
  try {
    mods = JSON.parse(row.mods) as SnipeSpecMod[];
  } catch {
    /* keep [] */
  }
  return {
    id: row.id,
    league: row.league,
    itemClass: row.itemClass,
    baseId: row.baseId,
    name: row.name,
    mods,
    createdAt: row.createdAt,
  };
}

export async function addSnipeSpec(spec: {
  league: string;
  itemClass: string;
  baseId?: string | null;
  name: string;
  mods: SnipeSpecMod[];
}): Promise<SnipeSpec> {
  await ensureAppTables();
  const rows = await getDb()
    .insert(snipeSpecs)
    .values({
      league: spec.league,
      itemClass: spec.itemClass,
      baseId: spec.baseId ?? null,
      name: spec.name,
      mods: JSON.stringify(spec.mods),
      createdAt: Date.now(),
    })
    .returning();
  return toSpec(rows[0]);
}

export async function listSnipeSpecs(
  league: string,
  itemClass?: string | null,
): Promise<SnipeSpec[]> {
  await ensureAppTables();
  const conditions = [eq(snipeSpecs.league, league)];
  if (itemClass) conditions.push(eq(snipeSpecs.itemClass, itemClass));
  const rows = await getDb()
    .select()
    .from(snipeSpecs)
    .where(and(...conditions))
    .orderBy(desc(snipeSpecs.createdAt))
    .limit(100);
  return rows.map(toSpec);
}

export async function getSnipeSpec(id: number): Promise<SnipeSpec | null> {
  await ensureAppTables();
  const rows = await getDb()
    .select()
    .from(snipeSpecs)
    .where(eq(snipeSpecs.id, id))
    .limit(1);
  return rows.length ? toSpec(rows[0]) : null;
}

export async function deleteSnipeSpec(id: number): Promise<void> {
  await ensureAppTables();
  await getDb().delete(snipeSpecs).where(eq(snipeSpecs.id, id));
}
