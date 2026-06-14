import "server-only";
import { randomUUID } from "crypto";
import { getClient } from "@/db";
import { ensureAppTables } from "@/db/ensure";
import { scanJobs } from "@/db/schema";
import { getComboStats } from "./analytics";
import { sampleMarket } from "./sampler";
import { comboKeyFromGroups, getProbes, probeCombo } from "./probes";
import { buildModStatMap } from "@/lib/trade/modMap";
import { getEligibleMods, searchBases } from "@/lib/data/queries";
import { modLabel } from "@/lib/data/format";
import type { ProgressReporter } from "@/lib/progress";

const SAMPLE_STALE_MS = 6 * 60 * 60 * 1000;
const PROBE_STALE_MS = 24 * 60 * 60 * 1000;
/** Each probe ≈ 1 trade search. Kept low for quick scans. */
const DEFAULT_PROBE_BUDGET = 3;

export interface ScanResult {
  jobId: string;
  probed: number;
  sampled: number;
  itemClass: string;
}

async function isSampleStale(
  league: string,
  itemClass: string,
): Promise<boolean> {
  const { getSampleSummary } = await import("./analytics");
  const summary = await getSampleSummary({ league, itemClass });
  if (summary.sampleCount === 0) return true;
  if (!summary.newestFetchedAt) return true;
  return Date.now() - summary.newestFetchedAt > SAMPLE_STALE_MS;
}

/**
 * Incremental market scan: refresh samples when stale, probe top unprobed combos.
 */
export async function runIncrementalScan(opts: {
  league: string;
  itemClass: string;
  probeBudget?: number;
  /** Single sample pass instead of three (faster scan). */
  quickSample?: boolean;
  onProgress?: ProgressReporter;
}): Promise<ScanResult> {
  await ensureAppTables();
  const report = opts.onProgress ?? (() => {});
  const jobId = randomUUID();
  const startedAt = Date.now();
  const db = getClient();
  const probeBudget = opts.probeBudget ?? DEFAULT_PROBE_BUDGET;

  await db.execute({
    sql: `INSERT INTO scan_jobs (id, league, item_class, status, started_at) VALUES (?, ?, ?, 'running', ?)`,
    args: [jobId, opts.league, opts.itemClass, startedAt],
  });

  let probed = 0;
  let sampled = 0;

  try {
    if (await isSampleStale(opts.league, opts.itemClass)) {
      report(`Sampling ${opts.itemClass} listings…`);
      const sampleResult = await sampleMarket({
        league: opts.league,
        itemClass: opts.itemClass,
        quick: opts.quickSample,
        onProgress: report,
      });
      sampled = sampleResult.inserted;
    }

    report(`Finding combos to probe for ${opts.itemClass}…`);
    const combosBySize = await getComboStats({
      league: opts.league,
      itemClass: opts.itemClass,
      sizes: [2, 3, 4],
      minCount: 2,
      limitPerSize: 10,
    });

    const bases = await searchBases({ itemClass: opts.itemClass, limit: 500 });
    const tagSet = new Set<string>();
    for (const b of bases) for (const t of b.tags) tagSet.add(t);
    const mods = await getEligibleMods([...tagSet], 82);
    const statMap = await buildModStatMap(mods);

    const existing = await getProbes(opts.league, opts.itemClass);
    const probedKeys = new Set(existing.map((p) => p.comboKey));
    const now = Date.now();

    const candidates: { groups: string[]; median: number }[] = [];
    for (const combos of combosBySize.values()) {
      for (const c of combos) {
        const groups: string[] = [];
        let ok = true;
        for (const id of c.statIds) {
          const g = statMap.statToGroups.get(id)?.[0];
          if (!g) {
            ok = false;
            break;
          }
          if (!groups.includes(g)) groups.push(g);
        }
        if (!ok || groups.length === 0) continue;
        const keyResult = comboKeyFromGroups(groups, statMap.groupToStats);
        if (!keyResult) continue;
        const stale =
          existing.find((p) => p.comboKey === keyResult.key)?.fetchedAt ??
          0;
        if (
          probedKeys.has(keyResult.key) &&
          now - stale < PROBE_STALE_MS
        ) {
          continue;
        }
        candidates.push({ groups, median: c.medianExalted });
      }
    }

    candidates.sort((a, b) => b.median - a.median);

    const toProbe = candidates.slice(0, probeBudget);
    if (toProbe.length === 0) {
      report("No new combos need probing — sample/probe data is fresh.", {
        current: 1,
        total: 1,
      });
    }

    for (let i = 0; i < toProbe.length; i++) {
      const cand = toProbe[i];
      report(
        `Probing combo ${i + 1}/${toProbe.length} (${cand.groups.length} mods)…`,
        { current: i, total: toProbe.length },
      );
      try {
        const keyResult = comboKeyFromGroups(cand.groups, statMap.groupToStats);
        if (!keyResult) continue;
        const labels = cand.groups.map((g) => {
          const mod = mods.find((m) => (m.groups[0] ?? m.id) === g);
          return mod ? modLabel(mod) : g;
        });
        await probeCombo({
          league: opts.league,
          itemClass: opts.itemClass,
          groups: cand.groups,
          labels,
          statIds: keyResult.statIds,
          skipVelocity: true,
        });
        probed++;
        report(`Probed combo ${i + 1}/${toProbe.length}.`, {
          current: i + 1,
          total: toProbe.length,
        });
      } catch {
        report(
          `Probe ${i + 1}/${toProbe.length} stopped (rate limit) — saved ${probed} so far.`,
          { current: i + 1, total: toProbe.length },
        );
        break;
      }
    }

    await db.execute({
      sql: `UPDATE scan_jobs SET status = 'done', combos_probed = ?, samples_added = ?, finished_at = ? WHERE id = ?`,
      args: [probed, sampled, Date.now(), jobId],
    });

    return { jobId, probed, sampled, itemClass: opts.itemClass };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    await db.execute({
      sql: `UPDATE scan_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
      args: [message, Date.now(), jobId],
    });
    throw err;
  }
}

export { scanJobs };
