import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";
import { openTabletTrade } from "@/lib/tablets/scan";
import { TradeOwnerError } from "@/lib/trade/context";

export const dynamic = "force-dynamic";

/**
 * POST {id} — returns the saved trade link for a tablet combination, or
 * queues an interactive job that runs the search and returns `{jobId}`.
 */
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
    if (err instanceof TradeOwnerError) {
      const jobId = await enqueueJob({
        kind: "trade:tablet-url",
        payload: { rowId },
        lane: "interactive",
        priority: 20,
        maxAttempts: 3,
        dedupeKey: `trade:tablet-url:${rowId}`,
        message: "Queued trade search…",
      });
      triggerQueuePump();
      return NextResponse.json({ jobId }, { status: 202 });
    }
    const message = err instanceof Error ? err.message : "Trade search failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
