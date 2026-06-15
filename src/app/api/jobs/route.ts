import { NextResponse } from "next/server";
import { getDbJob } from "@/lib/jobs/queue";
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
