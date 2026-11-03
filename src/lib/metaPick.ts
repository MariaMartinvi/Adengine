// Qué anuncios de la propuesta de Meta salen marcados: como mucho `max`, primero los de vídeo y luego los de referencias
// que llevan más tiempo en circulación (si un anuncio dura, le es rentable a su dueño). Sin fecha = al final.
export function pickMetaAds<T extends { refId: string; video: boolean; since?: Date | null }>(ads: T[], max = 4): Set<string> {
  const t = (d?: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);
  return new Set([...ads].sort((x, y) => Number(y.video) - Number(x.video) || t(x.since) - t(y.since)).slice(0, max).map((x) => x.refId));
}
