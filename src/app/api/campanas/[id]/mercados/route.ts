import { NextResponse } from "next/server";
import { addMetaMarket } from "@/lib/engine";
export const maxDuration = 120;
// Grupo de países en una campaña de Meta: conjunto propio con sus países, su parte del presupuesto y sus textos.
// { label, countries: "MX,CL", sharePct: 35, headline?, message?, description? }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { label, countries, sharePct, headline, message, description } = await req.json();
    const name = String(label || "").trim().slice(0, 40);
    const key = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await addMetaMarket(params.id, { key, label: name, countries: String(countries || ""), share: Number(sharePct) / 100 },
      { headline: String(headline || "").slice(0, 255), message: String(message || "").slice(0, 2000), description: String(description || "").slice(0, 255) });
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
