import "server-only";
import { sampleMarket } from "@/lib/market/sampler";
import { runProbes } from "@/lib/market/probes";
import { runClassScan } from "@/lib/market/scanPipeline";
import { searchBases } from "@/lib/data";
import { getEligibleMods } from "@/lib/data/queries";
import { getPrices, refreshPricesNow } from "@/lib/pricing/poe2scout";
import { runIncrementalScan } from "@/lib/market/scanner";
import { runGem2120Batch } from "@/lib/market/gemCorruption";
import { getOpportunities } from "@/lib/market/opportunities";
import { saveScanResults } from "@/lib/market/scanResults";
import { parseRankMode } from "@/lib/market/profitPrefs";
import { scanSnipeSpec, scanSnipeTemplate } from "@/lib/market/snipes";
import { loadTabletCatalog } from "@/lib/tablets/catalog";
import { isRateLimitError } from "@/lib/tablets/logic";
import { formatWait, openTabletTrade, runTabletScanBatch, scopeCatalog } from "@/lib/tablets/scan";
import { getBasePriceResult, type BaseQuoteRequest } from "@/lib/trade/basePrice";
import { TradeApiError, TradeTimeoutError } from "@/lib/trade/client";
import { getTradeRateLimiter, TradeWaitError, type TradeCost } from "@/lib/trade/rateLimiter";
import { syncTradeStats } from "@/lib/trade/stats";
import {
  completeJob,
  enqueueJob,
  failDbJob,
  getJobRows,
  jobReporter,
  parseJobPayload,
  rescheduleJob,
  retryOrFailJob,
  summarizeChildren,
  type EnqueueJobOpts,
  type JobLane,
} from "@/lib/jobs/queue";
import type { MarketJobRow } from "@/db/schema";

/** A job that can never succeed as queued (bad payload, unknown kind). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Parent runs re-check their units this often. */
const PARENT_POLL_MS = 10_000;
/** A unit may wait this long inside its claim for budget; longer waits reschedule. */
const INLINE_WAIT_MS: Record<JobLane, number> = { interactive: 20_000, background: 12_000 };
/** Requests one unit of each kind sends, for the budget preflight. */
const UNIT_COST: Record<string, TradeCost> = {
  "scan:tablet": { search: 1, fetch: 1 },
  "scan:gems": { search: 1, fetch: 2 },
  "scan:class": { search: 1, fetch: 2 },
  "scan:quick": { search: 1, fetch: 2 },
  "sample:class": { search: 1, fetch: 2 },
  "probe:class": { search: 1, fetch: 1 },
  "snipe:scan": { search: 1, fetch: 2 },
  "quote:base": { search: 1, fetch: 1 },
  "trade:tablet-url": { search: 1 },
};
/** Confirm searches per tablet when a full scan fans out to every tablet. */
const FULL_SCAN_CONFIRMS_PER_TABLET = 4;
/** Confirm searches when the user scans a handful of tablets. */
const SCOPED_CONFIRMS_PER_TABLET = 10;

const loggedTradeLimits = new Set<number>();

function str(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  return typeof v === "string" ? v : "";
}

function required(payload: Record<string, unknown>, ...keys: string[]): void {
  const missing = keys.filter((k) => !str(payload, k));
  if (missing.length) throw new PermanentJobError(`Missing ${missing.join(", ")}`);
}

function strings(payload: Record<string, unknown>, key: string): string[] | undefined {
  const v = payload[key];
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length ? out : undefined;
}

/**
 * Reschedules the job to the moment the trade budget can run one unit of it,
 * instead of sleeping while holding the claim. Returns false when it did.
 */
async function preflight(job: MarketJobRow, payload: Record<string, unknown>): Promise<boolean> {
  const cost = UNIT_COST[job.kind];
  if (!cost || Array.isArray(payload.itemClasses)) return true;
  const lane = job.lane as JobLane;
  const { startInMs } = await getTradeRateLimiter().costWaitMs(cost, lane);
  if (startInMs <= INLINE_WAIT_MS[lane]) return true;
  await rescheduleJob(
    job.id,
    Date.now() + startInMs,
    `Waiting for trade rate limit — starts in ${formatWait(startInMs)}`,
  );
  return false;
}

/* ------------------------------ parent runs ------------------------------ */

interface ParentResult {
  childIds: string[];
}

async function fanOut(
  job: MarketJobRow,
  children: Omit<EnqueueJobOpts, "parentId" | "lane" | "priority">[],
  label: string,
): Promise<void> {
  const childIds: string[] = [];
  for (const child of children) {
    childIds.push(
      await enqueueJob({
        ...child,
        parentId: job.id,
        lane: job.lane as JobLane,
        priority: job.priority,
      }),
    );
  }
  await rescheduleJob(job.id, Date.now() + PARENT_POLL_MS, `Running ${childIds.length} ${label}…`, {
    result: { childIds } satisfies ParentResult,
    current: 0,
    total: childIds.length,
  });
}

/** Parent step: fan out on the first claim, then wait for every unit to finish. */
async function runParent(
  job: MarketJobRow,
  makeChildren: () => Promise<Omit<EnqueueJobOpts, "parentId" | "lane" | "priority">[]>,
  label: string,
): Promise<void> {
  const state = job.result ? (JSON.parse(job.result) as ParentResult) : null;
  if (!state?.childIds?.length) {
    const children = await makeChildren();
    if (children.length === 0) throw new PermanentJobError(`Nothing to scan`);
    await fanOut(job, children, label);
    return;
  }
  const rows = await getJobRows(state.childIds);
  const s = summarizeChildren(rows);
  const finished = s.done + s.error + s.cancelled;
  const missing = state.childIds.length - rows.length;
  if (finished + missing >= state.childIds.length) {
    const failed = s.error + s.cancelled;
    await completeJob(
      job.id,
      failed > 0
        ? `Done — ${s.done}/${state.childIds.length} ${label} finished, ${failed} failed or cancelled.`
        : `Done — all ${s.done} ${label} finished.`,
    );
    return;
  }
  const running = rows.find((r) => r.status === "running");
  const waiting = rows
    .filter((r) => r.status === "pending" && r.runAt > Date.now())
    .sort((a, b) => a.runAt - b.runAt)[0];
  const detail = running
    ? running.message
    : waiting
      ? `next check in ${formatWait(waiting.runAt - Date.now())}`
      : "waiting for the worker";
  const message = `${finished}/${state.childIds.length} ${label} done · ${detail}`;
  await rescheduleJob(job.id, Date.now() + PARENT_POLL_MS, message, {
    current: finished,
    total: state.childIds.length,
  });
}

/* -------------------------------- handlers ------------------------------- */

async function priceMapFor(league: string): Promise<Map<string, number>> {
  const data = await getPrices(league);
  const map = new Map(data.items.map((i) => [i.apiId, i.priceExalted]));
  if (data.divinePrice > 0) map.set("divine", data.divinePrice);
  map.set("exalted", 1);
  return map;
}

async function runTabletUnit(job: MarketJobRow, payload: Record<string, unknown>): Promise<void> {
  required(payload, "league", "tablet");
  const league = str(payload, "league");
  const tablet = str(payload, "tablet");
  const scanStartedAt = Number(payload.scanStartedAt ?? job.createdAt);
  const confirmBudget = Number(payload.confirmBudget ?? SCOPED_CONFIRMS_PER_TABLET);
  const report = jobReporter(job.id);
  const res = await runTabletScanBatch({
    league,
    scanStartedAt,
    tablets: [tablet],
    confirmBudget,
    onProgress: report,
  });

  const limiter = getTradeRateLimiter();
  const seen = (["search", "fetch"] as const)
    .map((p) => {
      const h = limiter.observedHeaders(p);
      return h ? `${p}: ${h}` : null;
    })
    .filter(Boolean)
    .join(" | ");
  if (seen && !loggedTradeLimits.has(scanStartedAt)) {
    loggedTradeLimits.add(scanStartedAt);
    report(`Trade limits seen — ${seen}`);
  }

  const { confirmed, thin } = res.counts;
  const counts = `${confirmed} confirmed · ${res.remaining} waiting · ${thin} too few listings`;
  if (res.stoppedForRateLimit) {
    const retryMs = Math.max(1000, res.rateLimitRetryMs ?? res.nextWaitMs);
    await rescheduleJob(
      job.id,
      Date.now() + retryMs,
      `${tablet}: trade limit reached — continuing in ${formatWait(retryMs)} · ${counts}`,
    );
  } else if (!res.done) {
    const waitMs = Math.max(1000, res.nextWaitMs);
    const status =
      waitMs > INLINE_WAIT_MS.background
        ? `pacing the trade budget, next check in ${formatWait(waitMs)}`
        : "checking prices";
    await rescheduleJob(job.id, Date.now() + waitMs, `${tablet}: ${status} · ${counts}`);
  } else if (res.budgetSpent && res.remaining > 0) {
    await completeJob(job.id, `${tablet}: done for this refresh — ${counts}`);
  } else {
    await completeJob(job.id, `${tablet}: done — ${counts}`);
  }
}

async function runGemScan(job: MarketJobRow, payload: Record<string, unknown>): Promise<void> {
  required(payload, "league");
  const league = str(payload, "league");
  const scanStartedAt = Number(payload.scanStartedAt ?? job.createdAt);
  const res = await runGem2120Batch({
    league,
    scanStartedAt,
    batchSize: 3,
    gemTypes: strings(payload, "gemTypes"),
    onProgress: jobReporter(job.id),
  });
  if (res.stoppedForRateLimit) {
    const retryMs = Math.min(15 * 60 * 1000, Math.max(8000, res.rateLimitRetryMs ?? 60_000));
    await rescheduleJob(
      job.id,
      Date.now() + retryMs,
      `Rate limited — ${res.priced}/${res.total} priced, retrying in ${formatWait(retryMs)}.`,
    );
  } else if (!res.done) {
    await rescheduleJob(job.id, Date.now() + 2000, `Priced ${res.priced}/${res.total} gems…`);
  } else {
    await completeJob(job.id, `Done — ${res.priced}/${res.total} gems priced.`);
  }
}

async function dispatch(job: MarketJobRow, payload: Record<string, unknown>): Promise<void> {
  const report = jobReporter(job.id);
  switch (job.kind) {
    case "sample:class": {
      required(payload, "league", "itemClass");
      const league = str(payload, "league");
      const itemClass = str(payload, "itemClass");
      report(`Sampling ${itemClass}…`);
      await getPrices(league).catch(() => null);
      const res = await sampleMarket({ league, itemClass });
      await completeJob(job.id, `Sampled ${res.inserted} listings for ${itemClass}.`);
      return;
    }
    case "probe:class": {
      required(payload, "league", "itemClass");
      const league = str(payload, "league");
      const itemClass = str(payload, "itemClass");
      const itemLevel = Number(payload.itemLevel ?? 82);
      report(`Probing ${itemClass}…`);
      await getPrices(league).catch(() => null);
      const bases = await searchBases({ itemClass, limit: 500 });
      const tagSet = new Set<string>();
      for (const b of bases) for (const t of b.tags) tagSet.add(t);
      const classMods = await getEligibleMods([...tagSet], itemLevel);
      const res = await runProbes({
        league,
        itemClass,
        classMods,
        maxProbes: Number(payload.maxProbes ?? 6),
        onProgress: report,
      });
      await completeJob(job.id, `Probed ${res.refreshed}/${res.candidates} combos.`);
      return;
    }
    case "scan:class": {
      required(payload, "league");
      const league = str(payload, "league");
      const classes = strings(payload, "itemClasses");
      if (classes && !str(payload, "itemClass")) {
        await runParent(
          job,
          async () =>
            classes.map((itemClass) => ({
              kind: "scan:class",
              payload: { ...payload, itemClasses: undefined, itemClass },
            })),
          "item classes",
        );
        return;
      }
      required(payload, "itemClass");
      const res = await runClassScan({
        league,
        itemClass: str(payload, "itemClass"),
        itemLevel: Number(payload.itemLevel ?? 82),
        maxProbes: Number(payload.maxProbes ?? 30),
        maxCombosToSolve: Number(payload.maxCombosToSolve ?? 20),
        forceSample: payload.forceSample === true,
        onProgress: report,
      });
      await completeJob(
        job.id,
        `Saved ${res.opportunitiesSaved} opportunities (${res.probesRun} probes).`,
      );
      return;
    }
    case "scan:gems":
      return runGemScan(job, payload);
    case "scan:tablets": {
      required(payload, "league");
      const league = str(payload, "league");
      const scanStartedAt = Number(payload.scanStartedAt ?? job.createdAt);
      const scoped = strings(payload, "tablets");
      await runParent(
        job,
        async () => {
          const catalog = scopeCatalog(await loadTabletCatalog(), scoped);
          const confirmBudget = scoped ? SCOPED_CONFIRMS_PER_TABLET : FULL_SCAN_CONFIRMS_PER_TABLET;
          return catalog.map((t) => ({
            kind: "scan:tablet",
            payload: { league, tablet: t.name, scanStartedAt, confirmBudget },
            message: `Queued ${t.name}…`,
          }));
        },
        "tablets",
      );
      return;
    }
    case "scan:tablet":
      return runTabletUnit(job, payload);
    case "refresh:prices": {
      required(payload, "league");
      report("Resolving league prices…", { stage: "league" });
      report("Fetching poe2scout categories…", { stage: "fetch" });
      await refreshPricesNow(str(payload, "league"));
      await completeJob(job.id, "Wrote price cache.");
      return;
    }
    case "scan:quick": {
      required(payload, "league", "itemClass");
      const itemClass = str(payload, "itemClass");
      report(`Quick sample for ${itemClass}…`, { stage: "sample" });
      const res = await runIncrementalScan({
        league: str(payload, "league"),
        itemClass,
        probeBudget: Number(payload.probeBudget ?? 3),
        quickSample: payload.quickSample !== false,
        onProgress: (text, opts) => report(text, { ...opts, stage: "probe" }),
      });
      await completeJob(
        job.id,
        `Done — probed ${res.probed} combos, added ${res.sampled} samples.`,
      );
      return;
    }
    case "rank:opportunities": {
      required(payload, "league", "itemClass");
      const league = str(payload, "league");
      const itemClass = str(payload, "itemClass");
      report(`Ranking craft opportunities for ${itemClass}…`);
      const result = await getOpportunities({
        league,
        itemClass,
        itemLevel: Number(payload.itemLevel ?? 82),
        baseId: str(payload, "baseId") || null,
        rankMode: parseRankMode(str(payload, "rankMode") || undefined),
        onProgress: report,
      });
      const tierGroupsByKey = new Map(result.opportunities.map((o) => [o.key, o.groups.join(",")]));
      const saved = await saveScanResults({
        league,
        itemClass,
        opportunities: result.opportunities,
        tierGroupsByKey,
      });
      await completeJob(job.id, `Done — ${saved} opportunities ranked.`, {
        saved,
        unmappedCombos: result.unmappedCombos,
      });
      return;
    }
    case "snipe:scan": {
      required(payload, "league");
      const league = str(payload, "league");
      const maxListings = Number(payload.maxListings ?? 10);
      const specId = Number(payload.specId);
      const scan = Number.isFinite(specId)
        ? await scanSnipeSpec({ league, specId, maxListings, onProgress: report })
        : await scanSnipeTemplate({
            league,
            templateId: str(payload, "templateId"),
            itemClass: str(payload, "itemClass"),
            maxListings,
            onProgress: report,
          });
      if (!scan) throw new PermanentJobError("Unknown template or spec.");
      await completeJob(
        job.id,
        `Done — ${scan.results.length} listings evaluated (${scan.total} matched online).`,
        { scan },
      );
      return;
    }
    case "trade:tablet-url": {
      required(payload, "rowId");
      report("Searching trade for this combination…");
      const tradeUrl = await openTabletTrade(str(payload, "rowId"));
      await completeJob(job.id, "Trade search ready.", { tradeUrl });
      return;
    }
    case "quote:base": {
      required(payload, "league", "baseType");
      const req = payload as unknown as BaseQuoteRequest;
      report(`Pricing ${req.baseType} bases…`);
      const { quote } = await getBasePriceResult({ ...req, priceMap: await priceMapFor(req.league) });
      await completeJob(
        job.id,
        quote ? `${req.baseType}: ${quote.priceExalted.toFixed(1)} ex` : `${req.baseType}: no priced listings`,
        { quote },
      );
      return;
    }
    case "sync:trade-stats": {
      const count = await syncTradeStats();
      await completeJob(job.id, `Synced ${count} trade stats.`);
      return;
    }
    default:
      throw new PermanentJobError(`Unknown job kind: ${job.kind}`);
  }
}

type Failure = "rate" | "transient" | "permanent";

export function classifyJobError(err: unknown): Failure {
  if (err instanceof PermanentJobError) return "permanent";
  if (err instanceof TradeWaitError) return "rate";
  if (err instanceof TradeApiError) {
    if (err.status === 429) return "rate";
    if (err.status != null && err.status >= 400 && err.status < 500) return "permanent";
    return "transient";
  }
  if (isRateLimitError(err)) return "rate";
  if (err instanceof TradeTimeoutError) return "transient";
  return "transient";
}

export async function handleMarketJob(job: MarketJobRow): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = parseJobPayload<Record<string, unknown>>(job);
  } catch {
    await failDbJob(job.id, "Malformed job payload");
    return;
  }

  try {
    if (!(await preflight(job, payload))) return;
    await dispatch(job, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed";
    const kind = classifyJobError(err);
    if (kind === "rate") {
      const retryAfterMs = (err as { retryAfterMs?: number }).retryAfterMs ?? 0;
      const retryMs = Math.max(
        15_000,
        retryAfterMs,
        await getTradeRateLimiter().waitMs("search", job.lane as JobLane),
      );
      await rescheduleJob(
        job.id,
        Date.now() + retryMs,
        `Trade rate limit — retrying in ${formatWait(retryMs)}.`,
      );
      return;
    }
    if (kind === "permanent") {
      await failDbJob(job.id, message);
      return;
    }
    await retryOrFailJob(job.id, message);
  }
}
