import { NextResponse } from "next/server";
import { getPrices } from "@/lib/pricing/poe2scout";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get("league") ?? undefined;
  try {
    const data = await getPrices(league);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch prices" },
      { status: 502 },
    );
  }
}
