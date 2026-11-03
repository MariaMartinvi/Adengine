import { NextResponse } from "next/server";
import { makeDraftVideo } from "@/lib/engine";
export const maxDuration = 300;
// Monta (o vuelve a montar) el vídeo de un anuncio de la propuesta de Meta. Opcional: un guion nuevo o comentarios para rehacerlo.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { plan, feedback } = await req.json().catch(() => ({}));
    return NextResponse.json({ ok: true, url: await makeDraftVideo(params.id, { plan, feedback }) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
