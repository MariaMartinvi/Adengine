import { NextResponse } from "next/server";
import { rewriteDraftMetaAd } from "@/lib/engine";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { feedback } = await req.json();
    return NextResponse.json({ ok: true, ...(await rewriteDraftMetaAd(params.id, String(feedback || ""))) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
