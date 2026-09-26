import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueJob, type JobLane } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum([
    "scan:class",
    "sample:class",
    "probe:class",
    "scan:gems",
    "scan:tablets",
    "scan:quick",
    "refresh:prices",
    "rank:opportunities",
  ]),
  payload: z
    .record(z.unknown())
    .refine((p) => !Array.isArray(p.gemTypes) || p.gemTypes.length <= 300, "Too many gems")
    .refine((p) => !Array.isArray(p.tablets) || p.tablets.length <= 30, "Too many tablets")
    .refine((p) => !Array.isArray(p.itemClasses) || p.itemClasses.length <= 60, "Too many classes"),
  id: z.string().max(80).optional(),
  runAt: z.number().int().optional(),
});

/**
 * Quick lookups a user waits on run in the interactive lane. Long scans are
 * background work, but a user-started one outranks scheduled collector runs.
 */
const LANE: Partial<Record<string, { lane: JobLane; priority: number }>> = {
  "rank:opportunities": { lane: "interactive", priority: 10 },
};

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const route = LANE[body.kind] ?? { lane: "background" as const, priority: 5 };
    const id = await enqueueJob({
      id: body.id,
      kind: body.kind,
      payload: body.payload,
      runAt: body.runAt,
      lane: route.lane,
      priority: route.priority,
      ...(body.kind === "rank:opportunities"
        ? {
            dedupeKey: `rank:${String(body.payload.league)}:${String(body.payload.itemClass)}:${String(body.payload.itemLevel ?? 82)}:${String(body.payload.baseId ?? "")}`,
            maxAttempts: 2,
          }
        : {}),
    });
    triggerQueuePump();
    return NextResponse.json({ id, kind: body.kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enqueue failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
