import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import { enqueueJob } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  itemClass: z.string().min(1),
  league: z.string().min(1).optional(),
  probeBudget: z.number().int().optional(),
  quickSample: z.boolean().optional(),
  progressId: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const league = body.league ?? (await getCurrentLeagueName());
    const id = await enqueueJob({
      id: body.progressId,
      kind: "scan:quick",
      payload: {
        league,
        itemClass: body.itemClass,
        probeBudget: body.probeBudget ?? 3,
        quickSample: body.quickSample !== false,
      },
      priority: 5,
    });
    triggerQueuePump();
    return NextResponse.json({ id, queued: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
