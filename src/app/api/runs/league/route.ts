import { NextResponse } from "next/server";
import { z } from "zod";
import { setCollectorLeague } from "@/lib/jobs/schedules";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  league: z.string().trim().min(1).max(80),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await setCollectorLeague(body.league);
    return NextResponse.json({ league: body.league });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not change the league";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
