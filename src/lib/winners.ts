// Nuestros ganadores: anuncios de Meta que venden a un CAC con el que se puede crecer.
// Se proponen como referencia (María decide) para que las campañas nuevas partan de lo que ya nos funciona.
export const MIN_WINNER_SALES = 2;
export function winnersToSave(ads: { id: string; cost: number; purchases: number }[], cacCap: number, alreadyProposed: Set<string>) {
  return ads
    .filter((a) => a.purchases >= MIN_WINNER_SALES && a.cost / a.purchases <= cacCap && !alreadyProposed.has(a.id))
    .map((a) => ({ id: a.id, cac: Math.round((a.cost / a.purchases) * 100) / 100, purchases: a.purchases }));
}
