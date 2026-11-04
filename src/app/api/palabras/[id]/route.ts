import { NextResponse } from "next/server";
import { updateLiveKeyword } from "@/lib/engine";
// Palabra de una campaña de Google ya creada: cambiar su puja máxima o pausarla/reactivarla.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { maxCpc, status } = await req.json();
    if (status != null && !["ENABLED", "PAUSED"].includes(status)) return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
    await updateLiveKeyword(params.id, { ...(maxCpc != null ? { maxCpc: Number(maxCpc) } : {}), ...(status ? { status } : {}) });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
