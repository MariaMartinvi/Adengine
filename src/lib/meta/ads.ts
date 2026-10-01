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

export type MetaAdSpec = { mediaType: "image" | "video"; mediaRef: string; message: string; headline: string; description: string };
export type MetaCampaignSpec = {
  name: string; dailyBudget: number; totalCap: number; country: string; ageMin: number; ageMax: number;
  pageId: string; pixelId: string; link: string; thumbHash: string; ads: MetaAdSpec[];
  advertiser: string; // UE (DSA): quién se anuncia y quién paga; sale en la Biblioteca de anuncios
};
const cents = (eur: number) => Math.round(eur * 100);

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
  const adSetId = (await call(`/${a}/adsets`, {
    name: `${s.name} · conjunto 1`, campaign_id: campaignId, status: "ACTIVE",
    lifetime_budget: cents(s.totalCap), end_time: new Date(Date.now() + days * 86400000).toISOString(), billing_event: "IMPRESSIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "OFFSITE_CONVERSIONS", promoted_object: { pixel_id: s.pixelId, custom_event_type: "INITIATED_CHECKOUT" },
    dsa_beneficiary: s.advertiser, dsa_payor: s.advertiser,
    targeting: { geo_locations: { countries: [s.country] }, age_min: s.ageMin, age_max: s.ageMax, targeting_automation: { advantage_audience: 0 } },
  }, "POST")).id;
  const adIds: string[] = [];
  for (const [i, ad] of s.ads.entries()) {
    const cta = { type: "LEARN_MORE", value: { link: s.link } };
    const story = ad.mediaType === "video"
      ? { page_id: s.pageId, video_data: { video_id: ad.mediaRef, image_hash: s.thumbHash, message: ad.message, title: ad.headline, link_description: ad.description, call_to_action: cta } }
      : { page_id: s.pageId, link_data: { link: s.link, message: ad.message, name: ad.headline, description: ad.description, image_hash: ad.mediaRef, call_to_action: cta } };
    const creativeId = (await call(`/${a}/adcreatives`, { name: `${s.name} · ${ad.mediaType} ${i + 1}`, object_story_spec: story }, "POST")).id;
    adIds.push((await call(`/${a}/ads`, { name: `${s.name} · ${ad.mediaType} ${i + 1}`, adset_id: adSetId, creative: { creative_id: creativeId }, status: "ACTIVE" }, "POST")).id);
  }
  return { campaignId, adSetId, adIds };
  } catch (e) {
    await call(`/${campaignId}`, {}, "DELETE").catch(() => {});
    throw e;
  }
}

export async function setCampaignStatus(campaignId: string, status: "ACTIVE" | "PAUSED") {
  await call(`/${campaignId}`, { status }, "POST");
}

