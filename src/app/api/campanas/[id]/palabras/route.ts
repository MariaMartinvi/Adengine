import { NextResponse } from "next/server";
import { addLiveKeyword } from "@/lib/engine";
// Añadir una palabra a una campaña de Google ya creada, en uno de sus grupos y con su página.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { text, matchType, maxCpc, adGroup, finalUrl } = await req.json();
    if (!["EXACT", "PHRASE"].includes(matchType)) return NextResponse.json({ error: "Concordancia no válida" }, { status: 400 });
    if (finalUrl && !/^https:\/\//.test(String(finalUrl))) return NextResponse.json({ error: "La página debe empezar por https://" }, { status: 400 });
    await addLiveKeyword(params.id, { text: String(text || ""), matchType, maxCpc: Number(maxCpc), adGroup: adGroup || null, finalUrl: finalUrl || null });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
