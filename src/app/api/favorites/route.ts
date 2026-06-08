import { NextResponse } from "next/server";
import { z } from "zod";
import { listFavorites, toggleFavorite } from "@/lib/user/queries";

export const dynamic = "force-dynamic";

const toggleSchema = z.object({ baseId: z.string().min(1) });

export async function GET() {
  const favorites = await listFavorites();
  return NextResponse.json({ favorites });
}

export async function POST(request: Request) {
  try {
    const { baseId } = toggleSchema.parse(await request.json());
    const favorited = await toggleFavorite(baseId);
    return NextResponse.json({ favorited });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request" },
      { status: 400 },
    );
  }
}
