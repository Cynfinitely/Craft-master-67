import { NextResponse } from "next/server";
import { resolveItem } from "@/lib/import/resolveItem";
import { planFinish, type FinishCurrentMod } from "@/lib/solver/finish";

export const dynamic = "force-dynamic";

interface FinishRequest {
  /** Pasted in-game item text — the item's current mods are inferred. */
  text?: string;
  /** Explicit input (used by the snipe scanner / saved listings). */
  baseId?: string;
  itemLevel?: number;
  current?: FinishCurrentMod[];
  /** Desired FINAL mod set ("Group@<minLevel>" / "...~d"). */
  desiredGroups?: string[];
  buyPriceExalted?: number;
  trials?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FinishRequest;
    const desiredGroups = body.desiredGroups ?? [];
    if (desiredGroups.length === 0) {
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
        desecrated: m.desecrated,
      }));
    }

    if (!baseId) {
      return NextResponse.json(
        { error: "Provide either pasted item `text` or `baseId` + `current`." },
        { status: 400 },
      );
    }

    const plan = await planFinish({
      baseId,
      itemLevel,
      current,
      desiredGroups,
      buyPriceExalted: body.buyPriceExalted ?? null,
      trials: body.trials,
    });
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
