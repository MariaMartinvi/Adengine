import { NextResponse } from "next/server";
import { applyProposal } from "@/lib/engine";
// Guardar un ganador de vídeo saca fotogramas y llama a la IA: puede tardar más de 60 s.
export const maxDuration = 120;
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { decision } = await req.json();
    await applyProposal(params.id, decision === "APPROVED" ? "APPROVED" : "DISMISSED");
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
