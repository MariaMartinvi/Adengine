// Embudo de un canal: dónde se pierde la gente entre ver el anuncio y comprar.
// Umbrales orientativos para tiendas pequeñas en España; se ajustan cuando tengamos datos propios.
export type Funnel = { impressions: number; clicks: number; visits?: number; checkouts?: number; purchases: number };
export type Diagnosis = { code: "datos" | "anuncio" | "carga" | "pagina" | "pago" | "ok"; text: string };

export const MIN_CLICKS = 100;
const pct = (a: number, b: number) => (b > 0 ? a / b : 0);
const p = (x: number) => `${(x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;

export function diagnose(channel: "meta" | "google", f: Funnel): Diagnosis {
  if (f.clicks < MIN_CLICKS) return { code: "datos", text: `Faltan datos: ${f.clicks} de ${MIN_CLICKS} clics para saber dónde se pierde la gente.` };
  const ctr = pct(f.clicks, f.impressions);
  if (ctr < (channel === "meta" ? 0.008 : 0.03)) return { code: "anuncio", text: `El anuncio no atrae (solo ${p(ctr)} hace clic): cambia la imagen o el gancho.` };
  if (channel === "google") {
    const conv = pct(f.purchases, f.clicks);
    return conv < 0.01
      ? { code: "pagina", text: `Hacen clic pero no compran (${p(conv)} de los clics): revisa la página, el precio o el pago.` }
      : { code: "ok", text: `El embudo funciona: compra el ${p(conv)} de los que hacen clic.` };
  }
  const load = pct(f.visits || 0, f.clicks);
  if (load < 0.7) return { code: "carga", text: `Se pierden al abrir la página (solo carga el ${p(load)} de los clics): la página tarda o falla en el móvil.` };
  const start = pct(f.checkouts || 0, f.visits || 0);
  if (start < 0.03) return { code: "pagina", text: `La página no convence (solo el ${p(start)} de las visitas empieza a pagar): oferta, precio o confianza.` };
  const close = pct(f.purchases, f.checkouts || 0);
  if ((f.checkouts || 0) >= 5 && close < 0.3) return { code: "pago", text: `Se caen en el pago (solo termina el ${p(close)} de los que empiezan): precio final, envío o formulario.` };
  return { code: "ok", text: `El embudo funciona: compra el ${p(pct(f.purchases, f.clicks))} de los que hacen clic.` };
}

// Embudo de un negocio por canal en los últimos `days` días. Compras = ventas reales (Stripe) atribuidas a ese canal.
type M = { date: string | Date; impressions: number; clicks: number; visits?: number; conversions: number };
export function funnelsOf(campaigns: { channel: string; metrics: M[] }[], sales: { channel?: string | null; createdAt: string | Date }[], days = 14, now = new Date()) {
  const since = new Date(now.getTime() - days * 86400000);
  const out = {} as Record<"meta" | "google", Funnel & { diagnosis: Diagnosis }>;
  for (const k of ["meta", "google"] as const) {
    const ms = campaigns.filter((c) => (c.channel === "meta" ? "meta" : "google") === k).flatMap((c) => c.metrics).filter((m) => new Date(m.date) >= since);
    const s = (f: (m: M) => number) => ms.reduce((t, m) => t + (f(m) || 0), 0);
    const f: Funnel = { impressions: s((m) => m.impressions), clicks: s((m) => m.clicks), purchases: sales.filter((x) => x.channel === k && new Date(x.createdAt) >= since).length };
    if (k === "meta") { f.visits = s((m) => m.visits || 0); f.checkouts = s((m) => m.conversions); }
    out[k] = { ...f, diagnosis: diagnose(k, f) };
  }
  return out;
}
