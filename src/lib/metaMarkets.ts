// Conjuntos de mercado de Meta: dentro de la misma campaña, un conjunto por grupo de países con sus propios textos
// (p. ej. México y Chile sin precios en euros). El conjunto principal se queda con los países que no estén en ningún mercado.
import { countriesOf } from "./markets";

export type MetaMarket = { key: string; label: string; countries: string; adSetId: string; share: number };

export const marketsOf = (extras: unknown): MetaMarket[] => (((extras || {}) as any).markets || []) as MetaMarket[];

// Países que le quedan al conjunto principal. Pura.
export const mainCountries = (all: string, markets: { countries: string }[]) => {
  const taken = new Set(markets.flatMap((m) => countriesOf(m.countries)));
  return countriesOf(all).filter((c) => !taken.has(c));
};

// Comprueba un mercado nuevo: sus países tienen que estar en la ficha, no repetirse y dejar alguno al principal. Pura.
export function checkMarket(all: string, markets: { countries: string; key: string }[], m: { key: string; countries: string; share: number }) {
  const want = countriesOf(m.countries), have = countriesOf(all);
  if (!m.key.trim()) throw new Error("Pon un nombre al grupo de países.");
  if (markets.some((x) => x.key === m.key)) throw new Error(`Ya hay un grupo «${m.key}».`);
  const out = want.filter((c) => !have.includes(c));
  if (out.length) throw new Error(`${out.join(", ")} no está en los países de la ficha (${have.join(", ")}).`);
  const dup = want.filter((c) => markets.some((x) => countriesOf(x.countries).includes(c)));
  if (dup.length) throw new Error(`${dup.join(", ")} ya está en otro grupo.`);
  if (!mainCountries(all, [...markets, m]).length) throw new Error("Al conjunto principal no le quedaría ningún país.");
  if (!(m.share > 0 && m.share < 1)) throw new Error("El reparto tiene que estar entre 1 y 99 %.");
}

// Presupuesto total (lifetime) de cada conjunto al cambiar el tope: cada uno conserva lo ya gastado y se lleva su parte de lo
// que queda. Así ninguno queda por debajo de su gasto (Meta lo rechazaría) y la suma es exactamente el tope. Pura.
export function splitBudget(totalCap: number, sets: { id: string; spent: number; share: number }[]) {
  const spent = sets.reduce((s, x) => s + x.spent, 0);
  const left = Math.max(0, totalCap - spent);
  const shares = sets.reduce((s, x) => s + x.share, 0) || 1;
  return Object.fromEntries(sets.map((x) => [x.id, Math.round((x.spent + (left * x.share) / shares) * 100) / 100]));
}

// ¿Es el último anuncio activo de su conjunto (principal o grupo de países)? Pausarlo dejaría ese conjunto, y esos países, sin anuncios. Pura.
export const lastActiveInSet = (ads: { id: string; status: string; metaAdId: string | null; market: string | null }[], adId: string) => {
  const a = ads.find((x) => x.id === adId);
  return !!a && !ads.some((x) => x.id !== adId && x.status === "ENABLED" && x.metaAdId && (x.market || null) === (a.market || null));
};

// Nombre interno de un grupo de países a partir de su nombre visible («México y Chile» → «mexico-y-chile»). Pura.
export const marketKey = (label: string) => label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
