import { NextResponse } from "next/server";
import { retryGoogleImages } from "@/lib/engine";
export const maxDuration = 60;
export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    await retryGoogleImages(params.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
