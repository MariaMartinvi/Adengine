import { NextResponse } from "next/server";
import { setMetaAdStatus } from "@/lib/engine";
// Pausar o reactivar un anuncio de una campaña de Meta creada (y su copia de remarketing).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { status } = await req.json();
    if (!["ENABLED", "PAUSED"].includes(status)) return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
    await setMetaAdStatus(params.id, status);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
