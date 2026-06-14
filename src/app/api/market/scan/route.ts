import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import { runIncrementalScan } from "@/lib/market/scanner";
import { failJob, finishJob, reporterFor, startJob } from "@/lib/progress";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  itemClass: z.string().min(1),
  league: z.string().min(1).optional(),
  probeBudget: z.number().int().min(1).max(10).optional(),
  quickSample: z.boolean().optional(),
  progressId: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  let progressId: string | undefined;
  try {
    const body = bodySchema.parse(await request.json());
    progressId = body.progressId;
    if (progressId) {
      startJob(progressId, "scan", "Starting market scan…");
    }
    const report = progressId ? reporterFor(progressId) : () => {};

    const league = body.league ?? (await getCurrentLeagueName());
    const result = await runIncrementalScan({
      league,
      itemClass: body.itemClass,
      probeBudget: body.probeBudget,
      quickSample: body.quickSample,
      onProgress: report,
    });

    if (progressId) {
      finishJob(
        progressId,
        `Done — probed ${result.probed} combos, added ${result.sampled} samples.`,
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    if (progressId) failJob(progressId, message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
