import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { bases, mods, modSpawnWeights, type SpawnWeightRow } from "@/db/schema";
import {
  buildTabletCatalog,
  type RawTabletBase,
  type RawTabletMod,
  type TabletCatalogEntry,
} from "./logic";

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Released precursor tablets and the prefixes/suffixes each one can roll. */
export async function loadTabletCatalog(): Promise<TabletCatalogEntry[]> {
  const db = getDb();
  const baseRows = await db
    .select()
    .from(bases)
    .where(and(eq(bases.domain, "tablet"), eq(bases.releaseState, "released")));

  const modRows = await db.select().from(mods).where(eq(mods.domain, "tablet"));
  if (modRows.length === 0 || baseRows.length === 0) return [];

  const modIds = modRows.map((m) => m.id);
  const weightRows: SpawnWeightRow[] = [];
  for (let i = 0; i < modIds.length; i += 400) {
    const chunk = modIds.slice(i, i + 400);
    weightRows.push(
      ...(await db
        .select()
        .from(modSpawnWeights)
        .where(inArray(modSpawnWeights.modId, chunk))),
    );
  }
  const weightsByMod = new Map<string, { tag: string; weight: number; ord: number }[]>();
  for (const w of weightRows) {
    const list = weightsByMod.get(w.modId) ?? [];
    list.push({ tag: w.tag, weight: w.weight, ord: w.ord });
    weightsByMod.set(w.modId, list);
  }

  const rawBases: RawTabletBase[] = baseRows.map((b) => ({
    id: b.id,
    name: b.name,
    tags: parseJson<string[]>(b.tags, []),
    releaseState: b.releaseState,
    domain: b.domain,
    itemClass: b.itemClass,
  }));

  const rawMods: RawTabletMod[] = modRows.map((m) => {
    const weights = (weightsByMod.get(m.id) ?? [])
      .sort((a, b) => a.ord - b.ord)
      .map(({ tag, weight }) => ({ tag, weight }));
    return {
      id: m.id,
      name: m.name,
      generationType: m.generationType,
      text: m.text,
      groups: parseJson<string[]>(m.groups, []),
      requiredLevel: m.requiredLevel,
      spawnWeights: weights,
    };
  });

  return buildTabletCatalog(rawBases, rawMods);
}
