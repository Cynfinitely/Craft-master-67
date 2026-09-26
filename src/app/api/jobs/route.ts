import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelJob, getDbJob, requeueJob } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";
import { getJob } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const dbJob = await getDbJob(id);
  if (dbJob) {
    return NextResponse.json({ job: dbJob, source: "db" });
  }
  const memJob = getJob(id);
  return NextResponse.json({ job: memJob, source: memJob ? "memory" : null });
}

const actionSchema = z.object({
  action: z.enum(["cancel", "retry"]),
  id: z.string().min(1).max(120),
});

/** POST {action:"cancel"|"retry", id} — cancel a queued/running job or re-run a finished one. */
export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected {action, id}" }, { status: 400 });
  }
  const { action, id } = parsed.data;
  if (action === "cancel") {
    const ok = await cancelJob(id, "Cancelled from the app");
    return NextResponse.json({ ok, id }, { status: ok ? 200 : 409 });
  }
  const next = await requeueJob(id);
  if (!next) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  triggerQueuePump();
  return NextResponse.json({ ok: true, id: next });
}
