import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { bases, favorites, savedPlans } from "@/db/schema";
import type { CraftPlan } from "@/lib/solver/types";

export interface SavedPlanSummary {
  id: number;
  name: string;
  baseId: string | null;
  createdAt: number;
  plan: CraftPlan;
}

export async function createSavedPlan(
  name: string,
  baseId: string | null,
  plan: CraftPlan,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .insert(savedPlans)
    .values({
      name,
      baseId,
      payload: JSON.stringify(plan),
      createdAt: Date.now(),
    })
    .returning({ id: savedPlans.id });
  return rows[0]?.id ?? -1;
}

export async function listSavedPlans(): Promise<SavedPlanSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedPlans)
    .orderBy(desc(savedPlans.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    baseId: r.baseId,
    createdAt: r.createdAt,
    plan: JSON.parse(r.payload) as CraftPlan,
  }));
}

export async function deleteSavedPlan(id: number): Promise<void> {
  const db = getDb();
  await db.delete(savedPlans).where(eq(savedPlans.id, id));
}

/* ----------------------------- favorites ----------------------------- */

export interface FavoriteSummary {
  baseId: string;
  name: string;
  itemClass: string;
  createdAt: number;
}

export async function isFavorite(baseId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ baseId: favorites.baseId })
    .from(favorites)
    .where(eq(favorites.baseId, baseId))
    .limit(1);
  return rows.length > 0;
}

/** Toggles a favorite and returns the resulting state. */
export async function toggleFavorite(baseId: string): Promise<boolean> {
  const db = getDb();
  const exists = await isFavorite(baseId);
  if (exists) {
    await db.delete(favorites).where(eq(favorites.baseId, baseId));
    return false;
  }
  await db
    .insert(favorites)
    .values({ baseId, createdAt: Date.now() })
    .onConflictDoNothing();
  return true;
}

export async function listFavorites(): Promise<FavoriteSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      baseId: favorites.baseId,
      createdAt: favorites.createdAt,
      name: bases.name,
      itemClass: bases.itemClass,
    })
    .from(favorites)
    .leftJoin(bases, eq(favorites.baseId, bases.id))
    .orderBy(desc(favorites.createdAt));
  return rows.map((r) => ({
    baseId: r.baseId,
    name: r.name ?? r.baseId,
    itemClass: r.itemClass ?? "",
    createdAt: r.createdAt,
  }));
}
