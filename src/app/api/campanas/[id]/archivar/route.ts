import { NextResponse } from "next/server";
import { archiveCampaign } from "@/lib/engine";
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    await archiveCampaign(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
