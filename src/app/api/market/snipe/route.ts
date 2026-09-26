import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import { getSnipeBuilderOptions, listSnipeTemplates } from "@/lib/market/snipes";
import {
  addSnipeSpec,
  deleteSnipeSpec,
  listSnipeSpecs,
} from "@/lib/market/specs";
import { enqueueJob } from "@/lib/jobs/queue";
import { triggerQueuePump } from "@/lib/jobs/pump";

export const dynamic = "force-dynamic";

async function resolveLeague(raw: string | null): Promise<string> {
  if (raw) return raw;
  try {
    return await getCurrentLeagueName();
  } catch {
    return "Standard";
  }
}

/**
 * GET  ?class=Belt[&league=...]                  -> templates + saved specs
 * GET  ?class=Belt&builder=1                     -> mod pool + bases for the spec builder
 * GET  ?class=Belt&template=<id>                -> queue a template scan, returns {jobId}
 * GET  ?class=Belt&spec=<id>                    -> queue a custom-spec scan, returns {jobId}
 *
 * Scans run in the market worker; the finished job's `result` is the scan.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const itemClass = searchParams.get("class");
  if (!itemClass) {
    return NextResponse.json({ error: "Missing ?class" }, { status: 400 });
  }
  const league = await resolveLeague(searchParams.get("league"));
  const templateId = searchParams.get("template");
  const specId = Number.parseInt(searchParams.get("spec") ?? "", 10);
  try {
    if (searchParams.get("builder")) {
      const builder = await getSnipeBuilderOptions(itemClass);
      return NextResponse.json({ league, ...builder });
    }
    if (!templateId && !Number.isFinite(specId)) {
      const [templates, specs] = await Promise.all([
        listSnipeTemplates(league, itemClass),
        listSnipeSpecs(league, itemClass),
      ]);
      return NextResponse.json({ league, templates, specs });
    }

    const maxListings = Math.min(
      20,
      Number.parseInt(searchParams.get("max") ?? "10", 10) || 10,
    );
    const target = Number.isFinite(specId) ? `spec:${specId}` : `template:${templateId}`;
    const jobId = await enqueueJob({
      kind: "snipe:scan",
      payload: {
        league,
        itemClass,
        maxListings,
        ...(Number.isFinite(specId) ? { specId } : { templateId }),
      },
      lane: "interactive",
      priority: 15,
      maxAttempts: 2,
      dedupeKey: `snipe:scan:${league}:${itemClass}:${target}:${maxListings}`,
      message: "Queued snipe scan…",
    });
    triggerQueuePump();
    return NextResponse.json({ league, jobId }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snipe scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const createSchema = z.object({
  action: z.literal("create"),
  league: z.string().max(60).optional(),
  itemClass: z.string().min(1).max(60),
  baseId: z.string().max(200).nullable().optional(),
  name: z.string().min(1).max(80),
  mods: z
    .array(
      z.object({
        group: z.string().min(1).max(120),
        minLevel: z.number().int().min(0).max(100).optional(),
      }),
    )
    .min(2)
    .max(6),
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  id: z.number().int().positive(),
});

/** POST {action:"create",...} | {action:"delete",id} — manage snipe specs. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = (body as { action?: string })?.action;

  try {
    if (action === "create") {
      const parsed = createSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid spec" },
          { status: 400 },
        );
      }
      const league = await resolveLeague(parsed.data.league ?? null);
      const spec = await addSnipeSpec({
        league,
        itemClass: parsed.data.itemClass,
        baseId: parsed.data.baseId ?? null,
        name: parsed.data.name,
        mods: parsed.data.mods,
      });
      return NextResponse.json({ spec });
    }
    if (action === "delete") {
      const parsed = deleteSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
      }
      await deleteSnipeSpec(parsed.data.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
