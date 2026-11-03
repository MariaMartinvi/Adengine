// Adaptador de Meta (Facebook + Instagram) sobre la Marketing API. No hay nada de Meta fuera de esta carpeta.
// Acceso con el token de un usuario del sistema del porfolio (no caduca): META_ACCESS_TOKEN.

const BASE = () => `https://graph.facebook.com/${process.env.META_API_VERSION || "v26.0"}`;
export const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

async function call(path: string, params: Record<string, unknown> = {}, method: "GET" | "POST" | "DELETE" = "GET") {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("Falta META_ACCESS_TOKEN.");
  const qs = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const r = method !== "POST"
    ? await fetch(`${BASE()}${path}?${qs}`, { method })
    : await fetch(`${BASE()}${path}`, { method, body: qs });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta (${r.status}): ${j.error?.error_user_msg || j.error?.message || "error desconocido"}`);
  return j;
}

export async function listAdAccounts(): Promise<{ id: string; name: string; currency: string }[]> {
  const j = await call("/me/adaccounts", { fields: "account_id,name,currency" });
  return (j.data || []).map((a: any) => ({ id: a.account_id, name: a.name, currency: a.currency }));
}

export async function listPixels(adAccountId: string): Promise<{ id: string; name: string }[]> {
  const j = await call(`/${act(adAccountId)}/adspixels`, { fields: "id,name" });
  return (j.data || []).map((p: any) => ({ id: p.id, name: p.name }));
}

// Biblioteca de la cuenta: subir la imagen o el vídeo no publica nada.
export async function uploadImage(adAccountId: string, url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar la imagen (${r.status}): ${url}`);
  const bytes = Buffer.from(await r.arrayBuffer()).toString("base64");
  const j = await call(`/${act(adAccountId)}/adimages`, { bytes }, "POST");
  return (Object.values(j.images || {})[0] as any).hash;
}

export async function uploadVideo(adAccountId: string, url: string, name: string): Promise<string> {
  return (await call(`/${act(adAccountId)}/advideos`, { file_url: url, name }, "POST")).id;
}

export async function videoReady(videoId: string): Promise<boolean> {
  return (await call(`/${videoId}`, { fields: "status" })).status?.video_status === "ready";
}

export type MetaAdSpec = { mediaType: "image" | "video"; mediaRef: string; message: string; headline: string; description: string; link?: string; thumbHash?: string };
// Públicos de la web a partir del píxel: visitantes (30 días) para remarketing y compradores (180 días) para excluirlos.
export async function createWebsiteAudiences(adAccountId: string, pixelId: string, label: string) {
  const a = act(adAccountId);
  const rule = (retention: number, filters: unknown[]) => ({ inclusions: { operator: "or", rules: [{ event_sources: [{ id: pixelId, type: "pixel" }], retention_seconds: retention, filter: { operator: "and", filters } }] } });
  const visitors = (await call(`/${a}/customaudiences`, { name: `${label} · visitantes 30 días`, rule: rule(30 * 86400, [{ field: "url", operator: "i_contains", value: "" }]), prefill: "1" }, "POST")).id as string;
  const buyers = (await call(`/${a}/customaudiences`, { name: `${label} · compradores 180 días`, rule: rule(180 * 86400, [{ field: "event", operator: "eq", value: "Purchase" }]), prefill: "1" }, "POST")).id as string;
  return { visitors, buyers };
}

export type MetaCampaignSpec = {
  name: string; dailyBudget: number; totalCap: number; country: string; ageMin: number; ageMax: number;
  pageId: string; pixelId: string; link: string; thumbHash: string; cta: string; instagramId?: string | null; ads: MetaAdSpec[];
  advertiser: string; // UE (DSA): quién se anuncia y quién paga; sale en la Biblioteca de anuncios
  remarketing?: { visitors: string; buyers: string; share: number }; // conjunto aparte para quien visitó la web y no compró
};
const cents = (eur: number) => Math.round(eur * 100);

// Conjunto con presupuesto TOTAL hasta una fecha de fin (freno nativo) y optimizado al clic de compra del píxel.
async function createAdSet(adAccountId: string, campaignId: string, o: { name: string; total: number; endTime: string; pixelId: string; advertiser: string; country: string; targeting: Record<string, unknown> }) {
  return (await call(`/${act(adAccountId)}/adsets`, {
    name: o.name, campaign_id: campaignId, status: "ACTIVE",
    lifetime_budget: cents(o.total), end_time: o.endTime, billing_event: "IMPRESSIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "OFFSITE_CONVERSIONS", promoted_object: { pixel_id: o.pixelId, custom_event_type: "INITIATED_CHECKOUT" },
    dsa_beneficiary: o.advertiser, dsa_payor: o.advertiser,
    targeting: { geo_locations: { countries: [o.country] }, ...o.targeting, targeting_automation: { advantage_audience: 0 } },
  }, "POST")).id as string;
}

// Remarketing: visitantes de la web, sin los que ya compraron.
const rtTargeting = (r: { visitors: string; buyers: string }) => ({ age_min: 18, custom_audiences: [{ id: r.visitors }], excluded_custom_audiences: [{ id: r.buyers }] });

// Añade el conjunto de remarketing a una campaña ya creada (si al crearla Meta no lo dejó, p. ej. por condiciones sin aceptar).
export async function addRemarketingAdSet(adAccountId: string, campaignId: string, o: { name: string; total: number; endTime: string; pixelId: string; advertiser: string; country: string; visitors: string; buyers: string }) {
  return createAdSet(adAccountId, campaignId, { ...o, targeting: rtTargeting(o) });
}

// Campaña EN PAUSA, un conjunto y un anuncio por creatividad.
// Freno nativo: el conjunto lleva presupuesto TOTAL (= gasto total máximo) repartido hasta una fecha de fin;
// Meta nunca gasta más y para sola. (El spend_cap de campaña exige un mínimo de 100 €, por eso no se usa.)
// El conjunto y los anuncios se crean activos: no entregan nada mientras la campaña esté en pausa.
export async function createCampaign(adAccountId: string, s: MetaCampaignSpec) {
  const a = act(adAccountId);
  const campaignId = (await call(`/${a}/campaigns`, {
    name: s.name, objective: "OUTCOME_SALES", status: "PAUSED", special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  }, "POST")).id;
  // Si algo falla a partir de aquí, se borra la campaña para no dejar nada a medias en Meta.
  try {
  const days = Math.max(1, Math.ceil(s.totalCap / s.dailyBudget));
  const endTime = new Date(Date.now() + days * 86400000).toISOString();
  const share = s.remarketing ? s.remarketing.share : 0;
  const adSet = (name: string, total: number, targeting: Record<string, unknown>) => createAdSet(adAccountId, campaignId, { name, total, endTime, pixelId: s.pixelId, advertiser: s.advertiser, country: s.country, targeting });
  const adSetId = await adSet(`${s.name} · conjunto 1`, s.totalCap * (1 - share), { age_min: s.ageMin, age_max: s.ageMax });
  const adIds: string[] = [];
  for (const [i, ad] of s.ads.entries()) adIds.push(await createAd(adAccountId, adSetId, `${s.name} · ${ad.mediaType} ${i + 1}`, s, ad));
  // Remarketing: si falla (público aún sin aceptar las condiciones, presupuesto mínimo…), la campaña sigue sin él.
  let rtAdSetId: string | null = null; const rtAdIds: string[] = []; let rtError: string | null = null;
  if (s.remarketing) {
    try {
      rtAdSetId = await adSet(`${s.name} · remarketing`, s.totalCap * share, rtTargeting(s.remarketing));
      for (const [i, ad] of s.ads.entries()) rtAdIds.push(await createAd(adAccountId, rtAdSetId, `${s.name} · remarketing · ${ad.mediaType} ${i + 1}`, s, ad));
    } catch (e: any) {
      if (rtAdSetId) await call(`/${rtAdSetId}`, {}, "DELETE").catch(() => {});
      rtAdSetId = null; rtAdIds.length = 0; rtError = e.message;
    }
  }
  return { campaignId, adSetId, adIds, rtAdSetId, rtAdIds, rtError };
  } catch (e) {
    await call(`/${campaignId}`, {}, "DELETE").catch(() => {});
    throw e;
  }
}

// Un anuncio (creatividad + anuncio) dentro de un conjunto existente. Sirve al crear, para añadir portadas y para rehacer anuncios.
// El enlace es el del anuncio (p. ej. la página del cuadro) o, si no tiene, el de la ficha.
export async function createAd(adAccountId: string, adSetId: string, name: string, s: { pageId: string; link: string; thumbHash: string; cta: string; instagramId?: string | null }, ad: MetaAdSpec) {
  const a = act(adAccountId);
  const link = ad.link || s.link;
  // Con la cuenta de Instagram del negocio, en Instagram el anuncio sale con su @ en vez del nombre de la página.
  const ig = s.instagramId ? { instagram_user_id: s.instagramId } : {};
  const cta = { type: s.cta, value: { link } };
  const story = ad.mediaType === "video"
    ? { page_id: s.pageId, ...ig, video_data: { video_id: ad.mediaRef, image_hash: ad.thumbHash || s.thumbHash, message: ad.message, title: ad.headline, link_description: ad.description, call_to_action: cta } }
    : { page_id: s.pageId, ...ig, link_data: { link, message: ad.message, name: ad.headline, description: ad.description, image_hash: ad.mediaRef, call_to_action: cta } };
  const creativeId = (await call(`/${a}/adcreatives`, { name, object_story_spec: story }, "POST")).id;
  return (await call(`/${a}/ads`, { name, adset_id: adSetId, creative: { creative_id: creativeId }, status: "ACTIVE" }, "POST")).id as string;
}

export async function setCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED") {
  await call(`/${campaignId}`, { status }, "POST");
}

export async function setCampaignName(campaignId: string, name: string) {
  await call(`/${campaignId}`, { name }, "POST");
}

// Freno nativo de una campaña viva: presupuesto total del conjunto y fecha de fin. Meta rechaza un total por debajo de lo gastado.
export async function setAdSetBudget(adSetId: string, totalCap: number, endTime: Date) {
  await call(`/${adSetId}`, { lifetime_budget: cents(totalCap), end_time: endTime.toISOString() }, "POST");
}

export async function setAdSetAudience(adSetId: string, country: string, ageMin: number, ageMax: number) {
  await call(`/${adSetId}`, { targeting: { geo_locations: { countries: [country] }, age_min: ageMin, age_max: ageMax, targeting_automation: { advantage_audience: 0 } } }, "POST");
}


export type AdDayRow = { adId: string; date: string; impressions: number; clicks: number; cost: number; conversions: number };
// Conversión = clic de compra del píxel (InitiateCheckout). Clics = clics en el enlace, no "me gusta" ni ampliaciones.
const CONV = ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout"];
export async function adInsights(campaignId: string, since: string, until: string): Promise<AdDayRow[]> {
  const j = await call(`/${campaignId}/insights`, {
    level: "ad", time_increment: "1", time_range: { since, until }, limit: "500",
    fields: "ad_id,date_start,impressions,inline_link_clicks,spend,actions",
  });
  return (j.data || []).map((r: any) => {
    const act = (r.actions || []).find((a: any) => CONV.includes(a.action_type));
    return { adId: r.ad_id, date: r.date_start, impressions: Number(r.impressions || 0), clicks: Number(r.inline_link_clicks || 0), cost: Number(r.spend || 0), conversions: Number(act?.value || 0) };
  });
}

export async function setAdStatus(adId: string, status: "ACTIVE" | "PAUSED") {
  await call(`/${adId}`, { status }, "POST");
}

// Compra enviada desde el servidor (API de conversiones). event_id = id del pedido: Meta la empareja con la del píxel
// del navegador y la cuenta una sola vez. El email va con hash, como pide Meta. testCode: código de «Probar eventos».
export async function sendPurchase(pixelId: string, p: { orderId: string; value: number; currency: string; email?: string | null; fbc?: string | null; fbp?: string | null; url?: string | null; when: Date }, testCode?: string) {
  const { createHash } = await import("crypto");
  const user_data: Record<string, unknown> = {};
  if (p.email) user_data.em = [createHash("sha256").update(p.email.trim().toLowerCase()).digest("hex")];
  if (p.fbc) user_data.fbc = p.fbc;
  if (p.fbp) user_data.fbp = p.fbp;
  const data = [{ event_name: "Purchase", event_time: Math.floor(p.when.getTime() / 1000), event_id: p.orderId, action_source: "website", ...(p.url ? { event_source_url: p.url } : {}), user_data, custom_data: { value: p.value, currency: p.currency } }];
  return call(`/${pixelId}/events`, { data, ...(testCode ? { test_event_code: testCode } : {}) }, "POST");
}
