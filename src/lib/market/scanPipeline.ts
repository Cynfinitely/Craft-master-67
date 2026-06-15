import "server-only";
import { searchBases } from "@/lib/data";
import { getEligibleMods } from "@/lib/data/queries";
import { getPrices } from "@/lib/pricing/poe2scout";
import { getSampleSummary } from "./analytics";
import { buildTierCandidates } from "./candidates";
import { computeOpportunities } from "./opportunities";
import { probeCombo } from "./probes";
import { sampleMarket } from "./sampler";
import { saveScanResults } from "./scanResults";

const SAMPLE_STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_PROBES = 30;
const DEFAULT_MAX_COMBOS = 20;

export interface ClassScanOpts {
  league: string;
  itemClass: string;
  itemLevel?: number;
  maxProbes?: number;
  maxCombosToSolve?: number;
  forceSample?: boolean;
  onProgress?: (
    text: string,
    o?: { current?: number; total?: number },
  ) => void;
}

export interface ClassScanResult {
  opportunitiesSaved: number;
  probesRun: number;
  sampled: boolean;
  candidates: number;
}

export async function runClassScan(
  opts: ClassScanOpts,
): Promise<ClassScanResult> {
  const report = opts.onProgress ?? (() => {});
  const itemLevel = opts.itemLevel ?? 82;
  const maxProbes = opts.maxProbes ?? DEFAULT_MAX_PROBES;
  const maxCombos = opts.maxCombosToSolve ?? DEFAULT_MAX_COMBOS;

  report(`Starting deep scan for ${opts.itemClass}…`);

  const summary = await getSampleSummary({
    league: opts.league,
    itemClass: opts.itemClass,
  });
  const sampleStale =
    !summary.newestFetchedAt ||
    Date.now() - summary.newestFetchedAt > SAMPLE_STALE_MS;
  let sampled = false;
  if (sampleStale || opts.forceSample) {
    report("Sampling live listings (stale or missing data)…");
    await getPrices(opts.league).catch(() => null);
    await sampleMarket({ league: opts.league, itemClass: opts.itemClass });
    sampled = true;
  }

  report("Building tier-aware combo candidates…");
  const bases = await searchBases({ itemClass: opts.itemClass, limit: 500 });
  const tagSet = new Set<string>();
  for (const b of bases) for (const t of b.tags) tagSet.add(t);
  const classMods = await getEligibleMods([...tagSet], itemLevel);

  const candidates = await buildTierCandidates({
    league: opts.league,
    itemClass: opts.itemClass,
    classMods,
  });
  report(`${candidates.length} tier candidates enumerated.`);

  let probesRun = 0;
  const tierGroupsByKey = new Map<string, string>();
  for (const c of candidates) {
    tierGroupsByKey.set(c.key, c.tierGroupsEncoded);
  }

  const toProbe = candidates.slice(0, maxProbes);
  for (let i = 0; i < toProbe.length; i++) {
    const c = toProbe[i];
    report(`Probing (${i + 1}/${toProbe.length}): ${c.labels.join(" + ")}…`, {
      current: i,
      total: toProbe.length,
    });
    try {
      await probeCombo({
        league: opts.league,
        itemClass: opts.itemClass,
        groups: c.groups,
        labels: c.labels,
        statIds: c.statIds,
        statMins: c.statMins,
      });
      probesRun++;
    } catch (err) {
      if (isRateLimitError(err)) {
        report("Rate limited — stopping probe batch early.");
        break;
      }
    }
  }

  report("Simulating craft opportunities…");
  const { opportunities } = await computeOpportunities({
    league: opts.league,
    itemClass: opts.itemClass,
    itemLevel,
    maxCombosToSolve: maxCombos,
    probeVerifyBudget: Math.min(10, maxProbes),
    onProgress: report,
  });

  for (const o of opportunities) {
    if (!tierGroupsByKey.has(o.key)) {
      tierGroupsByKey.set(o.key, o.groups.join(","));
    }
  }

  report(`Persisting ${opportunities.length} ranked opportunities…`);
  const opportunitiesSaved = await saveScanResults({
    league: opts.league,
    itemClass: opts.itemClass,
    opportunities,
    tierGroupsByKey,
  });

  report(
    `Scan complete — ${opportunitiesSaved} opportunities saved (${probesRun} probes, sampled=${sampled}).`,
  );

  return {
    opportunitiesSaved,
    probesRun,
    sampled,
    candidates: candidates.length,
  };
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("rate-limited") || err.message.includes("429");
  }
  return false;
}
