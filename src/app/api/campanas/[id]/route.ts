import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
// Descartar una propuesta: solo borradores (aún no existen en Meta ni en Google). Se borra con sus palabras y anuncios.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const c = await db.campaign.findUniqueOrThrow({ where: { id: params.id } });
    if (c.status !== "DRAFT") return NextResponse.json({ error: "Solo se pueden descartar propuestas; una campaña creada se archiva." }, { status: 409 });
    await db.campaign.delete({ where: { id: c.id } });
    await log(c.businessId, "DESCARTADA", `Propuesta descartada: ${c.name}.`);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
