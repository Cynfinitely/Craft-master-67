import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { manualSales, type ManualSaleRow } from "@/db/schema";

/**
 * Manually-entered sale records — the fallback path when the trade API is
 * unreachable, and a way to record items you actually sold.
 */

export interface ManualSale {
  id: number;
  league: string;
  itemClass: string | null;
  baseType: string;
  ilvl: number | null;
  priceExalted: number;
  /** Mod-group ids (or free-text mod labels) on the sold item. */
  groups: string[];
  note: string | null;
  createdAt: number;
}

function toManualSale(row: ManualSaleRow): ManualSale {
  let groups: string[] = [];
  try {
    groups = JSON.parse(row.groups) as string[];
  } catch {
    /* keep [] */
  }
  return {
    id: row.id,
    league: row.league,
    itemClass: row.itemClass,
    baseType: row.baseType,
    ilvl: row.ilvl,
    priceExalted: row.priceExalted,
    groups,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export async function addManualSale(sale: {
  league: string;
  itemClass?: string | null;
  baseType: string;
  ilvl?: number | null;
  priceExalted: number;
  groups: string[];
  note?: string | null;
}): Promise<ManualSale> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .insert(manualSales)
    .values({
      league: sale.league,
      itemClass: sale.itemClass ?? null,
      baseType: sale.baseType,
      ilvl: sale.ilvl ?? null,
      priceExalted: sale.priceExalted,
      groups: JSON.stringify(sale.groups),
      note: sale.note ?? null,
      createdAt: Date.now(),
    })
    .returning();
  return toManualSale(rows[0]);
}

export async function listManualSales(league: string): Promise<ManualSale[]> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(manualSales)
    .where(eq(manualSales.league, league))
    .orderBy(desc(manualSales.createdAt))
    .limit(200);
  return rows.map(toManualSale);
}

export async function deleteManualSale(id: number): Promise<void> {
  await ensureAppTables();
  await getDb().delete(manualSales).where(eq(manualSales.id, id));
}
