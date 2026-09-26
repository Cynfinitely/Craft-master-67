import { NextResponse } from "next/server";
import { resolveItem } from "@/lib/import/resolveItem";
import { importPobText } from "@/lib/import/pob";
import { decodePobCode } from "@/lib/import/pobParse";
import { parseGoalList, solve } from "@/lib/craft";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: string;
      /** Parse + resolve only — skip the crafting plan. */
      parseOnly?: boolean;
    };
    const text = (body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "No item text provided." }, { status: 400 });
    }

    if (decodePobCode(text)) {
      const pob = await importPobText(text);
      return NextResponse.json({ pob });
    }

    const resolved = await resolveItem(text);
    const plan =
      !body.parseOnly && resolved.baseId && resolved.desiredGroups.length
        ? await solve({
            baseId: resolved.baseId,
            itemLevel: resolved.itemLevel,
            goal: parseGoalList(resolved.desiredGroups.join(",")),
          })
        : null;

    return NextResponse.json({ resolved, plan });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse item" },
      { status: 500 },
    );
  }
}
