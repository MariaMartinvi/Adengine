import { NextResponse } from "next/server";
import { setBudget } from "@/lib/engine";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { dailyBudget, totalCap } = await req.json();
    await setBudget(params.id, Number(dailyBudget), Number(totalCap));
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
