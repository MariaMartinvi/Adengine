import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Cambiar el producto ("Nuestro cuadro") de una referencia.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const { productId } = await req.json();
    await db.reference.update({ where: { id: params.id }, data: { productId: productId || null } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    await db.reference.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
