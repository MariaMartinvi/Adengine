import { NextResponse } from "next/server";
import { applyGoogleCountries, applyMetaAudience } from "@/lib/engine";
import { db } from "@/lib/db";
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const c = await db.campaign.findUniqueOrThrow({ where: { id: params.id }, select: { channel: true } });
    await (c.channel === "google" ? applyGoogleCountries : applyMetaAudience)(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
