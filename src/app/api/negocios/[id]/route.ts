import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
// Editar la ficha (incluida la cuenta de Google Ads y los topes de prudencia)
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const data = await req.json();
    const allowed = ["name", "url", "sells", "audience", "country", "language", "currency", "price", "marginPct", "saleEvent", "cacCap", "maxCpc", "dailyBudget", "totalCap", "googleCustomerId", "metaAdAccountId", "metaPixelId", "metaPageId", "metaAdvertiser", "metaInstagramId", "metaRtShare", "ageMin", "ageMax", "metaCta", "googlePath1", "googlePath2", "notes"];
    const patch: any = {};
    for (const k of allowed) if (k in data) patch[k] = data[k];
    for (const k of ["price", "marginPct", "cacCap", "maxCpc", "dailyBudget", "totalCap", "ageMin", "ageMax", "metaRtShare"]) if (k in patch) patch[k] = Number(patch[k]);
    if ("metaCta" in patch && !["SHOP_NOW", "LEARN_MORE", "SIGN_UP"].includes(patch.metaCta)) return NextResponse.json({ error: "Botón no válido" }, { status: 400 });
    // Ruta visible del enlace de Google (cuadrosconalma.com/comprar/cuadros): hasta 15 caracteres por parte, sin espacios.
    for (const k of ["googlePath1", "googlePath2"]) if (k in patch) patch[k] = String(patch[k] || "").trim().replace(/\s+/g, "-").replace(/^\/+|\/+$/g, "").slice(0, 15) || null;
    if (patch.googleCustomerId) patch.googleCustomerId = String(patch.googleCustomerId).replace(/-/g, "");
    if (patch.metaAdAccountId) patch.metaAdAccountId = String(patch.metaAdAccountId).replace(/^act_/, "");
    const b = await db.business.update({ where: { id: params.id }, data: patch });
    await log(b.id, "FICHA", `Ficha editada: ${Object.keys(patch).join(", ")}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
// Borrar la ficha (en cascada). No con una campaña activa: sin ficha, el cron no la frena y seguiría gastando.
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const b = await db.business.findUnique({ where: { id: params.id }, include: { campaigns: { where: { status: "ENABLED" } } } });
  if (!b) return NextResponse.json({ error: "La ficha no existe" }, { status: 404 });
  if (b.campaigns.length) return NextResponse.json({ error: "Pausa la campaña antes de borrar la ficha" }, { status: 409 });
  await db.business.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
