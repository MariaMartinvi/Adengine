// Caja de un anuncio dentro de una captura, en fracciones (0-1) de su ancho y alto, pasada a píxeles enteros
// y recortada a los bordes de la imagen. Devuelve null si queda demasiado pequeña para ser un anuncio.
export function boxToRect(box: { x: number; y: number; w: number; h: number }, width: number, height: number) {
  const f = (v: unknown) => Math.min(1, Math.max(0, Number(v) || 0));
  const x0 = f(box.x), y0 = f(box.y), x1 = f(box.x + box.w), y1 = f(box.y + box.h);
  const left = Math.round(x0 * width), top = Math.round(y0 * height);
  const rect = { left, top, width: Math.round(x1 * width) - left, height: Math.round(y1 * height) - top };
  return rect.width >= 40 && rect.height >= 40 ? rect : null;
}

// Cuánto lleva un anuncio en circulación, en palabras («4 meses», «12 días»), desde su fecha de inicio.
export function sinceText(since: string, today = new Date()) {
  const d = new Date(since + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (days < 0) return "";
  if (days < 60) return `${days} ${days === 1 ? "día" : "días"}`;
  const months = Math.floor(days / 30.4);
  return months < 24 ? `${months} meses` : `${Math.floor(months / 12)} años`;
}
