import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
// Editar la ficha (incluida la cuenta de Google Ads y los topes de prudencia)
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const data = await req.json();
    const allowed = ["name", "url", "sells", "audience", "country", "language", "currency", "price", "marginPct", "saleEvent", "cacCap", "maxCpc", "dailyBudget", "totalCap", "googleCustomerId", "notes"];
    const patch: any = {};
    for (const k of allowed) if (k in data) patch[k] = data[k];
    for (const k of ["price", "marginPct", "cacCap", "maxCpc", "dailyBudget", "totalCap"]) if (k in patch) patch[k] = Number(patch[k]);
    if (patch.googleCustomerId) patch.googleCustomerId = String(patch.googleCustomerId).replace(/-/g, "");
    const b = await db.business.update({ where: { id: params.id }, data: patch });
    await log(b.id, "FICHA", `Ficha editada: ${Object.keys(patch).join(", ")}`);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await db.business.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
