import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName, getPrices } from "@/lib/pricing/poe2scout";
import { sampleMarket } from "@/lib/market/sampler";

export const dynamic = "force-dynamic";
// Sampling does several rate-limited trade calls; allow time for them.
export const maxDuration = 120;

const bodySchema = z.object({
  itemClass: z.string().min(1),
  baseType: z.string().min(1).optional(),
  league: z.string().min(1).optional(),
  ilvlMin: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const league = body.league ?? (await getCurrentLeagueName());
    // Warm the currency price cache so listing prices convert to Exalted.
    await getPrices(league).catch(() => null);
    const result = await sampleMarket({
      league,
      itemClass: body.itemClass,
      baseType: body.baseType,
      ilvlMin: body.ilvlMin,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sampling failed" },
      { status: 400 },
    );
  }
}
