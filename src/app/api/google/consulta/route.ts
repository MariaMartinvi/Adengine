import { NextResponse } from "next/server";
import { search } from "@/lib/google/ads";
export const maxDuration = 60;
// Consulta de solo lectura a Google Ads (GAQL), para diagnosticar lo que el panel no enseña.
export async function POST(req: Request) {
  try {
    const { cid, query } = await req.json();
    if (!/^\d+$/.test(String(cid)) || !/^\s*select\s/i.test(String(query))) return NextResponse.json({ error: "Hace falta cid y una consulta SELECT." }, { status: 400 });
    return NextResponse.json({ rows: await search(String(cid), String(query)) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
