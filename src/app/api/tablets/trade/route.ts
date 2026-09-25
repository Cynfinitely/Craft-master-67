import { NextResponse } from "next/server";
import { openTabletTrade } from "@/lib/tablets/scan";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let rowId = "";
  try {
    const body = (await request.json()) as { id?: string };
    rowId = body.id?.trim() ?? "";
  } catch {
    return NextResponse.json({ error: "Missing combination id." }, { status: 400 });
  }
  if (!rowId) {
    return NextResponse.json({ error: "Missing combination id." }, { status: 400 });
  }
  try {
    const tradeUrl = await openTabletTrade(rowId);
    return NextResponse.json({ tradeUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trade search failed";
    const status = /rate-limited|\b429\b/i.test(message) ? 429 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
