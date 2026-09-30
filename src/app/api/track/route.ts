import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Recibe del snippet: identificadores de clic y, cuando se conoce, el email del visitante.
export async function POST(req: Request) {
  try {
    const { email, gclid, fbclid, ttclid, landing } = await req.json();
    if (!gclid && !fbclid && !ttclid) return NextResponse.json({ ok: true, ignored: true });
    await db.visitor.create({ data: { email: email?.toLowerCase() || null, gclid, fbclid, ttclid, landing } });
    return NextResponse.json({ ok: true }, { headers: cors });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500, headers: cors }); }
}
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
export async function OPTIONS() { return new NextResponse(null, { headers: cors }); }
