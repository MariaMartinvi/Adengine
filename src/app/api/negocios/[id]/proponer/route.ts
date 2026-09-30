import { NextResponse } from "next/server";
import { proposeCampaign } from "@/lib/engine";
export const maxDuration = 120;
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try { return NextResponse.json({ campaignId: await proposeCampaign(params.id) }); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
