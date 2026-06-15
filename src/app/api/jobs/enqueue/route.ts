import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueJob } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum(["scan:class", "sample:class", "probe:class"]),
  payload: z.record(z.unknown()),
  id: z.string().max(80).optional(),
  runAt: z.number().int().optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const id = await enqueueJob({
      id: body.id,
      kind: body.kind,
      payload: body.payload,
      runAt: body.runAt,
    });
    return NextResponse.json({ id, kind: body.kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enqueue failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
