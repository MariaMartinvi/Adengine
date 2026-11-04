import { NextResponse } from "next/server";
import { referenceFromVideo } from "@/lib/engine";
export const maxDuration = 120;
// Vídeo de referencia ya subido al almacén: devuelve la referencia propuesta (fotogramas + descripción), sin guardarla.
export async function POST(req: Request) {
  try {
    const { channel, url, link } = await req.json();
    if (!["meta", "google"].includes(channel)) return NextResponse.json({ error: "Canal no válido" }, { status: 400 });
    if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(String(url || ""))) return NextResponse.json({ error: "Sube el vídeo desde AdEngine" }, { status: 400 });
    if (link && !/^https?:\/\//.test(String(link))) return NextResponse.json({ error: "El enlace debe empezar por https://" }, { status: 400 });
    return NextResponse.json({ ok: true, ref: await referenceFromVideo(channel, url, String(link || "").slice(0, 300)) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
