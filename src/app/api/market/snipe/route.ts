import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import {
  getSnipeBuilderOptions,
  listSnipeTemplates,
  scanSnipeSpec,
  scanSnipeTemplate,
} from "@/lib/market/snipes";
import {
  addSnipeSpec,
  deleteSnipeSpec,
  listSnipeSpecs,
} from "@/lib/market/specs";
import { failJob, finishJob, reporterFor, startJob } from "@/lib/progress";

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
 * GET  ?class=Belt&template=<id>[&progress=<id>] -> run a template scan
 * GET  ?class=Belt&spec=<id>[&progress=<id>]     -> run a custom-spec scan
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
  const progressId = searchParams.get("progress")?.slice(0, 80) ?? null;

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

    if (progressId) startJob(progressId, "snipe", "Starting snipe scan…");
    const maxListings = Math.min(
      20,
      Number.parseInt(searchParams.get("max") ?? "10", 10) || 10,
    );
    const scan = Number.isFinite(specId)
      ? await scanSnipeSpec({
          league,
          specId,
          maxListings,
          onProgress: progressId ? reporterFor(progressId) : undefined,
        })
      : await scanSnipeTemplate({
          league,
          templateId: templateId!,
          itemClass,
          maxListings,
          onProgress: progressId ? reporterFor(progressId) : undefined,
        });
    if (!scan) {
      if (progressId) failJob(progressId, "Unknown template or spec.");
      return NextResponse.json(
        { error: "Unknown template or spec." },
        { status: 404 },
      );
    }
    if (progressId) {
      finishJob(
        progressId,
        `Done — ${scan.results.length} listings evaluated (${scan.total} matched online).`,
      );
    }
    return NextResponse.json({ league, scan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Snipe scan failed";
    if (progressId) failJob(progressId, message);
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
