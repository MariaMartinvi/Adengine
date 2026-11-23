// Textos de un anuncio adaptable de búsqueda de Google: 3-15 titulares de hasta 30 caracteres y 2-4 descripciones de hasta 90.
export function checkRsaTexts(headlines: string[], descriptions: string[]) {
  const h = headlines.map((x) => String(x || "").trim()).filter(Boolean);
  const d = descriptions.map((x) => String(x || "").trim()).filter(Boolean);
  if (h.length < 3 || h.length > 15) throw new Error("Hacen falta entre 3 y 15 titulares.");
  if (d.length < 2 || d.length > 4) throw new Error("Hacen falta entre 2 y 4 descripciones.");
  const longH = h.find((x) => x.length > 30); if (longH) throw new Error(`Titular de más de 30 caracteres: «${longH}».`);
  const longD = d.find((x) => x.length > 90); if (longD) throw new Error(`Descripción de más de 90 caracteres: «${longD}».`);
  const dup = (xs: string[]) => xs.find((x, i) => xs.findIndex((y) => y.toLowerCase() === x.toLowerCase()) !== i);
  const dh = dup(h) || dup(d); if (dh) throw new Error(`Texto repetido: «${dh}».`);
  return { headlines: h, descriptions: d };
}
