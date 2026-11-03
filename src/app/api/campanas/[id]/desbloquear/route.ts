import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
// Una creación que se cortó (p. ej. por tiempo) deja la campaña en CREATING: vuelve a propuesta para poder crearla de nuevo.
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const c = await db.campaign.findUniqueOrThrow({ where: { id: params.id } });
    if (c.status !== "CREATING") return NextResponse.json({ error: "Esta campaña no está a medias." }, { status: 409 });
    await db.campaign.update({ where: { id: c.id }, data: { status: "DRAFT" } });
    await log(c.businessId, "DESBLOQUEADA", `${c.name}: la creación se cortó; vuelve a ser propuesta.`);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
