import { NextResponse } from "next/server";
import { removeAccountCallAssets } from "@/lib/google/ads";
export const maxDuration = 60;
// Quita el teléfono de llamada puesto a nivel de cuenta en Google Ads (sale en todos los anuncios de la cuenta).
export async function POST(req: Request) {
  try {
    const { cid } = await req.json();
    if (!/^\d+$/.test(String(cid))) return NextResponse.json({ error: "Hace falta cid." }, { status: 400 });
    return NextResponse.json({ ok: true, removed: await removeAccountCallAssets(String(cid)) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
