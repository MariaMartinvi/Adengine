// Adaptador de Google Ads sobre la API REST. No hay nada de Google fuera de esta carpeta.
import { accessToken } from "./auth";

const V = () => process.env.GOOGLE_ADS_API_VERSION || "v22";
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
  const rows = await search(mcc, `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager FROM customer_client WHERE customer_client.level <= 1`);
  return rows.filter((r) => !r.customerClient.manager).map((r) => ({ id: String(r.customerClient.id), name: r.customerClient.descriptiveName }));
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
  name: string; dailyBudget: number; country: string; language: string; finalUrl: string;
  keywords: { text: string; matchType: "EXACT" | "PHRASE"; maxCpc: number }[];
  ads: { headlines: string[]; descriptions: string[] }[];
  negatives: string[];
  schedule: boolean; // lunes-viernes 8-20
};

// Crea presupuesto + campaña (EN PAUSA) + grupo + palabras + anuncios en una sola llamada atómica.
export async function createSearchCampaign(cid: string, s: CampaignSpec) {
  const B = `customers/${cid}/campaignBudgets/-1`;
  const C = `customers/${cid}/campaigns/-2`;
  const G = `customers/${cid}/adGroups/-3`;
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
    { adGroupOperation: { create: { resourceName: G, name: `${s.name} · grupo 1`, campaign: C, status: "ENABLED", type: "SEARCH_STANDARD" } } },
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
    ops.push({ adGroupCriterionOperation: { create: { adGroup: G, status: "ENABLED", cpcBidMicros: toMicros(k.maxCpc), keyword: { text: k.text, matchType: k.matchType } } } });
  }
  for (const a of s.ads) {
    ops.push({ adGroupAdOperation: { create: { adGroup: G, status: "ENABLED", ad: {
      finalUrls: [s.finalUrl],
      responsiveSearchAd: { headlines: a.headlines.map((t) => ({ text: t })), descriptions: a.descriptions.map((t) => ({ text: t })) },
    } } } });
  }
  const j = await call(`/customers/${cid}/googleAds:mutate`, { mutateOperations: ops, partialFailure: false });
  const res: any[] = j.mutateOperationResponses || [];
  const id = (rn: string) => rn.split("/").pop()!.split("~").pop()!;
  const budgetId = id(res[0].campaignBudgetResult.resourceName);
  const campaignId = id(res[1].campaignResult.resourceName);
  const adGroupId = id(res[4].adGroupResult.resourceName);
  const criterionIds = res.filter((r) => r.adGroupCriterionResult).map((r) => id(r.adGroupCriterionResult.resourceName));
  const adIds = res.filter((r) => r.adGroupAdResult).map((r) => id(r.adGroupAdResult.resourceName));
  return { budgetId, campaignId, adGroupId, criterionIds, adIds };
}

export async function setCampaignStatus(cid: string, campaignId: string, status: "ENABLED" | "PAUSED") {
  await call(`/customers/${cid}/campaigns:mutate`, { operations: [{ updateMask: "status", update: { resourceName: `customers/${cid}/campaigns/${campaignId}`, status } }] });
}

export async function updateKeyword(cid: string, adGroupId: string, criterionId: string, patch: { status?: "ENABLED" | "PAUSED"; maxCpc?: number }) {
  const update: any = { resourceName: `customers/${cid}/adGroupCriteria/${adGroupId}~${criterionId}` };
  const mask: string[] = [];
  if (patch.status) { update.status = patch.status; mask.push("status"); }
  if (patch.maxCpc != null) { update.cpcBidMicros = toMicros(patch.maxCpc); mask.push("cpc_bid_micros"); }
  await call(`/customers/${cid}/adGroupCriteria:mutate`, { operations: [{ updateMask: mask.join(","), update }] });
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

export async function uploadClickConversion(cid: string, conversionActionId: string, gclid: string, value: number, currency: string, when: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = when;
  const conversionDateTime = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
  return call(`/customers/${cid}:uploadClickConversions`, {
    conversions: [{ gclid, conversionAction: `customers/${cid}/conversionActions/${conversionActionId}`, conversionDateTime, conversionValue: value, currencyCode: currency }],
    partialFailure: true,
  });
}
