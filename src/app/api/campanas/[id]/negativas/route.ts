import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as ads from "@/lib/google/ads";
export const maxDuration = 60;
// Añade palabras negativas (concordancia de frase) a una campaña de Google ya creada: búsquedas en las que no queremos salir.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { texts } = await req.json();
    const list = [...new Set((Array.isArray(texts) ? texts : []).map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean))];
    if (!list.length) return NextResponse.json({ error: "Hace falta una lista de palabras." }, { status: 400 });
    const c = await db.campaign.findUniqueOrThrow({ where: { id: params.id }, include: { business: true } });
    if (c.channel !== "google" || !c.googleCampaignId) throw new Error("Solo en una campaña de Google ya creada.");
    for (const t of list) await ads.addNegative(c.business.googleCustomerId!, c.googleCampaignId, t);
    await db.actionLog.create({ data: { businessId: c.businessId, kind: "PALABRA", detail: `Negativas añadidas: ${list.map((t) => `«${t}»`).join(", ")}.` } });
    return NextResponse.json({ ok: true, added: list.length });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
