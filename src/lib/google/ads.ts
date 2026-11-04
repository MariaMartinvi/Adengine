// Adaptador de Google Ads sobre la API REST. No hay nada de Google fuera de esta carpeta.
import { accessToken } from "./auth";

const V = () => process.env.GOOGLE_ADS_API_VERSION || "v26";
const BASE = () => `https://googleads.googleapis.com/${V()}`;

export const GEO: Record<string, string> = { ES: "2724", MX: "2484", FR: "2250", GB: "2826", US: "2840", CO: "2170", CL: "2152", AR: "2032", PE: "2604", PT: "2620", IT: "2380", DE: "2276" };
export const LANG: Record<string, string> = { es: "1003", en: "1000", fr: "1002", pt: "1014", it: "1004", de: "1001" };

export const toMicros = (eur: number) => Math.round(eur * 1_000_000).toString();
export const fromMicros = (m: string | number | undefined) => (Number(m || 0) / 1_000_000);

async function call(path: string, body: unknown, cid?: string) {
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "login-customer-id": process.env.GOOGLE_LOGIN_CUSTOMER_ID!.replace(/-/g, ""),
  };
  if (process.env.GOOGLE_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_DEVELOPER_TOKEN;
  const r = await fetch(`${BASE()}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  let j: any = {};
  try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) {
    const msg = j?.error?.details?.[0]?.errors?.map((e: any) => e.message).join("; ") || j?.error?.message || text;
    throw new Error(`Google Ads (${r.status}): ${msg}`);
  }
  return j;
}

export async function search(cid: string, query: string): Promise<any[]> {
  const j = await call(`/customers/${cid}/googleAds:search`, { query });
  return j.results || [];
}

export async function listAccessibleCustomers(): Promise<{ id: string; name: string }[]> {
  const mcc = process.env.GOOGLE_LOGIN_CUSTOMER_ID!.replace(/-/g, "");
  // Todas las cuentas de anuncios bajo el MCC, también las que cuelgan de un administrador intermedio (p. ej. RegaloparaBesbes).
  const rows = await search(mcc, `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.level FROM customer_client`);
  return rows.filter((r) => !r.customerClient.manager && Number(r.customerClient.level) >= 1).map((r) => ({ id: String(r.customerClient.id), name: r.customerClient.descriptiveName }));
}

export type KeywordIdea = { text: string; volume: number; cpcLow: number; cpcHigh: number; competition: string };

export async function keywordIdeas(cid: string, seeds: string[], country: string, language: string, url?: string): Promise<KeywordIdea[]> {
  const body: any = {
    language: `languageConstants/${LANG[language] || LANG.es}`,
    geoTargetConstants: [`geoTargetConstants/${GEO[country] || GEO.ES}`],
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
    pageSize: 500,
  };
  if (url && seeds.length) body.keywordAndUrlSeed = { url, keywords: seeds.slice(0, 20) };
  else if (seeds.length) body.keywordSeed = { keywords: seeds.slice(0, 20) };
  else body.urlSeed = { url };
  const j = await call(`/customers/${cid}:generateKeywordIdeas`, body);
  return (j.results || []).map((r: any) => ({
    text: r.text,
    volume: Number(r.keywordIdeaMetrics?.avgMonthlySearches || 0),
    cpcLow: fromMicros(r.keywordIdeaMetrics?.lowTopOfPageBidMicros),
    cpcHigh: fromMicros(r.keywordIdeaMetrics?.highTopOfPageBidMicros),
    competition: r.keywordIdeaMetrics?.competition || "UNSPECIFIED",
  }));
}

export type CampaignSpec = {
  name: string; dailyBudget: number; country: string; language: string; finalUrl: string; path1?: string | null; path2?: string | null;
  keywords: { text: string; matchType: "EXACT" | "PHRASE"; maxCpc: number; finalUrl?: string | null; group?: string | null }[];
  ads: { headlines: string[]; descriptions: string[]; finalUrl?: string; group?: string | null; path1?: string | null; path2?: string | null }[];
  negatives: string[];
  schedule: boolean; // true = solo lunes-viernes 8-20 (B2B); false = todos los días, todo el día
};

// Crea presupuesto + campaña (EN PAUSA) + grupo + palabras + anuncios en una sola llamada atómica.
export async function createSearchCampaign(cid: string, s: CampaignSpec) {
  const B = `customers/${cid}/campaignBudgets/-1`;
  const C = `customers/${cid}/campaigns/-2`;
  // Un grupo de anuncios por tema (Virgen María, Buen Pastor…); sin temas, uno solo.
  const groupNames = Array.from(new Set([...s.keywords.map((k) => k.group || "Grupo 1"), ...s.ads.map((a) => a.group || "Grupo 1")]));
  const G = (name?: string | null) => `customers/${cid}/adGroups/-${3 + groupNames.indexOf(name || "Grupo 1")}`;
  const ops: any[] = [
    { campaignBudgetOperation: { create: { resourceName: B, name: `${s.name} · presupuesto`, amountMicros: toMicros(s.dailyBudget), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    { campaignOperation: { create: {
      resourceName: C, name: s.name, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: B,
      manualCpc: { enhancedCpcEnabled: false },
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" },
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    } } },
    { campaignCriterionOperation: { create: { campaign: C, location: { geoTargetConstant: `geoTargetConstants/${GEO[s.country] || GEO.ES}` } } } },
    { campaignCriterionOperation: { create: { campaign: C, language: { languageConstant: `languageConstants/${LANG[s.language] || LANG.es}` } } } },
    ...groupNames.map((n) => ({ adGroupOperation: { create: { resourceName: G(n), name: `${s.name} · ${n}`, campaign: C, status: "ENABLED", type: "SEARCH_STANDARD" } } })),
  ];
  if (s.schedule) {
    for (const day of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]) {
      ops.push({ campaignCriterionOperation: { create: { campaign: C, adSchedule: { dayOfWeek: day, startHour: 8, startMinute: "ZERO", endHour: 20, endMinute: "ZERO" } } } });
    }
  }
  for (const n of s.negatives) {
    ops.push({ campaignCriterionOperation: { create: { campaign: C, negative: true, keyword: { text: n, matchType: "PHRASE" } } } });
  }
  for (const k of s.keywords) {
    // Cada palabra puede llevar su página (el cuadro o la colección que busca la gente); si no, la del anuncio.
    ops.push({ adGroupCriterionOperation: { create: { adGroup: G(k.group), status: "ENABLED", cpcBidMicros: toMicros(k.maxCpc), keyword: { text: k.text, matchType: k.matchType }, ...(k.finalUrl ? { finalUrls: [k.finalUrl] } : {}) } } });
  }
  for (const a of s.ads) {
    ops.push({ adGroupAdOperation: { create: { adGroup: G(a.group), status: "ENABLED", ad: {
      finalUrls: [a.finalUrl || s.finalUrl],
      responsiveSearchAd: { headlines: a.headlines.map((t) => ({ text: t })), descriptions: a.descriptions.map((t) => ({ text: t })), ...(a.path1 ? { path1: a.path1, ...(a.path2 ? { path2: a.path2 } : {}) } : {}) },
    } } } });
  }
  const j = await call(`/customers/${cid}/googleAds:mutate`, { mutateOperations: ops, partialFailure: false });
  const res: any[] = j.mutateOperationResponses || [];
  const id = (rn: string) => rn.split("/").pop()!.split("~").pop()!;
  const budgetId = id(res[0].campaignBudgetResult.resourceName);
  const campaignId = id(res[1].campaignResult.resourceName);
  const agIds = res.filter((r) => r.adGroupResult).map((r) => id(r.adGroupResult.resourceName));
  const adGroupIds: Record<string, string> = Object.fromEntries(groupNames.map((n, i) => [n, agIds[i]]));
  const adGroupId = agIds[0];
  const criterionIds = res.filter((r) => r.adGroupCriterionResult).map((r) => id(r.adGroupCriterionResult.resourceName));
  const adIds = res.filter((r) => r.adGroupAdResult).map((r) => id(r.adGroupAdResult.resourceName));
  return { budgetId, campaignId, adGroupId, adGroupIds, criterionIds, adIds };
}

// Imagen de la campaña de búsqueda (Google la enseña junto al anuncio cuando cree que ayuda): recurso de imagen + enlace AD_IMAGE.
export async function addCampaignImage(cid: string, campaignId: string, name: string, data: Buffer) {
  const j = await call(`/customers/${cid}/assets:mutate`, { operations: [{ create: { name, imageAsset: { data: data.toString("base64") } } }] });
  const asset = j.results[0].resourceName;
  await call(`/customers/${cid}/campaignAssets:mutate`, { operations: [{ create: { campaign: `customers/${cid}/campaigns/${campaignId}`, asset, fieldType: "AD_IMAGE" } }] });
}

// La misma imagen, pero solo para un grupo de anuncios (las búsquedas de ese tema ven su cuadro).
export async function addAdGroupImage(cid: string, adGroupId: string, name: string, data: Buffer) {
  const j = await call(`/customers/${cid}/assets:mutate`, { operations: [{ create: { name, imageAsset: { data: data.toString("base64") } } }] });
  const asset = j.results[0].resourceName;
  await call(`/customers/${cid}/adGroupAssets:mutate`, { operations: [{ create: { adGroup: `customers/${cid}/adGroups/${adGroupId}`, asset, fieldType: "AD_IMAGE" } }] });
}

export async function setCampaignStatus(cid: string, campaignId: string, status: "ENABLED" | "PAUSED") {
  await call(`/customers/${cid}/campaigns:mutate`, { operations: [{ updateMask: "status", update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, status } }] });
}

export async function setDailyBudget(cid: string, budgetId: string, dailyBudget: number) {
  await call(`/customers/${cid}/campaignBudgets:mutate`, { operations: [{ updateMask: "amount_micros", update: { resourceName: `customers/${cid}/campaignBudgets/${budgetId}`, amountMicros: toMicros(dailyBudget) } }] });
}

// Horario de una campaña ya creada: quita las franjas que tenga y, si es solo laborables, pone lunes-viernes 8-20.
export async function setWeekdaySchedule(cid: string, campaignId: string, weekdaysOnly: boolean) {
  const rows = await search(cid, `SELECT campaign_criterion.resource_name FROM campaign_criterion WHERE campaign.id = ${campaignId} AND campaign_criterion.type = AD_SCHEDULE`);
  const ops: any[] = rows.map((r) => ({ remove: r.campaignCriterion.resourceName }));
  if (weekdaysOnly) for (const day of ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]) {
    ops.push({ create: { campaign: `customers/${cid}/campaigns/${campaignId}`, adSchedule: { dayOfWeek: day, startHour: 8, startMinute: "ZERO", endHour: 20, endMinute: "ZERO" } } });
  }
  if (ops.length) await call(`/customers/${cid}/campaignCriteria:mutate`, { operations: ops });
  return { removed: rows.length };
}

// Recursos de la campaña (enlaces de sitio, destacados, extracto, promoción, precios): se crean y se enlazan tipo a tipo;
// si Google rechaza uno, los demás siguen. Devuelve qué se añadió y qué falló.
export async function addCampaignExtras(cid: string, campaignId: string, x: { sitelinks: { text: string; desc1: string; desc2: string; url: string }[]; callouts: string[]; snippet: { header: string; values: string[] } | null; promotion: { percentOff: number; item: string; code?: string } | null; prices: { header: string; description: string; price: number; url: string }[] }, o: { currency: string; language: string; url: string }) {
  const groups: [string, string, any[]][] = [
    ["enlaces de sitio", "SITELINK", x.sitelinks.map((s) => ({ sitelinkAsset: { linkText: s.text, description1: s.desc1, description2: s.desc2 }, finalUrls: [s.url] }))],
    ["destacados", "CALLOUT", x.callouts.map((t) => ({ calloutAsset: { calloutText: t } }))],
    ["extracto", "STRUCTURED_SNIPPET", x.snippet && x.snippet.values.length >= 3 ? [{ structuredSnippetAsset: { header: x.snippet.header, values: x.snippet.values } }] : []],
    ["promoción", "PROMOTION", x.promotion ? [{ promotionAsset: { promotionTarget: x.promotion.item, percentOff: String(x.promotion.percentOff * 10000), languageCode: o.language, ...(x.promotion.code ? { promotionCode: x.promotion.code } : {}) }, finalUrls: [o.url] }] : []],
    ["precios", "PRICE", x.prices.length >= 3 ? [{ priceAsset: { type: "PRODUCT_CATEGORIES", priceQualifier: "FROM", languageCode: o.language, priceOfferings: x.prices.map((p) => ({ header: p.header, description: p.description, price: { currencyCode: o.currency, amountMicros: toMicros(p.price) }, finalUrl: p.url })) } }] : []],
  ];
  const added: string[] = [], failed: string[] = [];
  for (const [label, fieldType, assets] of groups) {
    if (!assets.length) continue;
    try {
      const j = await call(`/customers/${cid}/assets:mutate`, { operations: assets.map((create) => ({ create })) });
      const names = (j.results || []).map((r: any) => r.resourceName);
      await call(`/customers/${cid}/campaignAssets:mutate`, { operations: names.map((asset: string) => ({ create: { campaign: `customers/${cid}/campaigns/${campaignId}`, asset, fieldType } })) });
      added.push(`${label} (${names.length})`);
    } catch (e: any) { failed.push(`${label}: ${e.message.slice(0, 160)}`); }
  }
  return { added, failed };
}

export async function setCampaignName(cid: string, campaignId: string, name: string) {
  await call(`/customers/${cid}/campaigns:mutate`, { operations: [{ updateMask: "name", update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, name } }] });
}

export async function updateKeyword(cid: string, adGroupId: string, criterionId: string, patch: { status?: "ENABLED" | "PAUSED"; maxCpc?: number }) {
  const update: any = { resourceName: `customers/${cid}/adGroupCriteria/${adGroupId}~${criterionId}` };
  const mask: string[] = [];
  if (patch.status) { update.status = patch.status; mask.push("status"); }
  if (patch.maxCpc != null) { update.cpcBidMicros = toMicros(patch.maxCpc); mask.push("cpc_bid_micros"); }
  await call(`/customers/${cid}/adGroupCriteria:mutate`, { operations: [{ updateMask: mask.join(","), update }] });
}

// Palabra nueva en un grupo de una campaña ya creada; devuelve el id del criterio.
export async function addKeyword(cid: string, adGroupId: string, k: { text: string; matchType: "EXACT" | "PHRASE"; maxCpc: number; finalUrl?: string | null }) {
  const j = await call(`/customers/${cid}/adGroupCriteria:mutate`, { operations: [{ create: {
    adGroup: `customers/${cid}/adGroups/${adGroupId}`, status: "ENABLED", cpcBidMicros: toMicros(k.maxCpc), keyword: { text: k.text, matchType: k.matchType }, ...(k.finalUrl ? { finalUrls: [k.finalUrl] } : {}),
  } }] });
  return j.results[0].resourceName.split("~").pop() as string;
}

export async function addNegative(cid: string, campaignId: string, text: string) {
  await call(`/customers/${cid}/campaignCriteria:mutate`, { operations: [{ create: { campaign: `customers/${cid}/campaigns/${campaignId}`, negative: true, keyword: { text, matchType: "PHRASE" } } }] });
}

export type KeywordRow = { criterionId: string; date: string; impressions: number; clicks: number; cost: number; conversions: number; convValue: number };

export async function keywordMetrics(cid: string, campaignId: string, from: string, to: string): Promise<KeywordRow[]> {
  const rows = await search(cid, `SELECT ad_group_criterion.criterion_id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM keyword_view WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${from}' AND '${to}'`);
  return rows.map((r) => ({
    criterionId: String(r.adGroupCriterion.criterionId), date: r.segments.date,
    impressions: Number(r.metrics.impressions || 0), clicks: Number(r.metrics.clicks || 0),
    cost: fromMicros(r.metrics.costMicros), conversions: Number(r.metrics.conversions || 0), convValue: Number(r.metrics.conversionsValue || 0),
  }));
}

export async function searchTerms(cid: string, campaignId: string, from: string, to: string) {
  const rows = await search(cid, `SELECT search_term_view.search_term, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${from}' AND '${to}'`);
  return rows.map((r) => ({ term: r.searchTermView.searchTerm as string, clicks: Number(r.metrics.clicks || 0), cost: fromMicros(r.metrics.costMicros), conversions: Number(r.metrics.conversions || 0) }));
}

// Acción de conversión "Venta" (subida por clic desde el webhook de Stripe)
export async function ensureConversionAction(cid: string, name: string, currency: string): Promise<string> {
  const rows = await search(cid, `SELECT conversion_action.id, conversion_action.name FROM conversion_action WHERE conversion_action.name = '${name.replace(/'/g, "\\'")}'`);
  if (rows[0]) return String(rows[0].conversionAction.id);
  const j = await call(`/customers/${cid}/conversionActions:mutate`, { operations: [{ create: {
    name, type: "UPLOAD_CLICKS", category: "PURCHASE", status: "ENABLED", countingType: "ONE_PER_CLICK",
    valueSettings: { defaultValue: 0, defaultCurrencyCode: currency, alwaysUseDefaultValue: false },
    clickThroughLookbackWindowDays: 30,
  } }] });
  return j.results[0].resourceName.split("/").pop();
}

// validateOnly: Google comprueba la venta (gclid, acción, fecha) sin apuntarla. Un rechazo parcial se convierte en error.
export async function uploadClickConversion(cid: string, conversionActionId: string, gclid: string, value: number, currency: string, when: Date, validateOnly = false) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = when;
  const conversionDateTime = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
  const j = await call(`/customers/${cid}:uploadClickConversions`, {
    conversions: [{ gclid, conversionAction: `customers/${cid}/conversionActions/${conversionActionId}`, conversionDateTime, conversionValue: value, currencyCode: currency }],
    partialFailure: true, validateOnly,
  });
  if (j.partialFailureError) throw new Error(`Google Ads: ${j.partialFailureError.details?.[0]?.errors?.map((e: any) => e.message).join("; ") || j.partialFailureError.message}`);
  return j;
}
