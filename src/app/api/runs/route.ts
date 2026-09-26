import { NextResponse } from "next/server";
import { loadRunsBoard } from "@/lib/jobs/runsQuery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const board = await loadRunsBoard();
    return NextResponse.json(board);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load runs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
