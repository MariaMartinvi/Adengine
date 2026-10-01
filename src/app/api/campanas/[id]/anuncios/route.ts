import { NextResponse } from "next/server";
import { addMetaImageAd } from "@/lib/engine";
export const maxDuration = 60;
// Añadir una portada (anuncio de imagen) a una campaña de Meta ya creada
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { imageUrl } = await req.json();
    await addMetaImageAd(params.id, String(imageUrl || "").trim());
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
