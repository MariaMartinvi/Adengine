import { NextResponse } from "next/server";
import { applyProposal } from "@/lib/engine";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { decision } = await req.json();
    await applyProposal(params.id, decision === "APPROVED" ? "APPROVED" : "DISMISSED");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
