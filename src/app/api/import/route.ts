import { NextResponse } from "next/server";
import { resolveItem } from "@/lib/import/resolveItem";
import { solveFromBase } from "@/lib/solver";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: string;
      /** Parse + resolve only — skip the (slow) crafting plan. */
      parseOnly?: boolean;
    };
    const text = (body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "No item text provided." }, { status: 400 });
    }

    const resolved = await resolveItem(text);
    const plan =
      !body.parseOnly && resolved.baseId && resolved.desiredGroups.length
        ? await solveFromBase(
            resolved.baseId,
            resolved.itemLevel,
            resolved.desiredGroups,
          )
        : null;

    return NextResponse.json({ resolved, plan });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse item" },
      { status: 500 },
    );
  }
}
