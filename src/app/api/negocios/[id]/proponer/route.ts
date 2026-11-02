import { NextResponse } from "next/server";
import { proposeCampaign, proposeMetaCampaign } from "@/lib/engine";
export const maxDuration = 120;
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    // Meta: una imagen por línea, con su enlace opcional detrás de "|" (p. ej. la página del cuadro).
    const images = String(body.imageUrls || "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter(([u]) => u).map(([url, link]) => ({ url, link: link || undefined }));
    if (body.channel === "meta") return NextResponse.json({ campaignId: await proposeMetaCampaign(params.id, { images, videoUrl: body.videoUrl || undefined }) });
    return NextResponse.json({ campaignId: await proposeCampaign(params.id) });
  }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
