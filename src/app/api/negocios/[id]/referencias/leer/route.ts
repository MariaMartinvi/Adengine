import { NextResponse } from "next/server";
import { referencesFromScreenshots } from "@/lib/engine";
export const maxDuration = 120;
// Lee hasta 3 capturas con anuncios y devuelve las referencias propuestas, sin guardarlas (María elige cuáles).
export async function POST(req: Request) {
  try {
    const { channel, images } = await req.json();
    if (!["meta", "google"].includes(channel)) return NextResponse.json({ error: "Canal no válido" }, { status: 400 });
    if (!Array.isArray(images) || !images.length || images.length > 3) return NextResponse.json({ error: "Sube de 1 a 3 capturas" }, { status: 400 });
    if (images.some((d) => !/^data:image\/(jpeg|png|webp);base64,/.test(String(d)) || String(d).length > 2_500_000)) return NextResponse.json({ error: "Cada captura debe ser una imagen de menos de 2 MB" }, { status: 400 });
    return NextResponse.json({ ok: true, refs: await referencesFromScreenshots(channel, images) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
