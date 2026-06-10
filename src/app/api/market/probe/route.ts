import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { searchBases } from "@/lib/data";
import { getEligibleMods } from "@/lib/data/queries";
import { runProbes } from "@/lib/market/probes";

export const dynamic = "force-dynamic";
// Each probe is ~2 rate-limited trade calls; allow time for the budgeted run.
export const maxDuration = 120;

const bodySchema = z.object({
  itemClass: z.string().min(1),
  league: z.string().min(1).optional(),
  itemLevel: z.number().int().min(1).max(100).optional(),
  maxProbes: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const league = body.league ?? (await getCurrentLeagueName());
    // Warm the currency price cache so asks convert to Exalted.
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
    });
    return NextResponse.json({
      league,
      itemClass: body.itemClass,
      refreshed: result.refreshed,
      candidates: result.candidates,
      probeCount: result.probes.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Probing failed" },
      { status: 400 },
    );
  }
}
