import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { searchBases } from "@/lib/data";
import { getEligibleMods } from "@/lib/data/queries";
import { runProbes } from "@/lib/market/probes";
import { failJob, finishJob, reporterFor, startJob } from "@/lib/progress";

export const dynamic = "force-dynamic";
// Each probe is ~2 rate-limited trade calls; allow time for the budgeted run.
export const maxDuration = 120;

const bodySchema = z.object({
  itemClass: z.string().min(1),
  league: z.string().min(1).optional(),
  itemLevel: z.number().int().min(1).max(100).optional(),
  maxProbes: z.number().int().min(1).max(20).optional(),
  /** Client-generated id for live progress polling. */
  progressId: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  let progressId: string | undefined;
  try {
    const body = bodySchema.parse(await request.json());
    progressId = body.progressId;
    if (progressId) {
      startJob(progressId, "probe", "Starting combo probes…");
    }
    const report = progressId ? reporterFor(progressId) : () => {};

    const league = body.league ?? (await getCurrentLeagueName());
    // Warm the currency price cache so asks convert to Exalted.
    report("Refreshing currency prices…");
    await getPrices(league).catch(() => null);

    const bases = await searchBases({ itemClass: body.itemClass, limit: 500 });
    const tagSet = new Set<string>();
    for (const b of bases) for (const t of b.tags) tagSet.add(t);
    const classMods = await getEligibleMods([...tagSet], body.itemLevel ?? 82);

    const result = await runProbes({
      league,
      itemClass: body.itemClass,
      classMods,
      maxProbes: body.maxProbes,
      onProgress: report,
    });
    if (progressId) {
      finishJob(
        progressId,
        `Done — refreshed ${result.refreshed} of ${result.candidates} candidate combos (${result.probes.length} stored).`,
      );
    }
    return NextResponse.json({
      league,
      itemClass: body.itemClass,
      refreshed: result.refreshed,
      candidates: result.candidates,
      probeCount: result.probes.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Probing failed";
    if (progressId) failJob(progressId, message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
