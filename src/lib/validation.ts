// ¿Vende este MVP a un coste que deja margen? Gasto, ventas reales (las que avisa la web), CAC por canal, embudo y veredicto.
// Dos CAC: el de escalado (cacCap, el que deja margen para crecer) y el de validación (cacTest, lo que se acepta pagar por
// venta mientras se prueba; vacío = 2 × escalado). Reglas fijas: < 1 CAC de validación gastado = pronto;
// ≥ 3 ventas con CAC ≤ escalado = escalar; ≥ 3 CAC de validación gastados sin ventas = parar; lo demás, iterar (con el motivo).
type M = { cost: number; impressions: number; clicks: number; conversions: number; purchases?: number };
export const cacTestOf = (b: { cacCap: number; cacTest?: number | null }) => b.cacTest || 2 * b.cacCap;
export type ValidationInput = { cacCap: number; cacTest?: number | null; campaigns: { channel: string; metrics: M[] }[]; sales: { channel?: string | null; amount: number }[] };
export type Verdict = { code: "pronto" | "escalar" | "iterar" | "parar"; label: string; reason: string };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const ch = (c: string) => (c === "meta" ? "meta" : "google");

export function validate({ cacCap, cacTest: test, campaigns, sales }: ValidationInput) {
  const cacTest = cacTestOf({ cacCap, cacTest: test });
  const spendOf = (k: "google" | "meta") => sum(campaigns.filter((c) => ch(c.channel) === k).flatMap((c) => c.metrics.map((m) => m.cost)));
  const salesOf = (k: string) => sales.filter((s) => s.channel === k).length;
  const google = { spend: spendOf("google"), sales: salesOf("google") };
  const meta = { spend: spendOf("meta"), sales: salesOf("meta") };
  const spend = google.spend + meta.spend;
  const ads = google.sales + meta.sales;
  const cacOf = (x: { spend: number; sales: number }) => (x.sales ? x.spend / x.sales : null);
  const cac = cacOf({ spend, sales: ads });
  const all = campaigns.flatMap((c) => c.metrics);
  const funnel = { impressions: sum(all.map((m) => m.impressions)), clicks: sum(all.map((m) => m.clicks)), checkouts: sum(campaigns.filter((c) => ch(c.channel) === "meta").flatMap((c) => c.metrics.map((m) => m.conversions))), sales: ads };

  let verdict: Verdict;
  if (ads >= 3 && cac! <= cacCap) verdict = { code: "escalar", label: "Escalar", reason: `${ads} ventas a ${cac!.toFixed(2)} € cada una, por debajo del CAC de escalado (${cacCap} €).` };
  else if (!ads && spend >= 3 * cacTest) verdict = { code: "parar", label: "Parar o pivotar", reason: `${spend.toFixed(2)} € gastados (${(spend / cacTest).toFixed(1)} × CAC de validación) sin ninguna venta.` };
  else if (!ads && spend < cacTest) verdict = { code: "pronto", label: "Aún pronto", reason: `Gastados ${spend.toFixed(2)} € de ${cacTest} € (1 CAC de validación) antes de juzgar.` };
  else if (ads && cac! > cacCap) verdict = { code: "iterar", label: "Iterar", reason: `Vende, pero caras: ${cac!.toFixed(2)} € por venta frente a ${cacCap} € de escalado${cac! <= cacTest ? ` (dentro del CAC de validación, ${cacTest} €: sigue probando para bajarlo)` : ` y ${cacTest} € de validación`}.` };
  else if (ads) verdict = { code: "iterar", label: "Iterar", reason: `Buena señal (${cac!.toFixed(2)} € por venta), pero ${ads} ${ads === 1 ? "venta es" : "ventas son"} poca muestra: faltan ${3 - ads} para decidir.` };
  else if (funnel.checkouts) verdict = { code: "iterar", label: "Iterar", reason: `${funnel.checkouts} clics a compra y ninguna venta: el anuncio atrae, falla la web o el precio.` };
  else verdict = { code: "iterar", label: "Iterar", reason: `${spend.toFixed(2)} € gastados sin ventas ni clics a compra: prueba otro ángulo de anuncio.` };

  return {
    spend, revenue: sum(sales.map((s) => s.amount)), cac, cacTest, verdict, funnel,
    // MER: ventas totales (con y sin anuncio) por cada euro de anuncios. CAC blended: gasto entre todos los clientes.
    mer: spend > 0 ? sum(sales.map((s) => s.amount)) / spend : null,
    blendedCac: sales.length ? spend / sales.length : null,
    sales: { ads, organic: sales.length - ads, total: sales.length },
    byChannel: { google: { ...google, cac: cacOf(google) }, meta: { ...meta, cac: cacOf(meta) } },
  };
}
