import { NextResponse } from "next/server";
import { updateGoogleAdTexts } from "@/lib/engine";
// Anuncio de Google ya publicado: cambiar sus titulares y descripciones.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { headlines, descriptions } = await req.json();
    if (!Array.isArray(headlines) || !Array.isArray(descriptions)) return NextResponse.json({ error: "Faltan titulares o descripciones" }, { status: 400 });
    await updateGoogleAdTexts(params.id, headlines.map(String), descriptions.map(String));
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
