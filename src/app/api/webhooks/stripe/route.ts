import { NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { uploadClickConversion } from "@/lib/google/ads";
import { log } from "@/lib/engine";
// La venta real. Un webhook por negocio: /api/webhooks/stripe?negocio=<id>
export async function POST(req: Request) {
  const businessId = new URL(req.url).searchParams.get("negocio");
  if (!businessId) return NextResponse.json({ error: "Falta ?negocio=" }, { status: 400 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder");
    event = stripe.webhooks.constructEvent(raw, req.headers.get("stripe-signature") || "", process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e: any) { return NextResponse.json({ error: `Firma: ${e.message}` }, { status: 400 }); }

  const paid = event.type === "checkout.session.completed" || event.type === "invoice.paid" || event.type === "payment_intent.succeeded";
  if (!paid) return NextResponse.json({ ok: true, ignored: event.type });
  const o: any = event.data.object;
  const email: string | undefined = (o.customer_details?.email || o.customer_email || o.receipt_email || "").toLowerCase();
  const amount = Number(o.amount_total ?? o.amount_paid ?? o.amount_received ?? 0) / 100;
  const currency = String(o.currency || "eur").toUpperCase();
  if (!email || !amount) return NextResponse.json({ ok: true, ignored: "sin email o importe" });

  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 });
  const v = await db.visitor.findFirst({ where: { email }, orderBy: { createdAt: "desc" } });
  const sale = await db.sale.create({ data: { businessId, email, amount, currency, gclid: v?.gclid, channel: v?.gclid ? "google" : v?.fbclid ? "meta" : v?.ttclid ? "tiktok" : "organic" } });
  if (v?.gclid && b.googleCustomerId && b.conversionActionId) {
    try {
      await uploadClickConversion(b.googleCustomerId, b.conversionActionId, v.gclid, amount, currency, new Date());
      await db.sale.update({ where: { id: sale.id }, data: { uploaded: true } });
      await log(businessId, "VENTA", `${amount} ${currency} atribuida a Google (subida como conversión).`, true);
    } catch (e: any) { await log(businessId, "ERROR_VENTA", e.message, true); }
  } else {
    await log(businessId, "VENTA", `${amount} ${currency} · canal ${sale.channel}.`, true);
  }
  return NextResponse.json({ ok: true });
}
