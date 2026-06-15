import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { marketScanResults } from "@/db/schema";
import type { Opportunity } from "./opportunities";
import { passesGoodSampleGate } from "./candidates";
import { buildBasePlanHref } from "./craftLinks";

export interface ScanSummary {
  league: string;
  itemClass: string;
  resultCount: number;
  lastScannedAt: number | null;
  newestScannedAt: number | null;
}

function scanResultId(
  league: string,
  itemClass: string,
  comboKey: string,
): string {
  return `${league}|${itemClass}|${comboKey}`;
}

export async function saveScanResults(opts: {
  league: string;
  itemClass: string;
  opportunities: Opportunity[];
  tierGroupsByKey: Map<string, string>;
  scannedAt?: number;
}): Promise<number> {
  await ensureAppTables();
  const db = getDb();
  const scannedAt = opts.scannedAt ?? Date.now();

  await db
    .delete(marketScanResults)
    .where(
      and(
        eq(marketScanResults.league, opts.league),
        eq(marketScanResults.itemClass, opts.itemClass),
      ),
    );

  let saved = 0;
  for (const o of opts.opportunities) {
    if (
      !passesGoodSampleGate({
        listingCount: o.supply,
        recentCount: o.velocity,
        sellThroughPerDay: o.sellThroughPerDay,
        sampleCount: o.sampleCount,
        saleSource: o.saleSource,
      }) &&
      o.confidence === "low"
    ) {
      continue;
    }
    const tierGroups =
      opts.tierGroupsByKey.get(o.key) ?? o.groups.join(",");
    await db.insert(marketScanResults).values({
      id: scanResultId(opts.league, opts.itemClass, o.key),
      league: opts.league,
      itemClass: opts.itemClass,
      comboKey: o.key,
      groups: JSON.stringify(o.groups),
      tierGroups,
      payload: JSON.stringify(o),
      confidence: o.confidence,
      profitP50Exalted: o.profitP50Exalted,
      scannedAt,
      baseId: o.baseId,
    });
    saved++;
  }
  return saved;
}

export async function getStoredOpportunities(opts: {
  league: string;
  itemClass: string;
  limit?: number;
}): Promise<{ opportunities: Opportunity[]; summary: ScanSummary }> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(marketScanResults)
    .where(
      and(
        eq(marketScanResults.league, opts.league),
        eq(marketScanResults.itemClass, opts.itemClass),
      ),
    )
    .orderBy(desc(marketScanResults.profitP50Exalted))
    .limit(opts.limit ?? 50);

  const opportunities = rows.map((r) => {
    const o = JSON.parse(r.payload) as Opportunity;
    const itemLevel = 82;
    return {
      ...o,
      craftHref: buildBasePlanHref({
        itemClass: r.itemClass,
        baseId: o.baseId,
        itemLevel,
        groups: o.groups,
        minLevelPerGroup: parseTierGroups(r.tierGroups),
      }),
      massHref: `/craft?mode=mass&class=${encodeURIComponent(r.itemClass)}&ilvl=${itemLevel}&base=${encodeURIComponent(o.baseId)}&groups=${encodeURIComponent(r.tierGroups)}&method=${o.methodId}&n=${o.basesCount}`,
    };
  });
  const times = rows.map((r) => r.scannedAt);
  return {
    opportunities,
    summary: {
      league: opts.league,
      itemClass: opts.itemClass,
      resultCount: rows.length,
      lastScannedAt: times.length ? Math.min(...times) : null,
      newestScannedAt: times.length ? Math.max(...times) : null,
    },
  };
}

export async function getScanSummary(opts: {
  league: string;
  itemClass: string;
}): Promise<ScanSummary> {
  await ensureAppTables();
  const db = getDb();
  const rows = await db
    .select()
    .from(marketScanResults)
    .where(
      and(
        eq(marketScanResults.league, opts.league),
        eq(marketScanResults.itemClass, opts.itemClass),
      ),
    )
    .orderBy(desc(marketScanResults.scannedAt))
    .limit(100);

  const times = rows.map((r) => r.scannedAt);
  return {
    league: opts.league,
    itemClass: opts.itemClass,
    resultCount: rows.length,
    lastScannedAt: times.length ? Math.min(...times) : null,
    newestScannedAt: times.length ? Math.max(...times) : null,
  };
}

function parseTierGroups(encoded: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of encoded.split(",")) {
    const at = part.indexOf("@");
    if (at > 0) {
      const level = Number.parseInt(part.slice(at + 1), 10);
      if (Number.isFinite(level)) out[part.slice(0, at)] = level;
    }
  }
  return out;
}
