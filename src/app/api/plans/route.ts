import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSavedPlan,
  deleteSavedPlan,
  listSavedPlans,
} from "@/lib/user/queries";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  baseId: z.string().nullable().optional(),
  plan: z.any(),
});

export async function GET() {
  const plans = await listSavedPlans();
  return NextResponse.json({ plans });
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const id = await createSavedPlan(body.name, body.baseId ?? null, body.plan);
    return NextResponse.json({ id }, { status: 201 });
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
  await deleteSavedPlan(id);
  return NextResponse.json({ ok: true });
}
