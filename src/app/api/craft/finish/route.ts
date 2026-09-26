import { NextResponse } from "next/server";
import { resolveItem } from "@/lib/import/resolveItem";
import { parseGoalList, solve, type CurrentMod } from "@/lib/craft";

export const dynamic = "force-dynamic";

interface FinishRequest {
  /** Pasted in-game item text — the item's current mods are inferred. */
  text?: string;
  /** Explicit input instead of text. */
  baseId?: string;
  itemLevel?: number;
  current?: CurrentMod[];
  /** Desired FINAL mod set (goal entries: "Group", "Group@<minLevel>", "~d", "~o"). */
  desiredGroups?: string[];
  /** Cost of another copy of the item (restart cost), in Exalted. */
  baseCostExalted?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FinishRequest;
    const goal = parseGoalList((body.desiredGroups ?? []).join(","));
    if (goal.length === 0) {
      return NextResponse.json(
        { error: "desiredGroups is required (the FINAL mod set to reach)." },
        { status: 400 },
      );
    }

    let baseId = body.baseId ?? null;
    let itemLevel = body.itemLevel ?? 82;
    let current = body.current ?? [];
    let resolved = null;

    if (body.text?.trim()) {
      resolved = await resolveItem(body.text.trim());
      if (!resolved.baseId) {
        return NextResponse.json(
          { error: resolved.warnings[0] ?? "Could not resolve the pasted item." },
          { status: 422 },
        );
      }
      baseId = resolved.baseId;
      itemLevel = resolved.itemLevel;
      current = resolved.matched.map((m) => ({
        group: m.group,
        side: m.kind,
        level: m.tierLevel,
        desecrated: m.desecrated || undefined,
      }));
    }

    if (!baseId) {
      return NextResponse.json(
        { error: "Provide either pasted item `text` or `baseId` + `current`." },
        { status: 400 },
      );
    }

    const plan = await solve({ baseId, itemLevel, goal, current, baseCost: body.baseCostExalted });
    if (!plan) {
      return NextResponse.json({ error: "Unknown base item." }, { status: 404 });
    }
    return NextResponse.json({ plan, resolved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to plan finish" },
      { status: 500 },
    );
  }
}
