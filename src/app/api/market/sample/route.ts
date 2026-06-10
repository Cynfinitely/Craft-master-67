import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { sampleMarket } from "@/lib/market/sampler";
import { failJob, finishJob, reporterFor, startJob } from "@/lib/progress";

export const dynamic = "force-dynamic";
// Sampling does several rate-limited trade calls; allow time for them.
export const maxDuration = 120;

const bodySchema = z.object({
  itemClass: z.string().min(1),
  baseType: z.string().min(1).optional(),
  league: z.string().min(1).optional(),
  ilvlMin: z.number().int().min(1).max(100).optional(),
  /** Client-generated id for live progress polling. */
  progressId: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  let progressId: string | undefined;
  try {
    const body = bodySchema.parse(await request.json());
    progressId = body.progressId;
    if (progressId) {
      startJob(progressId, "sample", "Starting market sampling…");
    }
    const report = progressId ? reporterFor(progressId) : () => {};

    const league = body.league ?? (await getCurrentLeagueName());
    // Warm the currency price cache so listing prices convert to Exalted.
    report("Refreshing currency prices…");
    await getPrices(league).catch(() => null);
    const result = await sampleMarket({
      league,
      itemClass: body.itemClass,
      baseType: body.baseType,
      ilvlMin: body.ilvlMin,
      onProgress: report,
    });
    if (progressId) {
      finishJob(
        progressId,
        `Done — stored ${result.inserted} samples from ${result.fetched} fetched listings.`,
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sampling failed";
    if (progressId) failJob(progressId, message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
