import { NextResponse } from "next/server";
import { syncCampaign } from "@/lib/engine";
export const maxDuration = 120;
// Lectura manual de los datos de una campaña (lo mismo que hace la tarea de las 06:00 y las 16:00).
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    await syncCampaign(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
