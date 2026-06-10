import { NextResponse } from "next/server";
import { getJob } from "@/lib/progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  return NextResponse.json({ job: getJob(id) });
}
