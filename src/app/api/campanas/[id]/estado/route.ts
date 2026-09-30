import { NextResponse } from "next/server";
import { setStatus } from "@/lib/engine";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { status } = await req.json();
    if (!["ENABLED", "PAUSED", "STOPPED"].includes(status)) return NextResponse.json({ error: "Estado no válido" }, { status: 400 });
    await setStatus(params.id, status);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
