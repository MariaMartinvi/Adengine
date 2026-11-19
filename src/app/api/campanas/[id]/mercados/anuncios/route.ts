import { NextResponse } from "next/server";
import { copyAdsToMarket } from "@/lib/engine";
export const maxDuration = 120;
// Copia a un grupo de países los anuncios activos del principal que le faltan. { market: "mexico-y-chile" }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { market } = await req.json();
    const n = await copyAdsToMarket(params.id, String(market || ""));
    return NextResponse.json({ ok: true, copied: n });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
