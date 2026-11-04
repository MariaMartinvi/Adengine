// Grupos de Google con palabras incluidas pero sin ningún anuncio incluido: Google no tendría qué enseñar.
export function groupsWithoutAd(keywords: { adGroup?: string | null; included: boolean }[], ads: { adGroup?: string | null; included: boolean }[]) {
  const name = (g?: string | null) => g || "Grupo 1";
  const withAd = new Set(ads.filter((a) => a.included).map((a) => name(a.adGroup)));
  return Array.from(new Set(keywords.filter((k) => k.included).map((k) => name(k.adGroup)))).filter((g) => !withAd.has(g));
}
