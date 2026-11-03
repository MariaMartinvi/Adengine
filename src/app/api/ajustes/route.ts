import { NextResponse } from "next/server";
import { db } from "@/lib/db";
// Ajustes de la cartera. monthlyBudget: presupuesto mensual para todas las campañas (vacío o 0 = sin límite).
export async function PATCH(req: Request) {
  try {
    const { monthlyBudget } = await req.json();
    const n = Number(monthlyBudget);
    if (monthlyBudget !== "" && monthlyBudget != null && !(n >= 0)) return NextResponse.json({ error: "Importe no válido" }, { status: 400 });
    if (!n) await db.setting.deleteMany({ where: { key: "monthlyBudget" } });
    else await db.setting.upsert({ where: { key: "monthlyBudget" }, create: { key: "monthlyBudget", value: String(n) }, update: { value: String(n) } });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
