import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
// Añadir una referencia (anuncio que funciona) a un canal. La captura llega ya reducida a JPEG desde el navegador.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { channel, note, image, video, audio } = await req.json();
    if (!["meta", "google"].includes(channel)) return NextResponse.json({ error: "Canal no válido" }, { status: 400 });
    const text = String(note || "").trim().slice(0, 2000);
    const img = image ? String(image) : null;
    if (img && (!/^data:image\/jpeg;base64,/.test(img) || img.length > 2_000_000)) return NextResponse.json({ error: "La captura debe ser una imagen de menos de 1,5 MB" }, { status: 400 });
    if (!text && !img) return NextResponse.json({ error: "Escribe una nota o añade una captura" }, { status: 400 });
    // La IA no oye los vídeos: la música y el audio los describe María.
    const sound = String(audio || "").trim().slice(0, 500);
    if (video && !sound) return NextResponse.json({ error: "Es un vídeo: describe la música y el audio" }, { status: 400 });
    await db.reference.create({ data: { businessId: params.id, channel, note: text, image: img, video: !!video, audio: video ? sound : null } });
    await log(params.id, "REFERENCIA", `${channel === "meta" ? "Meta" : "Google"}: ${text.slice(0, 80) || "captura"}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
