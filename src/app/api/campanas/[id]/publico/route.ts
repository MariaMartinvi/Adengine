import { NextResponse } from "next/server";
import { applyGoogleCountries, applyMetaAudience } from "@/lib/engine";
import { db } from "@/lib/db";
// Google admite { countries: "ES" } para fijar los países de esta campaña sin cambiar la ficha.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const c = await db.campaign.findUniqueOrThrow({ where: { id: params.id }, select: { channel: true } });
    const body = await req.json().catch(() => ({}));
    if (c.channel === "google") await applyGoogleCountries(params.id, typeof body?.countries === "string" ? body.countries : undefined);
    else await applyMetaAudience(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
