import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentLeagueName } from "@/lib/pricing/poe2scout";
import {
  addManualSale,
  deleteManualSale,
  listManualSales,
} from "@/lib/market/manual";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  league: z.string().min(1).optional(),
  itemClass: z.string().min(1).nullable().optional(),
  baseType: z.string().min(1),
  ilvl: z.number().int().min(1).max(100).nullable().optional(),
  priceExalted: z.number().positive(),
  groups: z.array(z.string().min(1)).min(1),
  note: z.string().max(500).nullable().optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const league = searchParams.get("league") ?? (await getCurrentLeagueName());
  const sales = await listManualSales(league);
  return NextResponse.json({ sales });
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const league = body.league ?? (await getCurrentLeagueName());
    const sale = await addManualSale({ ...body, league });
    return NextResponse.json({ sale }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number.parseInt(searchParams.get("id") ?? "", 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  await deleteManualSale(id);
  return NextResponse.json({ ok: true });
}
