import { NextResponse } from "next/server";
import { createBusinessFromUrl } from "@/lib/engine";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "Falta la URL" }, { status: 400 });
    const b = await createBusinessFromUrl(url);
    return NextResponse.json({ id: b.id });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
