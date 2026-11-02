import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approveCampaign, approveMetaCampaign } from "@/lib/engine";
export const maxDuration = 60;
// Recibe las ediciones de la pantalla de aprobación y crea la campaña en pausa
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { campaignId, dailyBudget, totalCap, keywords } = body as { campaignId: string; dailyBudget: number; totalCap: number; keywords: { id: string; maxCpc: number; included: boolean; matchType: string }[] };
    // Doble clic: solo una petición pasa la propuesta de DRAFT a CREATING; la otra se para aquí.
    const lock = await db.campaign.updateMany({ where: { id: campaignId, businessId: params.id, status: "DRAFT" }, data: { status: "CREATING" } });
    if (!lock.count) return NextResponse.json({ error: "Esta propuesta ya se está creando o ya no está pendiente." }, { status: 409 });
    try {
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (c.channel === "meta") {
      await approveMetaCampaign(c.id, { dailyBudget: Number(dailyBudget), totalCap: Number(totalCap), message: String(body.message || ""), headline: String(body.headline || ""), description: String(body.description || "") });
      return NextResponse.json({ ok: true });
    }
    await db.$transaction([
      db.campaign.update({ where: { id: c.id }, data: { dailyBudget: Number(dailyBudget), totalCap: Number(totalCap) } }),
      ...keywords.map((k) => db.keyword.update({ where: { id: k.id }, data: { maxCpc: Number(k.maxCpc), included: !!k.included, matchType: k.matchType } })),
    ]);
    await approveCampaign(c.id);
    return NextResponse.json({ ok: true });
    } catch (e) {
      await db.campaign.updateMany({ where: { id: campaignId, status: "CREATING" }, data: { status: "DRAFT" } });
      throw e;
    }
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
