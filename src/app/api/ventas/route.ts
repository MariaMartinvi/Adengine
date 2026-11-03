import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
import { checkSalesKey } from "@/lib/crypto";
// La web de un negocio avisa de cada pago cobrado (desde su webhook de Stripe), con los identificadores del clic del anuncio.
// POST /api/ventas?negocio=<id>  · cabecera x-adengine-key: <clave de la ficha>
// { orderId, amount, currency?, email?, gclid?, fbc?, fbp?, test? }  · test: true comprueba sin guardar nada (para probar la conexión).
export async function POST(req: Request) {
  const businessId = new URL(req.url).searchParams.get("negocio") || "";
  if (!checkSalesKey(businessId, req.headers.get("x-adengine-key") || "")) return NextResponse.json({ error: "Clave no válida" }, { status: 401 });
  try {
    const { orderId, amount, currency, email, gclid, fbc, fbp, test } = await req.json();
    const id = String(orderId || "").trim().slice(0, 100), value = Number(amount);
    if (!id || !(value > 0)) return NextResponse.json({ error: "Faltan orderId o amount (> 0)" }, { status: 400 });
    if (test) return NextResponse.json({ ok: true, test: true, channel: gclid ? "google" : fbc ? "meta" : "organic" });
    if (await db.sale.findUnique({ where: { businessId_orderId: { businessId, orderId: id } } })) return NextResponse.json({ ok: true, duplicate: true });
    const str = (v: unknown, n = 300) => (v ? String(v).trim().slice(0, n) : null);
    const sale = await db.sale.create({ data: {
      businessId, orderId: id, amount: value, currency: String(currency || "EUR").toUpperCase().slice(0, 3),
      email: (str(email, 200) || "").toLowerCase(), gclid: str(gclid), fbc: str(fbc), fbp: str(fbp),
      channel: gclid ? "google" : fbc ? "meta" : "organic",
    } });
    await log(businessId, "VENTA", `${value} ${sale.currency} · pedido ${id} · canal ${sale.channel}.`, true);
    return NextResponse.json({ ok: true, id: sale.id });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
