import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
// Quita una venta que no era real (p. ej. una compra de prueba) para que no cuente en el CAC.
// DELETE /api/negocios/:id/ventas?pedido=<orderId>
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const orderId = new URL(req.url).searchParams.get("pedido") || "";
    if (!orderId) return NextResponse.json({ error: "Falta el pedido" }, { status: 400 });
    const { count } = await db.sale.deleteMany({ where: { businessId: params.id, orderId } });
    if (!count) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });
    await log(params.id, "VENTA_BORRADA", `Pedido ${orderId} quitado: no era una venta real.`, true);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
