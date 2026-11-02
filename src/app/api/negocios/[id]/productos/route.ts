import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Añadir un producto (p. ej. un cuadro) a la ficha: con él se hacen los anuncios que copian las referencias.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { name, url, image } = await req.json();
    const n = String(name || "").trim().slice(0, 120), u = String(url || "").trim(), img = String(image || "").trim();
    if (!n || !/^https?:\/\//.test(u)) return NextResponse.json({ error: "Pon el nombre y el enlace (https://…) del producto" }, { status: 400 });
    if (img && !/^https?:\/\//.test(img)) return NextResponse.json({ error: "La imagen debe ser un enlace https://…" }, { status: 400 });
    const p = await db.product.create({ data: { businessId: params.id, name: n, url: u, image: img || null } });
    return NextResponse.json({ ok: true, id: p.id });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
