import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accessToken } from "@/lib/google/auth";
import { GEO, LANG, listAccessibleCustomers } from "@/lib/google/ads";
// TEMPORAL: muestra la respuesta en bruto de generateKeywordIdeas para diagnosticar métricas a 0. Borrar tras el diagnóstico.
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
  const q = new URL(req.url).searchParams;
  const id = q.get("negocio");
  if (!id) return NextResponse.json({ error: "Falta ?negocio=" }, { status: 400 });
  const b = await db.business.findUniqueOrThrow({ where: { id } });
  // ?customer=XXXXXXXXXX prueba la consulta desde otra cuenta del MCC; ?list=1 lista las cuentas del MCC
  if (q.get("list")) return NextResponse.json(await listAccessibleCustomers());
  const customer = (q.get("customer") || b.googleCustomerId || "").replace(/-/g, "");
  const seeds = (b.notes?.match(/Semillas: (.*)$/m)?.[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const body = {
    language: `languageConstants/${LANG[b.language] || LANG.es}`,
    geoTargetConstants: [`geoTargetConstants/${GEO[b.country] || GEO.ES}`],
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
    pageSize: 500,
    keywordAndUrlSeed: { url: b.url, keywords: seeds.slice(0, 20) },
  };
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    "login-customer-id": process.env.GOOGLE_LOGIN_CUSTOMER_ID!.replace(/-/g, ""),
  };
  if (process.env.GOOGLE_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_DEVELOPER_TOKEN;
  const v = process.env.GOOGLE_ADS_API_VERSION || "v22";
  const r = await fetch(`https://googleads.googleapis.com/${v}/customers/${customer}:generateKeywordIdeas`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  let j: any; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 2000) }; }
  const results = j.results || [];
  return NextResponse.json({
    status: r.status, version: v, customerId: customer, loginCustomerId: headers["login-customer-id"], devToken: !!headers["developer-token"],
    seeds, total: results.length, conMetricas: results.filter((x: any) => x.keywordIdeaMetrics?.avgMonthlySearches).length,
    primeros: results.slice(0, 5), error: j.error,
  });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
