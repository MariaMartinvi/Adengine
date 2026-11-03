// Rotación de ganadores en Meta: qué anuncios proponer pausar para dejar el dinero al que mejor vende.
// Resultado = compras (o clics a compra si la campaña aún no tiene compras). A partir de 3 días, se proponen los que
// han gastado al menos 1 CAC tope y cuestan más del doble por resultado que el mejor, o no tienen ninguno. El mejor nunca.
type AdTotals = { id: string; cost: number; conversions: number; purchases: number };

// Pausa automática: anuncio activo que ha gastado 1 CAC de validación sin ningún clic a compra.
export function metaAdsToPause<T extends { id: string; status: string }>(ads: T[], totals: Map<string, { cost: number; conversions: number }>, cacTest: number) {
  return ads.filter((a) => {
    const t = totals.get(a.id);
    return a.status === "ENABLED" && !!t && t.conversions === 0 && t.cost >= cacTest;
  });
}

export function metaRotation(ads: AdTotals[], { cacCap, days }: { cacCap: number; days: number }) {
  if (days < 3) return [];
  const byBuys = ads.some((a) => a.purchases > 0);
  const res = (a: AdTotals) => (byBuys ? a.purchases : a.conversions);
  const what = byBuys ? "compra" : "clic a compra";
  const cpr = (a: AdTotals) => (res(a) ? a.cost / res(a) : Infinity);
  const best = [...ads].filter((a) => res(a) > 0).sort((x, y) => cpr(x) - cpr(y))[0];
  if (!best) return [];
  return ads
    .filter((a) => a.id !== best.id && a.cost >= cacCap && cpr(a) > 2 * cpr(best))
    .map((a) => ({
      id: a.id,
      reason: res(a)
        ? `Cuesta ${cpr(a).toFixed(2)} por ${what} frente a ${cpr(best).toFixed(2)} del mejor anuncio. Pausarlo deja su dinero al que vende.`
        : `${a.cost.toFixed(2)} gastados sin ${byBuys ? "compras" : "clics a compra"}; el mejor anuncio va a ${cpr(best).toFixed(2)} por ${what}. Pausarlo deja su dinero al que vende.`,
    }));
}
