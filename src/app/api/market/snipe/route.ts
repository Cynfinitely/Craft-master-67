import { NextResponse } from "next/server";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import { listSnipeTemplates, scanSnipeTemplate } from "@/lib/market/snipes";
import { failJob, finishJob, reporterFor, startJob } from "@/lib/progress";

export const dynamic = "force-dynamic";

/**
 * GET  ?class=Belt[&league=...]            -> applicable snipe templates
 * GET  ?class=Belt&template=<id>[&league=][&progress=<id>] -> run the scan
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const itemClass = searchParams.get("class");
  if (!itemClass) {
    return NextResponse.json({ error: "Missing ?class" }, { status: 400 });
  }
  let league = searchParams.get("league") ?? "";
  if (!league) {
    try {
      league = await getCurrentLeagueName();
    } catch {
      league = "Standard";
    }
  }
  const templateId = searchParams.get("template");
  const progressId = searchParams.get("progress")?.slice(0, 80) ?? null;

  try {
    if (!templateId) {
      const templates = await listSnipeTemplates(league, itemClass);
      return NextResponse.json({ league, templates });
    }
    if (progressId) startJob(progressId, "snipe", "Starting snipe scan…");
    const scan = await scanSnipeTemplate({
      league,
      templateId,
      itemClass,
      maxListings: Math.min(
        20,
        Number.parseInt(searchParams.get("max") ?? "10", 10) || 10,
      ),
      onProgress: progressId ? reporterFor(progressId) : undefined,
    });
    if (!scan) {
      if (progressId) failJob(progressId, "Unknown template.");
      return NextResponse.json({ error: "Unknown template." }, { status: 404 });
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
