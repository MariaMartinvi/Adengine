import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
import { checkSalesKey } from "@/lib/crypto";
import { sendClickConversion } from "@/lib/google/datamanager";
import { sendPurchase } from "@/lib/meta/ads";
// La web de un negocio avisa de cada pago cobrado (desde su webhook de Stripe), con los identificadores del clic del anuncio.
// POST /api/ventas?negocio=<id>  · cabecera x-adengine-key: <clave de la ficha>
// { orderId, amount, currency?, email?, gclid?, fbc?, fbp?, url?, test?, metaTestCode? }
// test: true comprueba sin guardar nada (con gclid, Google valida la venta sin apuntarla). metaTestCode: además manda la compra a Meta como evento de prueba («Probar eventos»).
export async function POST(req: Request) {
  const businessId = new URL(req.url).searchParams.get("negocio") || "";
  if (!checkSalesKey(businessId, req.headers.get("x-adengine-key") || "")) return NextResponse.json({ error: "Clave no válida" }, { status: 401 });
  try {
    const { orderId, amount, currency, email, gclid, fbc, fbp, url, test, metaTestCode } = await req.json();
    const id = String(orderId || "").trim().slice(0, 100), value = Number(amount);
    if (!id || !(value > 0)) return NextResponse.json({ error: "Faltan orderId o amount (> 0)" }, { status: 400 });
    const str = (v: unknown, n = 300) => (v ? String(v).trim().slice(0, n) : null);
    const b = await db.business.findUnique({ where: { id: businessId } });
    if (!b) return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 });
    const cur = String(currency || b.currency || "EUR").toUpperCase().slice(0, 3);
    if (test) {
      const meta = metaTestCode && b.metaPixelId ? await sendPurchase(b.metaPixelId, { orderId: id, value, currency: cur, email: str(email, 200), fbc: str(fbc), fbp: str(fbp), url: str(url), when: new Date() }, String(metaTestCode)).catch((e) => ({ error: e.message })) : undefined;
      const google = gclid && b.googleCustomerId && b.conversionActionId ? await sendClickConversion(b.googleCustomerId, b.conversionActionId, { gclid: String(gclid), value, currency: cur, orderId: id, when: new Date() }, true).then(() => ({ ok: true })).catch((e) => ({ error: e.message })) : undefined;
      return NextResponse.json({ ok: true, test: true, channel: gclid ? "google" : fbc ? "meta" : "organic", google, meta });
    }
    // Stripe reintenta el webhook: un pedido que ya llegó no se vuelve a apuntar.
    if (await db.sale.findFirst({ where: { businessId, orderId: id } })) return NextResponse.json({ ok: true, duplicate: true });
    const sale = await db.sale.create({ data: {
      businessId, orderId: id, amount: value, currency: cur,
      email: (str(email, 200) || "").toLowerCase(), gclid: str(gclid), fbc: str(fbc), fbp: str(fbp),
      channel: gclid ? "google" : fbc ? "meta" : "organic",
    } });
    // La venta se pasa a cada plataforma para que la atribuya a su anuncio. Un fallo se apunta y no tumba el aviso de la web.
    const done: string[] = [];
    if (sale.gclid && b.googleCustomerId && b.conversionActionId) {
      try { await sendClickConversion(b.googleCustomerId, b.conversionActionId, { gclid: sale.gclid, value, currency: cur, orderId: id, when: sale.createdAt }); await db.sale.update({ where: { id: sale.id }, data: { uploaded: true } }); done.push("Google"); }
      catch (e: any) { await log(businessId, "ERROR_VENTA", `Google: ${e.message}`, true); }
    }
    if (b.metaPixelId) {
      try { await sendPurchase(b.metaPixelId, { orderId: id, value, currency: cur, email: sale.email, fbc: sale.fbc, fbp: sale.fbp, url: str(url), when: sale.createdAt }); await db.sale.update({ where: { id: sale.id }, data: { metaSent: true } }); done.push("Meta"); }
      catch (e: any) { await log(businessId, "ERROR_VENTA", `Meta: ${e.message}`, true); }
    }
    await log(businessId, "VENTA", `${value} ${cur} · pedido ${id} · canal ${sale.channel}${done.length ? ` · enviada a ${done.join(" y ")}` : ""}.`, true);
    return NextResponse.json({ ok: true, id: sale.id });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
