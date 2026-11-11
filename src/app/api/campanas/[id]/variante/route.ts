import { NextResponse } from "next/server";
import { addMetaAdVariant } from "@/lib/engine";
export const maxDuration = 60;
// Variante de un anuncio de Meta con otros textos (misma imagen o vídeo)
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { adId, headline, message, description, link, pauseBase } = await req.json();
    await addMetaAdVariant(params.id, String(adId || ""), { headline, message, description, link }, !!pauseBase);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
