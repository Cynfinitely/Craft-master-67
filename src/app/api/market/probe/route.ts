import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import { enqueueJob } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  itemClass: z.string().min(1),
  league: z.string().min(1).optional(),
  itemLevel: z.number().int().optional(),
  maxProbes: z.number().int().optional(),
  progressId: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const league = body.league ?? (await getCurrentLeagueName());
    const id = await enqueueJob({
      id: body.progressId,
      kind: "probe:class",
      payload: {
        league,
        itemClass: body.itemClass,
        itemLevel: body.itemLevel ?? 82,
        maxProbes: body.maxProbes ?? 6,
      },
      priority: 5,
    });
    triggerQueuePump();
    return NextResponse.json({ id, queued: true, league, itemClass: body.itemClass });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Probing failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
