import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Cambiar el producto ("Nuestro cuadro") o la fecha «En circulación desde» (AAAA-MM-DD; vacía = sin fecha) de una referencia.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const data: { productId?: string | null; runningSince?: Date | null } = {};
    if ("productId" in body) data.productId = body.productId || null;
    if ("runningSince" in body) {
      if (body.runningSince && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.runningSince))) return NextResponse.json({ error: "Fecha no válida (AAAA-MM-DD)" }, { status: 400 });
      data.runningSince = body.runningSince ? new Date(body.runningSince) : null;
    }
    await db.reference.update({ where: { id: params.id }, data });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    await db.reference.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
