import { NextResponse } from "next/server";
import { isRemoteDb } from "@/db";
import { getDbJob } from "@/lib/jobs/queue";
import { liveDrainers } from "@/lib/jobs/workers";
import { getJob } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const dbJob = await getDbJob(id);
  if (dbJob) {
    let workerOnline: boolean | undefined;
    if (dbJob.status === "pending") {
      // Locally the pump starts on demand, so only a hosted setup can be "offline".
      workerOnline = isRemoteDb() ? (await liveDrainers().catch(() => [])).length > 0 : true;
    }
    return NextResponse.json({ job: dbJob, workerOnline });
  }
  return NextResponse.json({ job: getJob(id) });
}
