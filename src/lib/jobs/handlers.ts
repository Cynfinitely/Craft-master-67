import "server-only";
import { sampleMarket } from "@/lib/market/sampler";
import { runProbes } from "@/lib/market/probes";
import { runClassScan } from "@/lib/market/scanPipeline";
import { searchBases } from "@/lib/data";
import { getEligibleMods } from "@/lib/data/queries";
import { getPrices } from "@/lib/pricing/poe2scout";
import { runGem2120Batch } from "@/lib/market/gemCorruption";
import { formatWait, runTabletScanBatch } from "@/lib/tablets/scan";
import { TradeApiError } from "@/lib/trade/client";
import { getTradeRateLimiter } from "@/lib/trade/rateLimiter";
import {
  completeJob,
  failDbJob,
  jobReporter,
  parseJobPayload,
  rescheduleJob,
} from "@/lib/jobs/queue";
import type { MarketJobRow } from "@/db/schema";

const loggedTradeLimits = new Set<number>();

export async function handleMarketJob(job: MarketJobRow): Promise<void> {
  const report = jobReporter(job.id);
  const payload = parseJobPayload<Record<string, unknown>>(job);

  try {
    switch (job.kind) {
      case "sample:class": {
        const league = String(payload.league ?? "");
        const itemClass = String(payload.itemClass ?? "");
        if (!league || !itemClass) throw new Error("Missing league or itemClass");
        report(`Sampling ${itemClass}…`);
        await getPrices(league).catch(() => null);
        const res = await sampleMarket({ league, itemClass });
        await completeJob(
          job.id,
          `Sampled ${res.inserted} listings for ${itemClass}.`,
        );
        return;
      }
      case "probe:class": {
        const league = String(payload.league ?? "");
        const itemClass = String(payload.itemClass ?? "");
        const itemLevel = Number(payload.itemLevel ?? 82);
        const maxProbes = Number(payload.maxProbes ?? 6);
        if (!league || !itemClass) throw new Error("Missing league or itemClass");
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
          maxProbes,
          onProgress: report,
        });
        await completeJob(
          job.id,
          `Probed ${res.refreshed}/${res.candidates} combos.`,
        );
        return;
      }
      case "scan:class": {
        const league = String(payload.league ?? "");
        const itemClass = String(payload.itemClass ?? "");
        const itemLevel = Number(payload.itemLevel ?? 82);
        const maxProbes = Number(payload.maxProbes ?? 30);
        const maxCombosToSolve = Number(payload.maxCombosToSolve ?? 20);
        if (!league || !itemClass) throw new Error("Missing league or itemClass");
        const res = await runClassScan({
          league,
          itemClass,
          itemLevel,
          maxProbes,
          maxCombosToSolve,
          forceSample: payload.forceSample === true,
          onProgress: report,
        });
        await completeJob(
          job.id,
          `Saved ${res.opportunitiesSaved} opportunities (${res.probesRun} probes).`,
        );
        return;
      }
      case "scan:gems": {
        const league = String(payload.league ?? "");
        if (!league) throw new Error("Missing league");
        const scanStartedAt = Number(payload.scanStartedAt ?? Date.now());
        report(`Scanning 21/20 gem floors for ${league}…`);
        await getPrices(league).catch(() => null);

        const MAX_BATCHES_PER_CLAIM = 1;
        let batches = 0;
        let res = await runGem2120Batch({
          league,
          scanStartedAt,
          batchSize: 3,
          onProgress: report,
        });
        batches += 1;

        while (
          !res.done &&
          !res.stoppedForRateLimit &&
          batches < MAX_BATCHES_PER_CLAIM
        ) {
          res = await runGem2120Batch({
            league,
            scanStartedAt,
            batchSize: 3,
            onProgress: report,
          });
          batches += 1;
        }

        if (res.stoppedForRateLimit) {
          const retryMs = Math.min(
            15 * 60 * 1000,
            Math.max(8000, res.rateLimitRetryMs ?? 60_000),
          );
          const retrySec = Math.round(retryMs / 1000);
          await rescheduleJob(
            job.id,
            Date.now() + retryMs,
            `Rate limited — ${res.priced}/${res.total} priced, retrying in ${retrySec}s.`,
          );
        } else if (!res.done) {
          await rescheduleJob(
            job.id,
            Date.now() + 8000,
            `Priced ${res.priced}/${res.total} gems…`,
          );
        } else {
          await completeJob(
            job.id,
            `Done — ${res.priced}/${res.total} gems priced.`,
          );
        }
        return;
      }
      case "scan:tablets": {
        const league = String(payload.league ?? "");
        if (!league) throw new Error("Missing league");
        const scanStartedAt = Number(payload.scanStartedAt ?? Date.now());
        const res = await runTabletScanBatch({
          league,
          scanStartedAt,
          onProgress: report,
        });

        const limiter = getTradeRateLimiter();
        const seen = ["search", "fetch"]
          .map((p) => {
            const h = limiter.observedHeaders(p as "search" | "fetch");
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
            `Trade limit reached — continuing in ${formatWait(retryMs)} · ${counts}`,
          );
        } else if (!res.done) {
          const waitMs = Math.max(1000, res.nextWaitMs);
          await rescheduleJob(job.id, Date.now() + waitMs, `Checking prices · ${counts}`);
        } else if (res.budgetSpent && res.remaining > 0) {
          await completeJob(
            job.id,
            `Priced ${confirmed} · ${res.remaining} left — refresh again later`,
          );
        } else {
          await completeJob(job.id, `Done — ${counts}`);
        }
        return;
      }
      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed";
    if (message.includes("rate-limited") || message.includes("429")) {
      const retryAfterMs = (err as { retryAfterMs?: number }).retryAfterMs;
      const retryMs =
        err instanceof TradeApiError || retryAfterMs
          ? Math.max(60_000, retryAfterMs ?? 0, await getTradeRateLimiter().waitMs("search"))
          : 60_000;
      const retrySec = Math.round(retryMs / 1000);
      await rescheduleJob(
        job.id,
        Date.now() + retryMs,
        `Rate limited — retrying in ${retrySec}s.`,
      );
      return;
    }
    await failDbJob(job.id, message);
  }
}
