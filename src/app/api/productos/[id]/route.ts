import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Fotos del producto para montar vídeos (p. ej. la lámina en varios estilos), en el orden en que salen.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { photos } = await req.json();
    if (!Array.isArray(photos) || photos.length > 12 || photos.some((u) => !/^https:\/\//.test(String(u)))) return NextResponse.json({ error: "Hasta 12 fotos, cada una con enlace https://…" }, { status: 400 });
    await db.product.update({ where: { id: params.id }, data: { photos: photos.map(String) } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    await db.product.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
