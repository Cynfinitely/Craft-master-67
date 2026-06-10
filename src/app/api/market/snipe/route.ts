import { NextResponse } from "next/server";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import { listSnipeTemplates, scanSnipeTemplate } from "@/lib/market/snipes";

export const dynamic = "force-dynamic";

/**
 * GET  ?class=Belt[&league=...]            -> applicable snipe templates
 * GET  ?class=Belt&template=<id>[&league=] -> run the scan (trade API calls)
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

  try {
    if (!templateId) {
      const templates = await listSnipeTemplates(league, itemClass);
      return NextResponse.json({ league, templates });
    }
    const scan = await scanSnipeTemplate({
      league,
      templateId,
      itemClass,
      maxListings: Math.min(
        20,
        Number.parseInt(searchParams.get("max") ?? "10", 10) || 10,
      ),
    });
    if (!scan) {
      return NextResponse.json({ error: "Unknown template." }, { status: 404 });
    }
    return NextResponse.json({ league, scan });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Snipe scan failed" },
      { status: 500 },
    );
  }
}
