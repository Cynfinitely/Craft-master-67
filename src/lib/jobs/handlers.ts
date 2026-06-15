import "server-only";
import { sampleMarket } from "@/lib/market/sampler";
import { runProbes } from "@/lib/market/probes";
import { runClassScan } from "@/lib/market/scanPipeline";
import { searchBases } from "@/lib/data";
import { getEligibleMods } from "@/lib/data/queries";
import { getPrices } from "@/lib/pricing/poe2scout";
import {
  completeJob,
  failDbJob,
  jobReporter,
  parseJobPayload,
  rescheduleJob,
} from "@/lib/jobs/queue";
import type { MarketJobRow } from "@/db/schema";

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
      default:
        throw new Error(`Unknown job kind: ${job.kind}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed";
    if (message.includes("rate-limited") || message.includes("429")) {
      await rescheduleJob(
        job.id,
        Date.now() + 15 * 60 * 1000,
        `Rate limited — retrying in 15 minutes.`,
      );
      return;
    }
    await failDbJob(job.id, message);
  }
}
