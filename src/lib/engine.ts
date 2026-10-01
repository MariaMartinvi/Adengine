// Núcleo del motor: ficha -> propuesta -> campaña en pausa -> sincronización diaria con reglas de prudencia.
import { db } from "./db";
import * as ads from "./google/ads";
import { fichaFromSite } from "./ai";
import { fetchSiteText } from "./fetchSite";
import { pickKeywords, writeAds, writeMetaAds } from "./ai";
import * as meta from "./meta/ads";

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
  await db.campaign.deleteMany({ where: { businessId, status: "DRAFT", channel: "google" } });
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

// ---------- Meta (Facebook + Instagram) ----------
// Propuesta: textos de la IA + imagen (y vídeo opcional) subidos a la biblioteca de la cuenta. No crea ni gasta nada.
export async function proposeMetaCampaign(businessId: string, media: { imageUrls: string[]; videoUrl?: string }) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  const missing = [["cuenta de Meta", b.metaAdAccountId], ["píxel", b.metaPixelId], ["página de Facebook", b.metaPageId], ["anunciante", b.metaAdvertiser]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Completa en la ficha: ${missing.join(", ")}.`);
  if (!media.imageUrls.length) throw new Error("Falta al menos una imagen (la primera también sirve de miniatura del vídeo).");
  const copy = await writeMetaAds(b);
  const hashes: string[] = [];
  for (const url of media.imageUrls) hashes.push(await meta.uploadImage(b.metaAdAccountId!, url));
  const videoId = media.videoUrl ? await meta.uploadVideo(b.metaAdAccountId!, media.videoUrl, `${b.name} · vídeo`) : null;
  const ad = (mediaType: string, mediaUrl: string, mediaRef: string) => ({ mediaType, mediaUrl, mediaRef, finalUrl: b.url, headlines: [copy.headline], descriptions: [copy.message, copy.description] });
  await db.campaign.deleteMany({ where: { businessId, status: "DRAFT", channel: "meta" } });
  const c = await db.campaign.create({ data: {
    businessId, channel: "meta", name: `${b.name} · Meta ${b.country}`, dailyBudget: b.dailyBudget, totalCap: b.totalCap,
    ads: { create: [...media.imageUrls.map((u, i) => ad("image", u, hashes[i])), ...(videoId ? [ad("video", media.videoUrl!, videoId)] : [])] },
  } });
  await log(businessId, "PROPUESTA", `Meta: ${media.imageUrls.length} imagen${media.imageUrls.length > 1 ? "es" : ""}${videoId ? " + vídeo" : ""}, ${b.dailyBudget} ${b.currency}/día, tope ${b.totalCap}. Pendiente de tu aprobación.`);
  return c.id;
}

// Añade una portada a una campaña de Meta ya creada: mismo conjunto (mismo presupuesto) y mismos textos.
export async function addMetaImageAd(campaignId: string, imageUrl: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, ads: { orderBy: { id: "asc" } } } });
  const b = c.business;
  if (c.channel !== "meta" || !c.metaAdSetId) throw new Error("Solo se pueden añadir portadas a una campaña de Meta ya creada.");
  if (!imageUrl) throw new Error("Falta la URL de la imagen.");
  const base = c.ads.find((a) => a.mediaType === "image") || c.ads[0];
  const [headline] = base.headlines as string[];
  const [message, description] = base.descriptions as string[];
  const hash = await meta.uploadImage(b.metaAdAccountId!, imageUrl);
  const n = c.ads.length + 1;
  const metaAdId = await meta.createAd(b.metaAdAccountId!, c.metaAdSetId, `${c.name} · image ${n}`, { pageId: b.metaPageId!, link: b.url, thumbHash: hash }, { mediaType: "image", mediaRef: hash, message, headline, description });
  await db.ad.create({ data: { campaignId: c.id, mediaType: "image", mediaUrl: imageUrl, mediaRef: hash, metaAdId, finalUrl: b.url, headlines: [headline], descriptions: [message, description] } });
  await log(b.id, "ANUNCIO_AÑADIDO", `Nueva portada en Meta (anuncio ${n}): ${imageUrl}`);
}

// Aprobación: crea en Meta campaña EN PAUSA + conjunto con presupuesto total (freno nativo) + un anuncio por creatividad.
export async function approveMetaCampaign(campaignId: string, edits: { dailyBudget: number; totalCap: number; message: string; headline: string; description: string }) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, ads: true } });
  const b = c.business;
  if (c.status !== "DRAFT" || c.channel !== "meta") throw new Error("Esta propuesta ya no está pendiente.");
  if (!(edits.dailyBudget > 0) || !(edits.totalCap >= edits.dailyBudget)) throw new Error("El gasto total debe ser al menos el presupuesto diario.");
  const copy = { message: edits.message.trim().slice(0, 300), headline: edits.headline.trim().slice(0, 40), description: edits.description.trim().slice(0, 30) };
  for (const a of c.ads) if (a.mediaType === "video" && !(await meta.videoReady(a.mediaRef!))) throw new Error("Meta aún está procesando el vídeo. Prueba de nuevo en un minuto.");
  const image = c.ads.find((a) => a.mediaType === "image")!;
  const res = await meta.createCampaign(b.metaAdAccountId!, {
    name: c.name, dailyBudget: edits.dailyBudget, totalCap: edits.totalCap, country: b.country, ageMin: 35, ageMax: 48,
    pageId: b.metaPageId!, pixelId: b.metaPixelId!, link: b.url, thumbHash: image.mediaRef!, advertiser: b.metaAdvertiser!,
    ads: c.ads.map((a) => ({ mediaType: a.mediaType as "image" | "video", mediaRef: a.mediaRef!, ...copy })),
  });
  await db.$transaction([
    db.campaign.update({ where: { id: c.id }, data: { status: "PAUSED", dailyBudget: edits.dailyBudget, totalCap: edits.totalCap, metaCampaignId: res.campaignId, metaAdSetId: res.adSetId } }),
    ...c.ads.map((a, i) => db.ad.update({ where: { id: a.id }, data: { metaAdId: res.adIds[i], headlines: [copy.headline], descriptions: [copy.message, copy.description] } })),
  ]);
  await log(b.id, "CAMPAÑA_CREADA", `Creada en Meta en pausa (id ${res.campaignId}): ${c.ads.length} anuncios, ${edits.totalCap} ${b.currency} en total hasta agotar (~${edits.dailyBudget}/día).`);
}

export async function setStatus(campaignId: string, status: "ENABLED" | "PAUSED" | "STOPPED") {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true } });
  if (c.channel === "meta") {
    if (!c.metaCampaignId) throw new Error("La campaña aún no existe en Meta.");
    await meta.setCampaignStatus(c.metaCampaignId, status === "ENABLED" ? "ACTIVE" : "PAUSED");
  } else {
    if (!c.googleCampaignId) throw new Error("La campaña aún no existe en Google Ads.");
    await ads.setCampaignStatus(c.business.googleCustomerId!, c.googleCampaignId, status === "ENABLED" ? "ENABLED" : "PAUSED");
  }
  await db.campaign.update({ where: { id: c.id }, data: { status } });
  await log(c.businessId, status === "ENABLED" ? "ACTIVADA" : status === "STOPPED" ? "DETENIDA" : "PAUSADA", `Campaña ${c.name}`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Meta · regla de anuncio: gasta 2× el CAC tope sin ninguna conversión -> se pausa. Pura, para poder probarla.
export function metaAdsToPause<T extends { id: string; status: string }>(ads: T[], totals: Map<string, { cost: number; conversions: number }>, cacCap: number) {
  return ads.filter((a) => {
    const t = totals.get(a.id);
    return a.status === "ENABLED" && !!t && t.conversions === 0 && t.cost >= 2 * cacCap;
  });
}

// Meta: métricas por anuncio y día + frenos. La campaña dura poco, así que se mira desde su creación.
export async function syncMetaCampaign(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, ads: true } });
  if (!c.metaCampaignId || c.status === "DRAFT") return;
  const b = c.business;
  const today = iso(new Date());
  const rows = await meta.adInsights(c.metaCampaignId, iso(c.createdAt), today);
  const byMetaId = new Map(c.ads.map((a) => [a.metaAdId, a]));
  for (const r of rows) {
    const ad = byMetaId.get(r.adId);
    if (!ad) continue;
    const data = { impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions };
    const existing = await db.dailyMetric.findFirst({ where: { campaignId: c.id, adId: ad.id, date: new Date(r.date) } });
    if (existing) await db.dailyMetric.update({ where: { id: existing.id }, data });
    else await db.dailyMetric.create({ data: { campaignId: c.id, adId: ad.id, date: new Date(r.date), ...data } });
  }
  if (c.status !== "ENABLED") return;

  // Regla 1 · tope de gasto total (Meta ya no gasta más por el presupuesto total; aquí se refleja y se detiene).
  const tot = await db.dailyMetric.aggregate({ where: { campaignId: c.id }, _sum: { cost: true } });
  const spent = tot._sum.cost || 0;
  if (spent >= c.totalCap) {
    await setStatus(c.id, "STOPPED");
    await log(b.id, "REGLA", `Campaña detenida: gasto acumulado ${spent.toFixed(2)} ≥ tope ${c.totalCap}.`, true);
    return;
  }

  // Regla 2 · por anuncio: 2× CAC tope sin conversiones -> pausa automática.
  const sums = await db.dailyMetric.groupBy({ by: ["adId"], where: { campaignId: c.id, adId: { not: null } }, _sum: { cost: true, conversions: true } });
  const totals = new Map(sums.map((s) => [s.adId!, { cost: s._sum.cost || 0, conversions: s._sum.conversions || 0 }]));
  for (const ad of metaAdsToPause(c.ads, totals, b.cacCap)) {
    await meta.setAdStatus(ad.metaAdId!, "PAUSED");
    await db.ad.update({ where: { id: ad.id }, data: { status: "PAUSED" } });
    await log(b.id, "REGLA", `Anuncio de ${ad.mediaType === "video" ? "vídeo" : "imagen"} pausado: ${totals.get(ad.id)!.cost.toFixed(2)} gastados sin conversiones (2× CAC tope ${b.cacCap}).`, true);
  }
}

// Sincronización diaria + reglas. Baja y pausa sola; subir siempre es propuesta.
export async function syncCampaign(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, keywords: true } });
  if (c.channel === "meta") return syncMetaCampaign(c.id);
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
