import { NextResponse } from "next/server";
import { replaceDraftMedia } from "@/lib/engine";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { url, kind } = await req.json();
    if (!/^https:\/\//.test(String(url || "")) || !["image", "video"].includes(kind)) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
    await replaceDraftMedia(params.id, url, kind);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
