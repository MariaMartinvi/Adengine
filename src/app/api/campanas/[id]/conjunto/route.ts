import { NextResponse } from "next/server";
import { setSetBudget } from "@/lib/engine";
// Presupuesto de un solo conjunto de Meta. { set: "main" | "rt" | clave del grupo, remaining: 26.8, endTime: "2026-11-26T10:59:55+01:00" }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { set, remaining, endTime } = await req.json();
    const end = new Date(String(endTime || ""));
    if (isNaN(end.getTime())) return NextResponse.json({ error: "Fecha de fin no válida" }, { status: 400 });
    await setSetBudget(params.id, String(set || ""), Number(remaining), end);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
