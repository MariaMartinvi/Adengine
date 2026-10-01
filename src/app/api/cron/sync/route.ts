import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncCampaign } from "@/lib/engine";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const campaigns = await db.campaign.findMany({ where: { status: { in: ["ENABLED", "PAUSED"] }, OR: [{ googleCampaignId: { not: null } }, { metaCampaignId: { not: null } }] } });
  const out: Record<string, string> = {};
  for (const c of campaigns) {
    try { await syncCampaign(c.id); out[c.name] = "ok"; }
    catch (e: any) { out[c.name] = e.message; await db.actionLog.create({ data: { businessId: c.businessId, kind: "ERROR_SYNC", detail: e.message, auto: true } }); }
  }
  return NextResponse.json({ synced: out });
}
