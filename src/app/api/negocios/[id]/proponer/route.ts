import { NextResponse } from "next/server";
import { proposeCampaign, proposeMetaCampaign } from "@/lib/engine";
export const maxDuration = 120;
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.channel === "meta") return NextResponse.json({ campaignId: await proposeMetaCampaign(params.id, { imageUrls: String(body.imageUrls || "").split(/\s+/).filter(Boolean), videoUrl: body.videoUrl || undefined }) });
    return NextResponse.json({ campaignId: await proposeCampaign(params.id) });
  }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
