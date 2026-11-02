import { NextResponse } from "next/server";
import { rebuildMetaAds } from "@/lib/engine";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { links } = await req.json().catch(() => ({}));
    await rebuildMetaAds(params.id, links || {});
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
