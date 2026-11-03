// Núcleo del motor: ficha -> propuesta -> campaña en pausa -> sincronización diaria con reglas de prudencia.
import { db } from "./db";
import * as ads from "./google/ads";
import { fichaFromSite } from "./ai";
import { fetchSiteText } from "./fetchSite";
import { pickKeywords, writeAds, writeMetaAdFromRef, writeGoogleExtras, writeVideoPlan, type GoogleExtras } from "./ai";
import * as meta from "./meta/ads";
import sharp from "sharp";
import { put } from "@vercel/blob";
import { renderVideo, type VideoPlan } from "./video";
import { pickMetaAds } from "./metaPick";
import { metaAdsToPause, metaRotation } from "./metaRotation";
import { cacTestOf, validate } from "./validation";
import { budgetMoves } from "./budgetMoves";

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
// Antes de generar, copiar lo que funciona: sin referencias del canal no se propone.
async function latestRefs(businessId: string, channel: "meta" | "google") {
  const refs = await db.reference.findMany({ where: { businessId, channel }, orderBy: { createdAt: "desc" }, take: 10, include: { item: true } });
  if (!refs.length) throw new Error(`Añade al menos una referencia que funcione en ${channel === "meta" ? "Meta" : "Google"} antes de proponer.`);
  return refs.reverse();
}

export async function proposeCampaign(businessId: string) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  if (!b.googleCustomerId) throw new Error("Asigna primero la cuenta de Google Ads del negocio.");
  const refs = await latestRefs(businessId, "google");
  const seeds = seedsFromNotes(b.notes);
  const ideas = await ads.keywordIdeas(b.googleCustomerId, seeds, b.country, b.language, b.url);
  if (!ideas.length) throw new Error("Google no devolvió ideas de palabras. Revisa las semillas de la ficha.");
  // Páginas a las que puede llevar cada palabra: cuadros y colecciones de la ficha.
  const products = await db.product.findMany({ where: { businessId } });
  const pages = products.map((p) => ({ name: p.name, url: p.url, image: !!p.image }));
  const picked = await pickKeywords(b, ideas, pages);
  const byText = new Map(ideas.map((i) => [i.text.toLowerCase(), i]));
  // Grupos por tema: cada uno con su página y las fotos de sus cuadros (urls de imagen, no de página).
  const imageOf = new Map(products.map((p) => [p.url, p.image]));
  const groups = picked.groups.map((g) => ({ name: g.name, url: g.url, images: g.images.map((u) => imageOf.get(u)).filter((x): x is string => !!x) }));
  const adsCopy = await writeAds(b, picked.keywords.map((k) => k.text), refs, groups.map((g) => ({ name: g.name, keywords: picked.keywords.filter((k) => k.group === g.name).map((k) => k.text) })));
  if (!adsCopy.length) throw new Error("La IA no devolvió anuncios válidos (títulos de 30 caracteres como máximo, descripciones de 90). Vuelve a proponer.");
  // Un grupo sin anuncio no se muestra en Google: sus palabras pasan al grupo del primer anuncio.
  const withAd = new Set(adsCopy.map((a) => groups[a.group - 1]?.name).filter(Boolean));
  if (groups.length && withAd.size < groups.length) {
    const fallback = groups[adsCopy[0].group - 1]?.name || groups[0].name;
    for (const k of picked.keywords) if (!withAd.has(k.group!)) k.group = fallback;
  }

  // Recursos del anuncio (enlaces de sitio, destacados, extracto, promoción, precios). Si fallan, la propuesta sigue sin ellos.
  const extras = await writeGoogleExtras(b, pages).catch(() => null);

  // Borra borradores anteriores: la propuesta es siempre la última.
  await db.campaign.deleteMany({ where: { businessId, status: "DRAFT", channel: "google" } });
  const c = await db.campaign.create({ data: {
    businessId, name: `${b.name} · Búsqueda ${b.country}`, dailyBudget: b.dailyBudget, totalCap: b.totalCap,
    groups: groups.length ? groups : undefined,
    extras: extras || undefined,
    keywords: { create: picked.keywords.map((k) => {
      const i = byText.get(k.text.toLowerCase());
      // Puja inicial: entre el mínimo estimado de Google y el techo de la ficha, nunca por encima del techo.
      const bid = Math.min(b.maxCpc, Math.max(0.2, i ? Math.max(i.cpcLow * 0.9, 0.2) : b.maxCpc * 0.7));
      return { text: k.text, matchType: k.matchType, maxCpc: Math.round(bid * 100) / 100, estCpcLow: i?.cpcLow, estCpcHigh: i?.cpcHigh, volume: i?.volume, intent: k.intent, finalUrl: k.url || null, adGroup: groups.length ? k.group : null };
    }) },
    // Cada anuncio calca una referencia y lleva al producto de esa referencia (o a la web de la ficha).
    // Con grupos, cada anuncio es de su tema y lleva a la página del grupo; sin grupos, al producto de su referencia.
    ads: { create: adsCopy.map((a) => {
      const g = groups[a.group - 1];
      return { headlines: a.headlines, descriptions: a.descriptions, finalUrl: g?.url || refs[a.ref - 1]?.item?.url || b.url, basedOn: a.basedOn, adGroup: g?.name || null, path1: a.path[0] || null, path2: a.path[1] || null };
    }) },
    proposals: { create: picked.negatives.map((n) => ({ kind: "ADD_NEGATIVE", target: n, payload: { text: n }, reason: "Excluir búsquedas sin intención de compra", status: "APPROVED" })) },
  } });
  await log(businessId, "PROPUESTA", `${picked.keywords.length} palabras${groups.length ? ` en ${groups.length} grupos (${groups.map((g) => g.name).join(", ")})` : ""}, ${adsCopy.length} anuncios, ${picked.negatives.length} negativas. Pendiente de tu aprobación.`);
  return c.id;
}

// Imágenes para la campaña de búsqueda: las fotos de los cuadros de sus anuncios y, si faltan, de los cuadros
// de las referencias de Meta y del resto, hasta 3. Cada foto se recorta a 1,91:1 y 1:1, que es lo que pide Google.
// No es imprescindible: si Google no las acepta (p. ej. cuenta nueva), se apunta y la campaña sigue.
async function addGoogleImages(c: { id: string; name: string; googleCampaignId: string | null; ads: { finalUrl: string }[] }, b: { id: string; googleCustomerId: string | null }) {
  const products = await db.product.findMany({ where: { businessId: b.id, image: { not: null } }, include: { references: true } });
  const urls = new Set(c.ads.map((a) => a.finalUrl));
  const score = (p: (typeof products)[number]) => (urls.has(p.url) ? 2 : 0) + (p.references.some((r) => r.channel === "meta") ? 1 : 0);
  const pick = products.sort((x, y) => score(y) - score(x)).slice(0, 3);
  let added = 0; const errors: string[] = [];
  for (const p of pick) {
    try {
      const src = Buffer.from(await (await fetch(p.image!)).arrayBuffer());
      const wide = await sharp(src).resize(1200, 628, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
      const square = await sharp(src).resize(1200, 1200, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
      const tag = `${p.name} · ${Date.now()}`;
      await ads.addCampaignImage(b.googleCustomerId!, c.googleCampaignId!, `${tag} · horizontal`, wide);
      await ads.addCampaignImage(b.googleCustomerId!, c.googleCampaignId!, `${tag} · cuadrada`, square);
      added++;
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
  }
  await log(b.id, "IMAGENES", added ? `Campaña ${c.name}: imágenes de ${pick.slice(0, added).map((p) => p.name).join(", ")}.` : `Campaña ${c.name}: Google no aceptó las imágenes (${errors[0] || "sin productos con foto"}). La campaña sigue sin ellas.`);
}

// Fotos por grupo de anuncios: cada tema enseña sus cuadros (recortadas a 1,91:1 y 1:1). Igual que en campaña: si Google no las acepta, se apunta y sigue.
async function addGroupImages(name: string, groups: { name: string; images: string[] }[], adGroupIds: Record<string, string>, b: { id: string; googleCustomerId: string | null }, campaignId: string) {
  const done: string[] = []; const errors: string[] = [];
  for (const g of groups) {
    const agId = adGroupIds[g.name];
    if (!agId) continue;
    for (const url of g.images) {
      try {
        const src = Buffer.from(await (await fetch(url)).arrayBuffer());
        const tag = `${g.name} · ${Date.now()}`;
        const wide = await sharp(src).resize(1200, 628, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
        const square = await sharp(src).resize(1200, 1200, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer();
        // Por grupo, para que cada tema enseñe sus cuadros; si Google no lo admite por grupo, a nivel de campaña.
        try {
          await ads.addAdGroupImage(b.googleCustomerId!, agId, `${tag} · horizontal`, wide);
          await ads.addAdGroupImage(b.googleCustomerId!, agId, `${tag} · cuadrada`, square);
          done.push(g.name);
        } catch {
          await ads.addCampaignImage(b.googleCustomerId!, campaignId, `${tag} · horizontal (campaña)`, wide);
          await ads.addCampaignImage(b.googleCustomerId!, campaignId, `${tag} · cuadrada (campaña)`, square);
          done.push(`${g.name} (en la campaña)`);
        }
      } catch (e: any) { errors.push(`${g.name}: ${e.message}`); }
    }
  }
  await log(b.id, "IMAGENES", done.length ? `Campaña ${name}: fotos en los grupos ${Array.from(new Set(done)).join(", ")}.${errors.length ? ` Fallaron ${errors.length}.` : ""}` : `Campaña ${name}: Google no aceptó las fotos (${errors[0] || "ningún grupo con foto"}). La campaña sigue sin ellas.`);
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
    name: `${c.name} · ${stamp()}`, dailyBudget: c.dailyBudget, country: b.country, language: b.language, finalUrl: b.url, path1: b.googlePath1, path2: b.googlePath2,
    keywords: kws.map((k) => ({ text: k.text, matchType: k.matchType as "EXACT" | "PHRASE", maxCpc: k.maxCpc, finalUrl: k.finalUrl, group: k.adGroup })),
    ads: c.ads.map((a) => ({ headlines: a.headlines as unknown as string[], descriptions: a.descriptions as unknown as string[], finalUrl: a.finalUrl, group: a.adGroup, path1: a.path1 || b.googlePath1, path2: a.path1 ? a.path2 : b.googlePath2 })),
    negatives: c.proposals.filter((p) => p.kind === "ADD_NEGATIVE" && p.status === "APPROVED").map((p) => p.target),
    schedule: b.googleWeekdaysOnly,
  });
  await db.$transaction([
    db.campaign.update({ where: { id: c.id }, data: { status: "PAUSED", googleCampaignId: res.campaignId, googleBudgetId: res.budgetId, googleAdGroupId: res.adGroupId } }),
    ...kws.map((k, i) => db.keyword.update({ where: { id: k.id }, data: { googleCriterionId: res.criterionIds[i], googleAdGroupId: res.adGroupIds[k.adGroup || ""] || res.adGroupId } })),
    ...c.ads.map((a, i) => db.ad.update({ where: { id: a.id }, data: { googleAdId: res.adIds[i] } })),
    db.keyword.deleteMany({ where: { campaignId: c.id, included: false } }),
  ]);
  await log(b.id, "CAMPAÑA_CREADA", `Creada en Google Ads en pausa (id ${res.campaignId}): ${kws.length} palabras, ${c.dailyBudget} ${b.currency}/día, tope total ${c.totalCap}.`);
  if (c.extras) await createExtras(c.name, res.campaignId, c.extras as GoogleExtras, b);
  const groups = (c.groups as { name: string; url: string; images: string[] }[] | null) || [];
  if (groups.length) await addGroupImages(c.name, groups, res.adGroupIds, b, res.campaignId);
  else await addGoogleImages({ id: c.id, name: c.name, googleCampaignId: res.campaignId, ads: c.ads }, b);
}

// ---------- Meta (Facebook + Instagram) ----------
// Propuesta: un anuncio por referencia de Meta, con la imagen y el enlace de su producto y los textos calcados de la referencia.
// Las referencias de vídeo traen además el guion para grabar el nuestro. No crea ni gasta nada.
const MAX_META_ADS = 4;
export async function proposeMetaCampaign(businessId: string) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  const missing = [["cuenta de Meta", b.metaAdAccountId], ["píxel", b.metaPixelId], ["página de Facebook", b.metaPageId], ["anunciante", b.metaAdvertiser]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Completa en la ficha: ${missing.join(", ")}.`);
  const refs = await latestRefs(businessId, "meta");
  const sinCuadro = refs.filter((r) => !r.item?.image).length;
  if (sinCuadro) throw new Error(`Elige «Nuestro cuadro» (con imagen) en ${sinCuadro === 1 ? "1 referencia" : `${sinCuadro} referencias`} de Meta.`);
  const ads = [];
  for (const r of refs) {
    const copy = await writeMetaAdFromRef(b, r);
    const hash = await meta.uploadImage(b.metaAdAccountId!, r.item!.image!);
    // Referencia en vídeo → nuestro anuncio también es vídeo (obligatorio): guion con las fotos del producto; el panel lo monta después.
    const videoPlan = r.video ? await writeVideoPlan(b, r, r.item!.photos.length ? r.item!.photos : [r.item!.image!]) : undefined;
    ads.push({ mediaType: "image", mediaUrl: r.item!.image!, mediaRef: hash, finalUrl: r.item!.url, headlines: [copy.headline], descriptions: [copy.message, copy.description], basedOn: copy.basedOn, brief: copy.script || null, refId: r.id, videoPlan });
  }
  // Pocos anuncios para que Meta aprenda con poco presupuesto: el resto sale desmarcado.
  const since = new Map(refs.map((r) => [r.id, r.runningSince]));
  const keep = pickMetaAds(ads.map((x) => ({ refId: x.refId, video: !!x.videoPlan, since: since.get(x.refId) })), MAX_META_ADS);
  await db.campaign.deleteMany({ where: { businessId, status: "DRAFT", channel: "meta" } });
  const c = await db.campaign.create({ data: {
    businessId, channel: "meta", name: `${b.name} · Meta ${b.country}`, dailyBudget: b.dailyBudget, totalCap: b.totalCap,
    ads: { create: ads.map((x) => ({ ...x, included: keep.has(x.refId) })) },
  } });
  const videos = ads.filter((a) => a.videoPlan).length;
  await log(businessId, "PROPUESTA", `Meta: ${ads.length} anuncios, uno por referencia (${Math.min(ads.length, MAX_META_ADS)} marcados)${videos ? ` (${videos} en vídeo${b.musicUrl ? "" : ", SIN MÚSICA: sube una en la ficha"})` : ""}, ${b.dailyBudget} ${b.currency}/día, tope ${b.totalCap}. Pendiente de tu aprobación.`);
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
  const metaAdId = await meta.createAd(b.metaAdAccountId!, c.metaAdSetId, `${c.name} · image ${n}`, { pageId: b.metaPageId!, instagramId: b.metaInstagramId, link: b.url, thumbHash: hash, cta: b.metaCta }, { mediaType: "image", mediaRef: hash, message, headline, description });
  const metaRtAdId = c.metaRtAdSetId ? await meta.createAd(b.metaAdAccountId!, c.metaRtAdSetId, `${c.name} · remarketing · image ${n}`, { pageId: b.metaPageId!, instagramId: b.metaInstagramId, link: b.url, thumbHash: hash, cta: b.metaCta }, { mediaType: "image", mediaRef: hash, message, headline, description }) : null;
  await db.ad.create({ data: { campaignId: c.id, mediaType: "image", mediaUrl: imageUrl, mediaRef: hash, metaAdId, metaRtAdId, finalUrl: b.url, headlines: [headline], descriptions: [message, description] } });
  await log(b.id, "ANUNCIO_AÑADIDO", `Nueva portada en Meta (anuncio ${n}): ${imageUrl}`);
}

// Remarketing en Meta: % del tope (campo de la ficha, 20 por defecto) para quien visitó la web y no compró. 0 = sin remarketing.
const rtShare = (b: { metaRtShare: number }) => Math.min(50, Math.max(0, b.metaRtShare)) / 100;

// Públicos de la web (visitantes y compradores) del negocio: se crean una vez desde el píxel y se reutilizan.
async function websiteAudiences(b: { id: string; name: string; metaAdAccountId: string | null; metaPixelId: string | null; metaVisitorsAudienceId: string | null; metaBuyersAudienceId: string | null }) {
  if (b.metaVisitorsAudienceId && b.metaBuyersAudienceId) return { visitors: b.metaVisitorsAudienceId, buyers: b.metaBuyersAudienceId };
  const res = await meta.createWebsiteAudiences(b.metaAdAccountId!, b.metaPixelId!, b.name);
  await db.business.update({ where: { id: b.id }, data: { metaVisitorsAudienceId: res.visitors, metaBuyersAudienceId: res.buyers } });
  await log(b.id, "PUBLICOS", "Públicos de la web creados en Meta: visitantes (30 días) y compradores (180 días).");
  return res;
}

// Rehace los anuncios activos de una campaña de Meta viva con el botón de la ficha y el enlace de cada anuncio.
// En Meta el botón no se edita: se crea un anuncio nuevo y el viejo queda en pausa con su historial (el gasto se sigue contando bien).
export async function rebuildMetaAds(campaignId: string, links: Record<string, string>) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, ads: { orderBy: { id: "asc" } } } });
  const b = c.business;
  if (c.channel !== "meta" || !c.metaAdSetId) throw new Error("Solo se rehacen anuncios de una campaña de Meta ya creada.");
  const active = c.ads.filter((a) => a.status === "ENABLED" && a.metaAdId);
  if (!active.length) throw new Error("No hay anuncios activos que rehacer.");
  const thumb = c.ads.find((a) => a.mediaType === "image")?.mediaRef || c.ads.find((a) => a.thumbRef)?.thumbRef;
  if (!thumb) throw new Error("Falta una imagen de miniatura para los vídeos.");
  for (const [i, a] of active.entries()) {
    const link = (links[a.id] || a.finalUrl || b.url).trim();
    const [headline] = a.headlines as string[];
    const [message, description] = a.descriptions as string[];
    const metaAdId = await meta.createAd(b.metaAdAccountId!, c.metaAdSetId, `${c.name} · ${a.mediaType} ${c.ads.length + i + 1}`, { pageId: b.metaPageId!, instagramId: b.metaInstagramId, link, thumbHash: thumb, cta: b.metaCta }, { mediaType: a.mediaType as "image" | "video", mediaRef: a.mediaRef!, message, headline, description, link });
    const rtSpec = { mediaType: a.mediaType as "image" | "video", mediaRef: a.mediaRef!, message, headline, description, link, thumbHash: a.thumbRef || undefined };
    const metaRtAdId = c.metaRtAdSetId ? await meta.createAd(b.metaAdAccountId!, c.metaRtAdSetId, `${c.name} · remarketing · ${a.mediaType} ${c.ads.length + i + 1}`, { pageId: b.metaPageId!, instagramId: b.metaInstagramId, link, thumbHash: thumb, cta: b.metaCta }, rtSpec) : null;
    if (a.metaRtAdId) await meta.setAdStatus(a.metaRtAdId, "PAUSED");
    await meta.setAdStatus(a.metaAdId!, "PAUSED");
    await db.$transaction([
      db.ad.update({ where: { id: a.id }, data: { status: "PAUSED" } }),
      db.ad.create({ data: { campaignId: c.id, mediaType: a.mediaType, mediaUrl: a.mediaUrl, mediaRef: a.mediaRef, basedOn: a.basedOn, thumbRef: a.thumbRef, metaAdId, metaRtAdId, finalUrl: link, headlines: a.headlines as string[], descriptions: a.descriptions as string[] } }),
    ]);
  }
  await log(b.id, "ANUNCIOS_REHECHOS", `Campaña ${c.name}: ${active.length} anuncios rehechos con botón ${b.metaCta}; los anteriores quedan en pausa.`);
}

// Cambia la imagen o el vídeo de un anuncio de una propuesta de Meta (subido por María o generado por Claude).
// El vídeo guarda como miniatura la imagen que tenía el anuncio.
export async function replaceDraftMedia(adId: string, url: string, kind: "image" | "video") {
  const a = await db.ad.findUniqueOrThrow({ where: { id: adId }, include: { campaign: { include: { business: true } } } });
  const c = a.campaign, b = c.business;
  if (c.channel !== "meta" || c.status !== "DRAFT") throw new Error("Solo se cambia el medio de un anuncio de Meta en propuesta.");
  if (kind === "image") {
    const hash = await meta.uploadImage(b.metaAdAccountId!, url);
    await db.ad.update({ where: { id: a.id }, data: { mediaType: "image", mediaUrl: url, mediaRef: hash, thumbRef: null } });
  } else {
    const videoId = await meta.uploadVideo(b.metaAdAccountId!, url, `${c.name} · vídeo`);
    const thumbRef = a.mediaType === "image" ? a.mediaRef : a.thumbRef;
    await db.ad.update({ where: { id: a.id }, data: { mediaType: "video", mediaUrl: url, mediaRef: videoId, thumbRef } });
  }
  await log(b.id, "MEDIO", `Propuesta de Meta: ${kind === "video" ? "vídeo" : "imagen"} nuevo en un anuncio.`);
}

// Monta el vídeo de un anuncio de la propuesta de Meta con su guion (fotos del producto, textos y música de la ficha),
// lo deja en el almacén y lo pone en el anuncio; la imagen que tenía queda de miniatura.
// Con comentarios de María, la IA rehace antes el guion (textos, orden, duración…) partiendo de la misma referencia.
export async function makeDraftVideo(adId: string, opts: { plan?: VideoPlan; feedback?: string } = {}) {
  const a = await db.ad.findUniqueOrThrow({ where: { id: adId }, include: { campaign: { include: { business: true } } } });
  const b = a.campaign.business;
  let plan = opts.plan;
  if (!plan && opts.feedback?.trim()) {
    const ref = a.refId ? await db.reference.findUnique({ where: { id: a.refId }, include: { item: true } }) : null;
    if (!ref?.item) throw new Error("No encuentro la referencia ni el producto de este anuncio.");
    const prev = JSON.stringify(a.videoPlan || {});
    plan = await writeVideoPlan(b, ref, ref.item.photos.length ? ref.item.photos : [ref.item.image!], `${opts.feedback.trim()}\nGuion anterior: ${prev}`);
  }
  const p = plan || (a.videoPlan as VideoPlan | null);
  if (!p?.scenes?.length) throw new Error("Este anuncio no tiene guion de vídeo.");
  if (plan) await db.ad.update({ where: { id: a.id }, data: { videoPlan: plan as any } });
  const mp4 = await renderVideo(p, b.musicUrl);
  const blob = await put(`anuncios/${b.name}-video.mp4`, mp4, { access: "public", addRandomSuffix: true, contentType: "video/mp4" });
  await replaceDraftMedia(a.id, blob.url, "video");
  if (!b.musicUrl) await log(b.id, "MUSICA", "Vídeo montado sin música: sube una en la ficha («Música de los vídeos»).");
  return blob.url;
}

// Pausa o reactiva un anuncio de una campaña de Meta creada, junto con su gemelo de remarketing. Siempre queda al menos uno activo.
export async function setMetaAdStatus(adId: string, status: "ENABLED" | "PAUSED") {
  const a = await db.ad.findUniqueOrThrow({ where: { id: adId }, include: { campaign: { include: { ads: true } } } });
  const c = a.campaign;
  if (c.channel !== "meta" || !a.metaAdId) throw new Error("Solo se pausan anuncios de una campaña de Meta ya creada.");
  if (status === "PAUSED" && !c.ads.some((x) => x.id !== a.id && x.status === "ENABLED" && x.metaAdId)) throw new Error("Es el último anuncio activo: pausa la campaña entera si quieres pararla.");
  const s = status === "ENABLED" ? "ACTIVE" : "PAUSED";
  await meta.setAdStatus(a.metaAdId, s);
  if (a.metaRtAdId) await meta.setAdStatus(a.metaRtAdId, s);
  await db.ad.update({ where: { id: a.id }, data: { status } });
  await log(c.businessId, status === "PAUSED" ? "ANUNCIO_PAUSADO" : "ANUNCIO_ACTIVADO", `${c.name}: anuncio ${a.mediaType === "video" ? "de vídeo" : "de imagen"} ${status === "PAUSED" ? "en pausa" : "reactivado"}${a.metaRtAdId ? " (también en remarketing)" : ""}.`);
}

// Añade remarketing a una campaña de Meta viva que nació sin él (p. ej. Meta rechazó los públicos al crearla):
// públicos de la web, conjunto con el % de la ficha y los mismos anuncios activos. La suma de los dos conjuntos sigue siendo el tope.
export async function addRemarketing(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, ads: { orderBy: { id: "asc" } }, metrics: true } });
  const b = c.business;
  if (c.channel !== "meta" || !c.metaCampaignId || !c.metaAdSetId) throw new Error("Solo para campañas de Meta ya creadas.");
  if (c.metaRtAdSetId) throw new Error("Esta campaña ya tiene remarketing.");
  const share = rtShare(b);
  if (!share) throw new Error("Pon un % de remarketing en la ficha.");
  const active = c.ads.filter((a) => a.status === "ENABLED" && a.metaAdId);
  if (!active.length) throw new Error("No hay anuncios activos que copiar al remarketing.");
  const thumb = c.ads.find((a) => a.mediaType === "image")?.mediaRef || c.ads.find((a) => a.thumbRef)?.thumbRef;
  if (!thumb) throw new Error("Falta una imagen de miniatura para los vídeos.");
  const aud = await websiteAudiences(b);
  const spent = c.metrics.reduce((s, m) => s + m.cost, 0);
  const mainTotal = Math.max(Math.round(c.totalCap * (1 - share) * 100) / 100, Math.ceil(spent) + 1);
  const days = Math.max(1, Math.ceil((c.totalCap - spent) / c.dailyBudget));
  const end = new Date(Date.now() + days * 86400000);
  // Primero se baja la captación, para que la suma nunca pase del tope; si algo falla, se le devuelve el tope entero.
  await meta.setAdSetBudget(c.metaAdSetId, mainTotal, end);
  try {
    const rtAdSetId = await meta.addRemarketingAdSet(b.metaAdAccountId!, c.metaCampaignId, { name: `${c.name} · remarketing`, total: c.totalCap - mainTotal, endTime: end.toISOString(), pixelId: b.metaPixelId!, advertiser: b.metaAdvertiser!, country: b.country, ...aud });
    await db.campaign.update({ where: { id: c.id }, data: { metaRtAdSetId: rtAdSetId } });
    for (const [i, a] of active.entries()) {
      const [headline] = a.headlines as string[]; const [message, description] = a.descriptions as string[];
      const id = await meta.createAd(b.metaAdAccountId!, rtAdSetId, `${c.name} · remarketing · ${a.mediaType} ${i + 1}`, { pageId: b.metaPageId!, instagramId: b.metaInstagramId, link: a.finalUrl, thumbHash: thumb, cta: b.metaCta }, { mediaType: a.mediaType as "image" | "video", mediaRef: a.mediaRef!, message, headline, description: description || "", link: a.finalUrl, thumbHash: a.thumbRef || undefined });
      await db.ad.update({ where: { id: a.id }, data: { metaRtAdId: id } });
    }
  } catch (e) {
    await meta.setAdSetBudget(c.metaAdSetId, c.totalCap, end).catch(() => {});
    throw e;
  }
  await log(b.id, "REMARKETING", `Campaña ${c.name}: remarketing añadido (${b.metaRtShare} % del tope, ${active.length} anuncios) para visitantes de la web de los últimos 30 días que no han comprado.`);
}

// Crea en Google los recursos de una campaña y lo apunta en el historial.
async function createExtras(name: string, googleCampaignId: string, x: GoogleExtras, b: { id: string; googleCustomerId: string | null; currency: string; language: string; url: string }) {
  const r = await ads.addCampaignExtras(b.googleCustomerId!, googleCampaignId, x, { currency: b.currency, language: b.language, url: b.url });
  await log(b.id, "RECURSOS", `Campaña ${name}: ${r.added.length ? `añadidos ${r.added.join(", ")}` : "ningún recurso añadido"}.${r.failed.length ? ` Google rechazó: ${r.failed.join(" · ")}` : ""}`);
}

// Añade los recursos a una campaña de Google ya creada (los genera si la propuesta no los tenía).
export async function addExtrasLive(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true } });
  const b = c.business;
  if (c.channel === "meta" || !c.googleCampaignId) throw new Error("Solo para campañas de Google ya creadas.");
  let x = c.extras as GoogleExtras | null;
  if (!x) {
    const pages = (await db.product.findMany({ where: { businessId: b.id } })).map((p) => ({ name: p.name, url: p.url }));
    x = await writeGoogleExtras(b, pages);
    await db.campaign.update({ where: { id: c.id }, data: { extras: x } });
  }
  await createExtras(c.name, c.googleCampaignId, x, b);
}

// Reintenta las fotos de una campaña de Google ya creada (por grupo o, si no se puede, en la campaña).
export async function retryGoogleImages(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, keywords: true, ads: true } });
  const b = c.business;
  if (c.channel === "meta" || !c.googleCampaignId) throw new Error("Solo para campañas de Google ya creadas.");
  const groups = (c.groups as { name: string; url: string; images: string[] }[] | null) || [];
  const adGroupIds: Record<string, string> = {};
  for (const k of c.keywords) if (k.adGroup && k.googleAdGroupId) adGroupIds[k.adGroup] = k.googleAdGroupId;
  if (groups.length) await addGroupImages(c.name, groups, adGroupIds, b, c.googleCampaignId);
  else await addGoogleImages({ id: c.id, name: c.name, googleCampaignId: c.googleCampaignId, ads: c.ads }, b);
}

// Aplica a una campaña de Google ya creada el horario de la ficha (todos los días o solo laborables 8-20).
export async function applyGoogleSchedule(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true } });
  const b = c.business;
  if (c.channel === "meta" || !c.googleCampaignId) throw new Error("Solo para campañas de Google ya creadas.");
  const res = await ads.setWeekdaySchedule(b.googleCustomerId!, c.googleCampaignId, b.googleWeekdaysOnly);
  await log(b.id, "HORARIO", `Campaña ${c.name}: ${b.googleWeekdaysOnly ? "lunes a viernes, 8-20 h" : "todos los días, a cualquier hora"} (${res.removed} franjas anteriores quitadas).`);
}

// Rehace el texto de UN anuncio de una propuesta de Meta con los comentarios de María: misma referencia y misma imagen.
export async function rewriteDraftMetaAd(adId: string, feedback: string) {
  const a = await db.ad.findUniqueOrThrow({ where: { id: adId }, include: { campaign: { include: { business: true } } } });
  const c = a.campaign, b = c.business;
  if (c.channel !== "meta" || c.status !== "DRAFT") throw new Error("Solo se rehacen anuncios de una propuesta de Meta.");
  if (!feedback.trim()) throw new Error("Escribe qué quieres mejorar.");
  // La referencia del anuncio; en propuestas antiguas, la del mismo producto o la primera.
  const refs = await db.reference.findMany({ where: { businessId: b.id, channel: "meta" }, include: { item: true }, orderBy: { createdAt: "desc" } });
  const ref = refs.find((r) => r.id === a.refId) || refs.find((r) => r.item?.url === a.finalUrl) || refs[0];
  if (!ref) throw new Error("Este negocio no tiene referencias de Meta.");
  const [headline] = a.headlines as string[]; const [message, description] = a.descriptions as string[];
  const copy = await writeMetaAdFromRef(b, ref, { previous: { message, headline, description: description || "" }, feedback: feedback.trim().slice(0, 1000) });
  await db.ad.update({ where: { id: a.id }, data: { headlines: [copy.headline], descriptions: [copy.message, copy.description], basedOn: copy.basedOn, refId: ref.id, ...(copy.script ? { brief: copy.script } : {}) } });
  await log(b.id, "ANUNCIO_REHECHO", `Propuesta de Meta: anuncio reescrito con tus comentarios («${feedback.trim().slice(0, 80)}»).`);
  return { message: copy.message, headline: copy.headline, description: copy.description, basedOn: copy.basedOn };
}

// Aprobación: crea en Meta campaña EN PAUSA + conjunto con presupuesto total (freno nativo) + un anuncio por creatividad.
export async function approveMetaCampaign(campaignId: string, edits: { dailyBudget: number; totalCap: number; ads: { id: string; message: string; headline: string; description: string; included?: boolean }[] }) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, ads: true } });
  const b = c.business;
  if (c.status !== "CREATING" || c.channel !== "meta") throw new Error("Esta propuesta ya no está pendiente.");
  // Solo se crean los anuncios marcados; los demás se quitan de la propuesta.
  const off = edits.ads.filter((x) => x.included === false).map((x) => x.id);
  if (off.length >= c.ads.length) throw new Error("Marca al menos un anuncio para crear.");
  if (off.length) { await db.ad.deleteMany({ where: { id: { in: off }, campaignId: c.id } }); c.ads = c.ads.filter((a) => !off.includes(a.id)); }
  if (!(edits.dailyBudget > 0) || !(edits.totalCap >= edits.dailyBudget)) throw new Error("El gasto total debe ser al menos el presupuesto diario.");
  // Texto de cada anuncio: el editado en la pantalla de aprobación o, si no llega, el de la propuesta.
  const copyOf = (a: { id: string; headlines: unknown; descriptions: unknown }) => {
    const e = edits.ads.find((x) => x.id === a.id);
    const [headline] = a.headlines as string[]; const [message, description] = a.descriptions as string[];
    return { message: (e?.message ?? message).trim().slice(0, 300), headline: (e?.headline ?? headline).trim().slice(0, 40), description: (e?.description ?? description ?? "").trim().slice(0, 30) };
  };
  if (c.ads.some((a) => !copyOf(a).message || !copyOf(a).headline)) throw new Error("Cada anuncio necesita texto principal y titular.");
  for (const a of c.ads) if (a.mediaType === "video" && !(await meta.videoReady(a.mediaRef!))) throw new Error("Meta aún está procesando el vídeo. Prueba de nuevo en un minuto.");
  // Miniatura de los vídeos: la imagen de un anuncio de imagen o la que guardó el vídeo al subirse.
  const thumb = c.ads.find((a) => a.mediaType === "image")?.mediaRef || c.ads.find((a) => a.thumbRef)?.thumbRef;
  if (!thumb) throw new Error("Falta una imagen de miniatura para los vídeos.");
  let remarketing: { visitors: string; buyers: string; share: number } | undefined;
  let audError: string | null = null;
  if (rtShare(b) > 0) { try { remarketing = { ...(await websiteAudiences(b)), share: rtShare(b) }; } catch (e: any) { audError = e.message; } }
  const res = await meta.createCampaign(b.metaAdAccountId!, {
    name: `${c.name} · ${stamp()}`, dailyBudget: edits.dailyBudget, totalCap: edits.totalCap, country: b.country, ageMin: b.ageMin, ageMax: b.ageMax,
    pageId: b.metaPageId!, instagramId: b.metaInstagramId, pixelId: b.metaPixelId!, link: b.url, thumbHash: thumb, advertiser: b.metaAdvertiser!, cta: b.metaCta, remarketing,
    ads: c.ads.map((a) => ({ mediaType: a.mediaType as "image" | "video", mediaRef: a.mediaRef!, link: a.finalUrl, thumbHash: a.thumbRef || undefined, ...copyOf(a) })),
  });
  await db.$transaction([
    db.campaign.update({ where: { id: c.id }, data: { status: "PAUSED", dailyBudget: edits.dailyBudget, totalCap: edits.totalCap, metaCampaignId: res.campaignId, metaAdSetId: res.adSetId, metaRtAdSetId: res.rtAdSetId } }),
    ...c.ads.map((a, i) => { const k = copyOf(a); return db.ad.update({ where: { id: a.id }, data: { metaAdId: res.adIds[i], metaRtAdId: res.rtAdIds[i] || null, headlines: [k.headline], descriptions: [k.message, k.description] } }); }),
  ]);
  await log(b.id, "CAMPAÑA_CREADA", `Creada en Meta en pausa (id ${res.campaignId}): ${c.ads.length} anuncios, ${edits.totalCap} ${b.currency} en total hasta agotar (~${edits.dailyBudget}/día).`);
  const rtWhy = audError || res.rtError;
  if (rtShare(b) > 0) await log(b.id, "REMARKETING", rtWhy ? `Sin remarketing: ${rtWhy}` : `Remarketing: ${b.metaRtShare} % del tope para visitantes de la web de los últimos 30 días que no han comprado.`);
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

// Nombre en Meta/Google: el de AdEngine + fecha y hora de creación, para que nunca se repita (Google no admite dos iguales
// y en Meta dos campañas con el mismo nombre se confunden).
const stamp = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, 16);

// Archivar: la campaña ya parada queda en pausa en Meta/Google con su historial, el cron deja de vigilarla
// y el canal vuelve a admitir una propuesta nueva. No borra nada.
export async function archiveCampaign(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (!["PAUSED", "STOPPED"].includes(c.status)) throw new Error("Pausa la campaña antes de archivarla.");
  // En la plataforma se le añade "archivada" al nombre para distinguirla de la nueva.
  const b = await db.business.findUniqueOrThrow({ where: { id: c.businessId } });
  const label = `${c.name} · archivada ${stamp()}`;
  if (c.channel === "meta" && c.metaCampaignId) await meta.setCampaignName(c.metaCampaignId, label).catch(() => {});
  if (c.channel !== "meta" && c.googleCampaignId) await ads.setCampaignName(b.googleCustomerId!, c.googleCampaignId, label).catch(() => {});
  await db.campaign.update({ where: { id: c.id }, data: { status: "ARCHIVED" } });
  await log(c.businessId, "ARCHIVADA", `Campaña ${c.name}: queda en pausa en ${c.channel === "meta" ? "Meta" : "Google"} con su historial.`);
}

// Presupuesto de una campaña viva. Meta: total del conjunto y fecha de fin al ritmo diario pedido. Google: importe diario; el tope total lo vigila el cron.
export async function setBudget(campaignId: string, dailyBudget: number, totalCap: number) {
  if (!(dailyBudget > 0) || !(totalCap >= dailyBudget)) throw new Error("El gasto total debe ser al menos el presupuesto diario.");
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, metrics: true } });
  const spent = c.metrics.reduce((s, m) => s + m.cost, 0);
  if (totalCap < spent) throw new Error(`Ya se han gastado ${spent.toFixed(2)} ${c.business.currency}: el tope no puede ser menor.`);
  if (c.channel === "meta") {
    if (!c.metaAdSetId) throw new Error("La campaña aún no existe en Meta.");
    const days = Math.max(1, Math.ceil((totalCap - spent) / dailyBudget));
    const end = new Date(Date.now() + days * 86400000);
    const share = rtShare(c.business);
    await meta.setAdSetBudget(c.metaAdSetId, c.metaRtAdSetId ? totalCap * (1 - share) : totalCap, end);
    if (c.metaRtAdSetId) await meta.setAdSetBudget(c.metaRtAdSetId, totalCap * share, end);
  } else {
    if (!c.googleBudgetId) throw new Error("La campaña aún no existe en Google Ads.");
    await ads.setDailyBudget(c.business.googleCustomerId!, c.googleBudgetId, dailyBudget);
  }
  await db.campaign.update({ where: { id: c.id }, data: { dailyBudget, totalCap } });
  await log(c.businessId, "PRESUPUESTO", `Campaña ${c.name}: ${dailyBudget} ${c.business.currency}/día, tope total ${totalCap}.`);
}

// Público de Meta: país y edad de la ficha aplicados al conjunto de una campaña viva.
export async function applyMetaAudience(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true } });
  if (c.channel !== "meta" || !c.metaAdSetId) throw new Error("Solo se aplica a una campaña de Meta ya creada.");
  const b = c.business;
  await meta.setAdSetAudience(c.metaAdSetId, b.country, b.ageMin, b.ageMax);
  await log(b.id, "PUBLICO", `Campaña ${c.name}: ${b.country}, ${b.ageMin}–${b.ageMax} años.`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Meta · regla de anuncio: gasta 2× el CAC tope sin ninguna conversión -> se pausa. Pura, para poder probarla.

// Meta: métricas por anuncio y día + frenos. La campaña dura poco, así que se mira desde su creación.
export async function syncMetaCampaign(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { business: true, ads: true } });
  if (!c.metaCampaignId || c.status === "DRAFT") return;
  const b = c.business;
  const today = iso(new Date());
  const rows = await meta.adInsights(c.metaCampaignId, iso(c.createdAt), today);
  // Cada anuncio puede estar en captación y en remarketing: se suman sus dos filas del día antes de guardar.
  const byMetaId = new Map<string, (typeof c.ads)[number]>();
  for (const a of c.ads) { if (a.metaAdId) byMetaId.set(a.metaAdId, a); if (a.metaRtAdId) byMetaId.set(a.metaRtAdId, a); }
  const daily = new Map<string, { ad: (typeof c.ads)[number]; date: string; impressions: number; clicks: number; cost: number; conversions: number; purchases: number; purchaseValue: number }>();
  for (const r of rows) {
    const ad = byMetaId.get(r.adId);
    if (!ad) continue;
    const key = `${ad.id}|${r.date}`;
    const acc = daily.get(key) || { ad, date: r.date, impressions: 0, clicks: 0, cost: 0, conversions: 0, purchases: 0, purchaseValue: 0 };
    acc.impressions += r.impressions; acc.clicks += r.clicks; acc.cost += r.cost; acc.conversions += r.conversions; acc.purchases += r.purchases; acc.purchaseValue += r.purchaseValue;
    daily.set(key, acc);
  }
  for (const r of daily.values()) {
    const ad = r.ad;
    const data = { impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, purchases: r.purchases, purchaseValue: r.purchaseValue };
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

  // Regla 2 · por anuncio: 1 CAC de validación gastado sin conversiones -> pausa automática.
  const sums = await db.dailyMetric.groupBy({ by: ["adId"], where: { campaignId: c.id, adId: { not: null } }, _sum: { cost: true, conversions: true, purchases: true } });
  const totals = new Map(sums.map((s) => [s.adId!, { cost: s._sum.cost || 0, conversions: s._sum.conversions || 0 }]));
  for (const ad of metaAdsToPause(c.ads, totals, cacTestOf(b))) {
    await meta.setAdStatus(ad.metaAdId!, "PAUSED");
    if (ad.metaRtAdId) await meta.setAdStatus(ad.metaRtAdId, "PAUSED");
    await db.ad.update({ where: { id: ad.id }, data: { status: "PAUSED" } });
    await log(b.id, "REGLA", `Anuncio de ${ad.mediaType === "video" ? "vídeo" : "imagen"} pausado: ${totals.get(ad.id)!.cost.toFixed(2)} gastados sin conversiones (1 CAC de validación, ${cacTestOf(b)}).`, true);
  }

  // Regla 3 · rotación de ganadores: propone pausar los anuncios que venden mucho más caro que el mejor (tú apruebas).
  const live = (await db.ad.findMany({ where: { campaignId: c.id, status: "ENABLED", metaAdId: { not: null } } }));
  const purch = new Map(sums.map((s) => [s.adId!, s._sum.purchases || 0]));
  const days = (Date.now() - c.createdAt.getTime()) / 86400000;
  const rot = metaRotation(live.map((a) => ({ id: a.id, ...(totals.get(a.id) || { cost: 0, conversions: 0 }), purchases: purch.get(a.id) || 0 })), { cacCap: b.cacCap, days });
  for (const r of rot) {
    const exists = await db.proposal.findFirst({ where: { campaignId: c.id, kind: "PAUSE_AD", target: r.id, status: "PENDING" } });
    const a = live.find((x) => x.id === r.id)!;
    if (!exists) await db.proposal.create({ data: { campaignId: c.id, kind: "PAUSE_AD", target: r.id, payload: {}, reason: `Pausar el anuncio de ${a.mediaType === "video" ? "vídeo" : "imagen"} «${(a.headlines as string[])[0] || ""}»: ${r.reason}` } });
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
    if (conv === 0 && cost >= cacTestOf(b)) {
      await ads.updateKeyword(cid, k.googleAdGroupId || c.googleAdGroupId!, k.googleCriterionId, { status: "PAUSED" });
      await db.keyword.update({ where: { id: k.id }, data: { status: "PAUSED" } });
      await log(b.id, "REGLA", `Palabra «${k.text}» pausada: ${cost.toFixed(2)} gastados sin ventas (1 CAC de validación, ${cacTestOf(b)}).`, true);
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

// Reparto del dinero de un negocio (una vez por semana como mucho por campaña): propuestas que María aprueba.
const MONEY = ["MOVE_BUDGET", "SET_BUDGET", "PAUSE_CAMPAIGN"];
export async function proposeBudgetMoves(businessId: string) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, include: { sales: true, campaigns: { include: { metrics: true } } } });
  const live = b.campaigns.filter((c) => c.status === "ENABLED" && (c.googleCampaignId || c.metaCampaignId));
  if (!live.length) return;
  const v = validate({ cacCap: b.cacCap, cacTest: b.cacTest, campaigns: b.campaigns, sales: b.sales });
  const week = new Date(Date.now() - 7 * 86400000);
  const recent = await db.proposal.findMany({ where: { campaignId: { in: live.map((c) => c.id) }, kind: { in: MONEY }, createdAt: { gte: week } } });
  const moves = budgetMoves(b, v, live);
  // Una por campaña cada 7 días: si alguna de las implicadas ya tuvo propuesta de dinero esta semana, se espera.
  const touched = (m: (typeof moves)[number]) => [m.campaignId, (m.payload as any).toCampaignId].filter(Boolean);
  if (moves.some((m) => touched(m).some((id) => recent.some((r) => r.campaignId === id || (r.payload as any)?.toCampaignId === id)))) return;
  for (const m of moves) await db.proposal.create({ data: { campaignId: m.campaignId, kind: m.kind, target: m.campaignId, payload: m.payload as any, reason: m.reason } });
  if (moves.length) await log(b.id, "PROPUESTA_DINERO", moves.map((m) => m.reason).join(" · "), true);
}

export async function applyProposal(proposalId: string, decision: "APPROVED" | "DISMISSED") {
  const p = await db.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { campaign: { include: { business: true } } } });
  const c = p.campaign, b = c.business, cid = b.googleCustomerId!;
  if (decision === "APPROVED" && p.kind === "PAUSE_AD") await setMetaAdStatus(p.target, "PAUSED");
  else if (decision === "APPROVED" && p.kind === "PAUSE_CAMPAIGN") await setStatus(c.id, "PAUSED");
  else if (decision === "APPROVED" && p.kind === "SET_BUDGET") { const x = p.payload as any; await setBudget(c.id, x.dailyBudget, x.totalCap); }
  else if (decision === "APPROVED" && p.kind === "MOVE_BUDGET") {
    // Mismo total del negocio: el diario baja en una campaña y sube en la otra; los topes totales no cambian.
    const x = p.payload as any, to = await db.campaign.findUniqueOrThrow({ where: { id: x.toCampaignId } });
    if (c.dailyBudget - x.amount <= 0) throw new Error("La campaña se quedaría sin presupuesto diario.");
    await setBudget(c.id, c.dailyBudget - x.amount, c.totalCap);
    await setBudget(to.id, to.dailyBudget + x.amount, to.totalCap);
  }
  else if (decision === "APPROVED" && c.googleCampaignId) {
    const payload = p.payload as any;
    if (p.kind === "RAISE_BID" || p.kind === "LOWER_BID") {
      const k = await db.keyword.findUniqueOrThrow({ where: { id: p.target } });
      await ads.updateKeyword(cid, k.googleAdGroupId || c.googleAdGroupId!, k.googleCriterionId!, { maxCpc: payload.maxCpc });
      await db.keyword.update({ where: { id: k.id }, data: { maxCpc: payload.maxCpc } });
      await log(b.id, "PUJA", `«${k.text}» → ${payload.maxCpc} (aprobado por ti).`);
    } else if (p.kind === "PAUSE_KEYWORD") {
      const k = await db.keyword.findUniqueOrThrow({ where: { id: p.target } });
      await ads.updateKeyword(cid, k.googleAdGroupId || c.googleAdGroupId!, k.googleCriterionId!, { status: "PAUSED" });
      await db.keyword.update({ where: { id: k.id }, data: { status: "PAUSED" } });
      await log(b.id, "PAUSA", `«${k.text}» pausada (aprobado por ti).`);
    } else if (p.kind === "ADD_NEGATIVE") {
      await ads.addNegative(cid, c.googleCampaignId, payload.text);
      await log(b.id, "NEGATIVA", `Añadida negativa «${payload.text}» (aprobado por ti).`);
    }
  }
  await db.proposal.update({ where: { id: p.id }, data: { status: decision } });
}
