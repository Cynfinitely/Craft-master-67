import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import { importPobText } from "@/lib/import/pob";
import {
  addMetaItems,
  deleteMetaItem,
  listMetaItems,
} from "@/lib/market/meta";

export const dynamic = "force-dynamic";

async function resolveLeague(raw: string | null | undefined): Promise<string> {
  if (raw) return raw;
  try {
    return await getCurrentLeagueName();
  } catch {
    return "Standard";
  }
}

/** GET ?league=[&class=] -> imported meta items. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const league = await resolveLeague(searchParams.get("league"));
  const itemClass = searchParams.get("class");
  try {
    const items = await listMetaItems(league, itemClass);
    return NextResponse.json({ league, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const importSchema = z.object({
  action: z.literal("import"),
  league: z.string().max(60).optional(),
  text: z.string().min(20).max(2_000_000),
  sourceLabel: z.string().max(80).optional(),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  id: z.number().int().positive(),
});

/**
 * POST {action:"import", text} — decode a PoB2 build code (or raw item text),
 * resolve rare gear to bases + mod groups, persist as meta demand items.
 * POST {action:"delete", id} — remove one.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = (body as { action?: string })?.action;

  try {
    if (action === "import") {
      const parsed = importSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid input" },
          { status: 400 },
        );
      }
      const league = await resolveLeague(parsed.data.league);
      const result = await importPobText(parsed.data.text);
      await addMetaItems(
        result.items.map((i) => ({
          league,
          itemClass: i.itemClass,
          baseId: i.baseId,
          baseName: i.baseName,
          groups: i.groups,
          labels: i.labels,
          sourceLabel: parsed.data.sourceLabel ?? null,
        })),
      );
      return NextResponse.json({
        league,
        added: result.items.length,
        totalBlocks: result.totalBlocks,
        warnings: result.warnings,
        items: result.items,
      });
    }
    if (action === "delete") {
      const parsed = deleteSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      }
      await deleteMetaItem(parsed.data.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
