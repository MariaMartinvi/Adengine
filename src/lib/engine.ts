// Núcleo del motor: ficha -> propuesta -> campaña en pausa -> sincronización diaria con reglas de prudencia.
import { db } from "./db";
import * as ads from "./google/ads";
import { fichaFromSite } from "./ai";
import { fetchSiteText } from "./fetchSite";
import { pickKeywords, writeAds } from "./ai";

export async function log(businessId: string, kind: string, detail: string, auto = false) {
  await db.actionLog.create({ data: { businessId, kind, detail, auto } });
}

export async function createBusinessFromUrl(url: string) {
  const text = await fetchSiteText(url);
  const f = await fichaFromSite(text);
  const b = await db.business.create({ data: {
    name: f.name, url: url.startsWith("http") ? url : `https://${url}`, sells: f.sells, audience: f.audience,
    country: f.country || "ES", language: f.language || "es", currency: f.currency || "EUR",
    price: f.price, marginPct: f.marginPct, saleEvent: f.saleEvent, cacCap: f.cacCap, maxCpc: f.maxCpc,
    dailyBudget: f.dailyBudget, totalCap: f.totalCap, notes: `${f.notes}\n\nSemillas: ${f.seeds.join(", ")}`,
  } });
  await log(b.id, "FICHA", `Ficha creada desde ${url}`);
  return b;
}

function seedsFromNotes(notes?: string | null) {
  const m = notes?.match(/Semillas: (.*)$/m);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}

// Genera la propuesta: palabras con CPC reales de Google + anuncios. No toca Google Ads (solo lee).
export async function proposeCampaign(businessId: string) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  if (!b.googleCustomerId) throw new Error("Asigna primero la cuenta de Google Ads del negocio.");
  const seeds = seedsFromNotes(b.notes);
  const ideas = await ads.keywordIdeas(b.googleCustomerId, seeds, b.country, b.language, b.url);
  if (!ideas.length) throw new Error("Google no devolvió ideas de palabras. Revisa las semillas de la ficha.");
  const picked = await pickKeywords(b, ideas);
  const byText = new Map(ideas.map((i) => [i.text.toLowerCase(), i]));
  const adsCopy = await writeAds(b, picked.keywords.map((k) => k.text));

  // Borra borradores anteriores: la propuesta es siempre la última.
  await db.campaign.deleteMany({ where: { businessId, status: "DRAFT" } });
  const c = await db.campaign.create({ data: {
    businessId, name: `${b.name} · Búsqueda ${b.country}`, dailyBudget: b.dailyBudget, totalCap: b.totalCap,
    keywords: { create: picked.keywords.map((k) => {
      const i = byText.get(k.text.toLowerCase());
      // Puja inicial: entre el mínimo estimado de Google y el techo de la ficha, nunca por encima del techo.
      const bid = Math.min(b.maxCpc, Math.max(0.2, i ? Math.max(i.cpcLow * 0.9, 0.2) : b.maxCpc * 0.7));
      return { text: k.text, matchType: k.matchType, maxCpc: Math.round(bid * 100) / 100, estCpcLow: i?.cpcLow, estCpcHigh: i?.cpcHigh, volume: i?.volume, intent: k.intent };
    }) },
    ads: { create: adsCopy.map((a) => ({ headlines: a.headlines, descriptions: a.descriptions, finalUrl: b.url })) },
    proposals: { create: picked.negatives.map((n) => ({ kind: "ADD_NEGATIVE", target: n, payload: { text: n }, reason: "Excluir búsquedas sin intención de compra", status: "APPROVED" })) },
  } });
  await log(businessId, "PROPUESTA", `${picked.keywords.length} palabras, ${adsCopy.length} anuncios, ${picked.negatives.length} negativas. Pendiente de tu aprobación.`);
  return c.id;
}

// Aprobación: crea todo en Google Ads EN PAUSA. Activar es un paso aparte y manual.
export async function approveCampaign(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, keywords: true, ads: true, proposals: true } });
  const b = c.business;
  const kws = c.keywords.filter((k) => k.included);
  if (!kws.length) throw new Error("La campaña necesita al menos una palabra incluida.");
  if (!c.ads.length) throw new Error("La campaña necesita al menos un anuncio.");
  const over = kws.filter((k) => k.maxCpc > b.maxCpc);
  if (over.length) throw new Error(`Hay ${over.length} palabras con CPC máximo por encima del techo de la ficha (${b.maxCpc}). Bájalas o sube el techo.`);
  if (!b.conversionActionId) {
    const id = await ads.ensureConversionAction(b.googleCustomerId!, `Venta · ${b.name}`, b.currency);
    await db.business.update({ where: { id: b.id }, data: { conversionActionId: id } });
  }
  const res = await ads.createSearchCampaign(b.googleCustomerId!, {
    name: c.name, dailyBudget: c.dailyBudget, country: b.country, language: b.language, finalUrl: b.url,
    keywords: kws.map((k) => ({ text: k.text, matchType: k.matchType as "EXACT" | "PHRASE", maxCpc: k.maxCpc })),
    ads: c.ads.map((a) => ({ headlines: a.headlines as unknown as string[], descriptions: a.descriptions as unknown as string[] })),
    negatives: c.proposals.filter((p) => p.kind === "ADD_NEGATIVE" && p.status === "APPROVED").map((p) => p.target),
    schedule: true,
  });
  await db.$transaction([
    db.campaign.update({ where: { id: c.id }, data: { status: "PAUSED", googleCampaignId: res.campaignId, googleBudgetId: res.budgetId, googleAdGroupId: res.adGroupId } }),
    ...kws.map((k, i) => db.keyword.update({ where: { id: k.id }, data: { googleCriterionId: res.criterionIds[i] } })),
    ...c.ads.map((a, i) => db.ad.update({ where: { id: a.id }, data: { googleAdId: res.adIds[i] } })),
    db.keyword.deleteMany({ where: { campaignId: c.id, included: false } }),
  ]);
  await log(b.id, "CAMPAÑA_CREADA", `Creada en Google Ads en pausa (id ${res.campaignId}): ${kws.length} palabras, ${c.dailyBudget} ${b.currency}/día, tope total ${c.totalCap}.`);
}

export async function setStatus(campaignId: string, status: "ENABLED" | "PAUSED" | "STOPPED") {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true } });
  if (!c.googleCampaignId) throw new Error("La campaña aún no existe en Google Ads.");
  await ads.setCampaignStatus(c.business.googleCustomerId!, c.googleCampaignId, status === "ENABLED" ? "ENABLED" : "PAUSED");
  await db.campaign.update({ where: { id: c.id }, data: { status } });
  await log(c.businessId, status === "ENABLED" ? "ACTIVADA" : status === "STOPPED" ? "DETENIDA" : "PAUSADA", `Campaña ${c.name}`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Sincronización diaria + reglas. Baja y pausa sola; subir siempre es propuesta.
export async function syncCampaign(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, keywords: true } });
  if (!c.googleCampaignId || c.status === "DRAFT") return;
  const b = c.business;
  const cid = b.googleCustomerId!;
  const to = new Date(); to.setUTCDate(to.getUTCDate() - 1);
  const from = new Date(to); from.setUTCDate(from.getUTCDate() - 13);
  const rows = await ads.keywordMetrics(cid, c.googleCampaignId, iso(from), iso(to));
  const byCrit = new Map(c.keywords.map((k) => [k.googleCriterionId, k]));
  for (const r of rows) {
    const k = byCrit.get(r.criterionId);
    if (!k) continue;
    await db.dailyMetric.upsert({
      where: { campaignId_keywordId_date: { campaignId: c.id, keywordId: k.id, date: new Date(r.date) } },
      create: { campaignId: c.id, keywordId: k.id, date: new Date(r.date), impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, convValue: r.convValue },
      update: { impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, convValue: r.convValue },
    });
  }
  if (c.status !== "ENABLED") return;

  // Regla 1 · tope de gasto total de la campaña -> pausa automática.
  const tot = await db.dailyMetric.aggregate({ where: { campaignId: c.id }, _sum: { cost: true, conversions: true } });
  const spent = tot._sum.cost || 0;
  if (spent >= c.totalCap) {
    await setStatus(c.id, "STOPPED");
    await log(b.id, "REGLA", `Campaña detenida: gasto acumulado ${spent.toFixed(2)} ≥ tope ${c.totalCap}.`, true);
    return;
  }

  // Reglas por palabra sobre los últimos 14 días.
  for (const k of c.keywords) {
    if (k.status !== "ENABLED" || !k.googleCriterionId) continue;
    const m = await db.dailyMetric.aggregate({ where: { keywordId: k.id, date: { gte: from } }, _sum: { cost: true, clicks: true, conversions: true } });
    const cost = m._sum.cost || 0, clicks = m._sum.clicks || 0, conv = m._sum.conversions || 0;
    // Regla 2 · gasta 2× el CAC tope sin vender -> pausa automática.
    if (conv === 0 && cost >= 2 * b.cacCap) {
      await ads.updateKeyword(cid, c.googleAdGroupId!, k.googleCriterionId, { status: "PAUSED" });
      await db.keyword.update({ where: { id: k.id }, data: { status: "PAUSED" } });
      await log(b.id, "REGLA", `Palabra «${k.text}» pausada: ${cost.toFixed(2)} gastados sin ventas (2× CAC tope ${b.cacCap}).`, true);
      continue;
    }
    // Regla 3 · vende por debajo del 70 % del CAC tope -> propone subir puja (tú apruebas).
    if (conv >= 2 && cost / conv <= 0.7 * b.cacCap) {
      const newBid = Math.min(b.maxCpc, Math.round(k.maxCpc * 1.15 * 100) / 100);
      if (newBid > k.maxCpc) {
        const exists = await db.proposal.findFirst({ where: { campaignId: c.id, kind: "RAISE_BID", target: k.id, status: "PENDING" } });
        if (!exists) await db.proposal.create({ data: { campaignId: c.id, kind: "RAISE_BID", target: k.id, payload: { maxCpc: newBid }, reason: `«${k.text}» vende a ${(cost / conv).toFixed(2)} por venta (tope ${b.cacCap}). Subir puja de ${k.maxCpc} a ${newBid}.` } });
      }
    }
    // Regla 4 · muchos clics, cero ventas, CPC alto -> propone bajar puja.
    if (conv === 0 && clicks >= 15 && cost / clicks > k.maxCpc * 0.85) {
      const newBid = Math.round(k.maxCpc * 0.8 * 100) / 100;
      const exists = await db.proposal.findFirst({ where: { campaignId: c.id, kind: "LOWER_BID", target: k.id, status: "PENDING" } });
      if (!exists) await db.proposal.create({ data: { campaignId: c.id, kind: "LOWER_BID", target: k.id, payload: { maxCpc: newBid }, reason: `«${k.text}»: ${clicks} clics a ${(cost / clicks).toFixed(2)} sin ventas. Bajar puja a ${newBid}.` } });
    }
  }

  // Regla 5 · términos de búsqueda con gasto y sin ventas -> propone negativas.
  try {
    const terms = await ads.searchTerms(cid, c.googleCampaignId, iso(from), iso(to));
    for (const t of terms.filter((t) => t.conversions === 0 && t.clicks >= 4)) {
      const exists = await db.proposal.findFirst({ where: { campaignId: c.id, kind: "ADD_NEGATIVE", target: t.term } });
      if (!exists) await db.proposal.create({ data: { campaignId: c.id, kind: "ADD_NEGATIVE", target: t.term, payload: { text: t.term }, reason: `Búsqueda «${t.term}»: ${t.clicks} clics, ${t.cost.toFixed(2)} gastados, sin ventas.` } });
    }
  } catch { /* search_term_view puede no tener datos aún */ }
}

export async function applyProposal(proposalId: string, decision: "APPROVED" | "DISMISSED") {
  const p = await db.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { campaign: { include: { business: true } } } });
  const c = p.campaign, b = c.business, cid = b.googleCustomerId!;
  if (decision === "APPROVED" && c.googleCampaignId) {
    const payload = p.payload as any;
    if (p.kind === "RAISE_BID" || p.kind === "LOWER_BID") {
      const k = await db.keyword.findUniqueOrThrow({ where: { id: p.target } });
      await ads.updateKeyword(cid, c.googleAdGroupId!, k.googleCriterionId!, { maxCpc: payload.maxCpc });
      await db.keyword.update({ where: { id: k.id }, data: { maxCpc: payload.maxCpc } });
      await log(b.id, "PUJA", `«${k.text}» → ${payload.maxCpc} (aprobado por ti).`);
    } else if (p.kind === "PAUSE_KEYWORD") {
      const k = await db.keyword.findUniqueOrThrow({ where: { id: p.target } });
      await ads.updateKeyword(cid, c.googleAdGroupId!, k.googleCriterionId!, { status: "PAUSED" });
      await db.keyword.update({ where: { id: k.id }, data: { status: "PAUSED" } });
      await log(b.id, "PAUSA", `«${k.text}» pausada (aprobado por ti).`);
    } else if (p.kind === "ADD_NEGATIVE") {
      await ads.addNegative(cid, c.googleCampaignId, payload.text);
      await log(b.id, "NEGATIVA", `Añadida negativa «${payload.text}» (aprobado por ti).`);
    }
  }
  await db.proposal.update({ where: { id: p.id }, data: { status: decision } });
}
