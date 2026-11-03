// Generación con el modelo: ficha desde URL, semillas, palabras y anuncios.
async function ask(system: string, user: string | any[], maxTokens = 3000): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Modelo: ${JSON.stringify(j)}`);
  return j.content.map((c: any) => c.text || "").join("");
}
// Primer objeto JSON completo de la respuesta (el modelo a veces añade texto detrás).
function json<T>(s: string): T {
  const clean = s.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }
  return JSON.parse(clean.slice(start));
}

export type Ref = { note: string; image?: string | null; video?: boolean; audio?: string | null; product?: string | null; item?: { name: string; url: string } | null };
const COPY_RULE = `Te paso referencias: anuncios que ya funcionan (texto y, a veces, captura). Cálcalos casi al 100 %: mismo formato, misma estructura, misma longitud, mismo tono, mismo tipo de gancho, mismos emojis y puntuación, mismo tipo de titular y de botón; en castellano de España y con nuestro producto ("Nuestro cuadro") y los datos reales de la ficha en lugar de los suyos. Lo único que NO se copia: testimonios o frases atribuidas a clientes, reseñas, estrellas, cifras de ventas o clientes, rankings ("#1", "el más regalado") y marcas ajenas, porque en nuestro anuncio serían falsos. Si la referencia usa un testimonio, escribe una frase de la marca (no de un cliente) con el mismo ritmo y dilo en basedOn. Ofertas: solo las que estén en la ficha. Indica en basedOn qué referencia calcas y qué has cambiado ("Referencia 2: testimonio → frase de la marca"), máximo 160 caracteres.`;
// Mensaje con la ficha y las referencias; las capturas van como imágenes para que el modelo las vea.
function withRefs(text: string, refs: Ref[]): any[] {
  const content: any[] = [{ type: "text", text }];
  refs.forEach((r, i) => {
    content.push({ type: "text", text: `Referencia ${i + 1}${r.video ? " (vídeo)" : ""}: ${r.note || "(sin nota)"}${r.video ? `\nMúsica y audio: ${r.audio}` : ""}${r.item ? `\nNuestro cuadro para este anuncio: ${r.item.name} · ${r.item.url}` : r.product ? `\nNuestro cuadro para este anuncio: ${r.product}` : ""}` });
    const m = r.image?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  });
  return content;
}

export type Ficha = {
  name: string; sells: string; audience: string; country: string; language: string; currency: string;
  price: number; marginPct: number; saleEvent: string; cacCap: number; maxCpc: number; dailyBudget: number; totalCap: number;
  seeds: string[]; notes: string;
};

export async function fichaFromSite(siteText: string): Promise<Ficha> {
  const sys = `Eres el analista de un motor de publicidad prudente. Lees el texto de una web y devuelves SOLO un JSON con la ficha del negocio. Sin texto fuera del JSON.
Campos: name, sells (qué vende, 1 frase), audience (a quién, 1 frase), country (ISO-2, el mercado principal que se deduce; si duda, "ES"), language (ISO-2), currency (ISO), price (precio de la venta que se debe optimizar: el primer pago real con tarjeta; en suscripción, el primer cobro, aunque sea una prueba de pago), marginPct (0-100, estimado por tipo de negocio: SaaS 80, servicios 60, ecommerce físico 35, POD 25, libros 20), saleEvent (nombre corto del evento de venta), cacCap (coste máximo por venta: para suscripciones estima margen de 3 meses × 0,5; para venta única precio × marginPct/100 × 0,5; redondea), maxCpc (techo por clic prudente para ese mercado, 0.3-1.2), dailyBudget (8-15), totalCap (250-400), seeds (8-12 términos CORTOS de 2-4 palabras que la gente realmente teclea en Google, en el idioma del mercado y en lenguaje de cliente, no de marketing: p. ej. "redactor seo", no "cómo conseguir clientes sin pagar publicidad"; Google no tiene datos de frases largas; nada de términos genéricos caros como "agencia seo"), notes (2 frases: riesgos y palanca principal).`;
  return json<Ficha>(await ask(sys, siteText));
}

export type KeywordPick = { text: string; matchType: "EXACT" | "PHRASE"; intent: string; url?: string; group?: string };
export type KeywordGroup = { name: string; url: string; images: string[] };

export async function pickKeywords(ficha: { sells: string; audience: string; language: string; maxCpc: number }, ideas: { text: string; volume: number; cpcLow: number; cpcHigh: number }[], pages: { name: string; url: string; image?: boolean }[] = []): Promise<{ keywords: KeywordPick[]; negatives: string[]; groups: KeywordGroup[] }> {
  const sys = `Eres el planificador de un motor de anuncios en Google Búsqueda con estrategia de PRUDENCIA: pocas palabras, todas con intención de contratar/comprar, coste por clic bajo. Devuelves SOLO JSON: {"keywords":[{"text","matchType":"EXACT"|"PHRASE","intent"}],"negatives":[...]}.
Reglas: elige 25-45 palabras de la lista de ideas (solo textos que estén en la lista). Descarta informativas puras ("qué es", "gratis", "curso", "empleo", "definición"), marcas de terceros y todo lo que tenga cpcLow por encima de 1.3× el techo de CPC. Prioriza volumen ≥ 30 y cpcLow bajo. matchType EXACT para las de intención más clara, PHRASE para las de cola larga. intent: 5-8 palabras explicando por qué. negatives: 15-25 términos a excluir (gratis, empleo, curso, cómo hacer, plantilla, ejemplo, pdf, wikipedia, marcas competidoras que aparezcan, etc.) en el idioma del mercado.${pages.length ? `
Páginas de destino: cada palabra lleva "url", la página más específica de la lista que responde a esa búsqueda (el cuadro concreto, su colección o, si no encaja ninguna, la tienda). Solo urls de la lista.
Grupos por tema: agrupa las palabras en 3 a 7 temas (Virgen María, Buen Pastor, versículos…); cada palabra lleva "group" con el nombre de su tema. Devuelve también "groups":[{"name","url","images"}]: url = la página del tema (su colección o su cuadro); images = hasta 2 urls de la lista marcadas [foto] que representen el tema.` : ""}`;
  const user = `Negocio: ${ficha.sells}\nCliente: ${ficha.audience}\nIdioma: ${ficha.language}\nTecho CPC: ${ficha.maxCpc}\n\nIdeas (text | volume | cpcLow | cpcHigh):\n${ideas.slice(0, 300).map((i) => `${i.text} | ${i.volume} | ${i.cpcLow.toFixed(2)} | ${i.cpcHigh.toFixed(2)}`).join("\n")}${pages.length ? `\n\nPáginas de destino (nombre | url):\n${pages.map((p) => `${p.name} | ${p.url}${p.image ? " [foto]" : ""}`).join("\n")}` : ""}`;
  const j = json<{ keywords: KeywordPick[]; negatives: string[]; groups?: KeywordGroup[] }>(await ask(sys, user, 8000));
  const ok = new Set(pages.map((p) => p.url)), withImage = new Set(pages.filter((p) => p.image).map((p) => p.url));
  for (const k of j.keywords) if (k.url && !ok.has(k.url)) delete k.url;
  // Grupos válidos: con página de la lista, fotos de cuadros con foto y al menos una palabra.
  const groups = (j.groups || []).filter((g) => g?.name && ok.has(g.url)).map((g) => ({ name: String(g.name).trim().slice(0, 60), url: g.url, images: (g.images || []).filter((u) => withImage.has(u)).slice(0, 2) }))
    .filter((g) => j.keywords.some((k) => k.group === g.name));
  for (const k of j.keywords) if (groups.length && !groups.some((g) => g.name === k.group)) k.group = groups[0].name;
  return { keywords: j.keywords, negatives: j.negatives, groups };
}

export async function writeAds(ficha: { name: string; sells: string; audience: string; language: string; price: number; saleEvent: string; url: string; notes?: string | null }, keywords: string[], refs: Ref[], groups: { name: string; keywords: string[] }[] = []): Promise<{ ref: number; group: number; headlines: string[]; descriptions: string[]; basedOn: string; path: string[] }[]> {
  const sys = `Escribes anuncios de búsqueda adaptables de Google en el idioma indicado. Devuelves SOLO JSON: {"ads":[{"group":número del grupo,"ref":número de la referencia que calca,"headlines":[15 títulos ≤30 caracteres],"descriptions":[4 descripciones ≤90 caracteres],"path":["parte1","parte2"],"basedOn":"…"}]}. path: la ruta que se ve en el enlace (tienda.com/parte1/parte2), dos palabras del tema del anuncio, minúsculas, sin espacios ni tildes, máximo 15 caracteres cada una (p. ej. ["caricatura","boda"]). ${groups.length ? "Un anuncio por grupo, en el orden de la lista de grupos: habla del tema del grupo (sus palabras) y calca la referencia que mejor le encaje; reparte las referencias entre los grupos." : "Un anuncio por referencia, en el mismo orden."} En las referencias de Google, un título como «A - B» son dos títulos distintos que Google une: cálcalos como títulos separados, cada uno de 30 caracteres como máximo. Igual con la descripción: lo que ves suele ser dos descripciones unidas; cada una, 90 caracteres como máximo. ${COPY_RULE} Reglas: lenguaje de cliente, beneficio concreto, sin mayúsculas gritadas, sin exclamaciones dobles, sin promesas absolutas, sin "haz clic". Incluye el precio o la oferta de entrada cuando ayude. Cada título debe caber en 30 caracteres CONTADOS; cada descripción en 90. Varía: algunos títulos con la búsqueda del cliente, otros con la propuesta, otros con la prueba.`;
  const user = `Negocio: ${ficha.name} — ${ficha.sells}\nCliente: ${ficha.audience}\nIdioma: ${ficha.language}\nOferta de entrada: ${ficha.saleEvent} (${ficha.price})\nURL: ${ficha.url}\nNotas: ${ficha.notes || ""}\nBúsquedas objetivo: ${keywords.slice(0, 20).join(", ")}${groups.length ? `\nGrupos:\n${groups.map((g, i) => `${i + 1}. ${g.name}: ${g.keywords.slice(0, 8).join(", ")}`).join("\n")}` : ""}`;
  const raw = await ask(sys, withRefs(user, refs), 8000);
  const j = json<{ ads: { ref?: number; group?: number; headlines: string[]; descriptions: string[]; basedOn?: string; path?: string[] }[] }>(raw);
  // Los textos que se pasan de largo se mandan a acortar en una sola llamada, en vez de tirarlos.
  const long: { text: string; max: number }[] = [];
  for (const a of j.ads || []) {
    for (const h of a.headlines || []) if (h.trim().length > 30) long.push({ text: h.trim(), max: 30 });
    for (const d of a.descriptions || []) if (d.trim().length > 90) long.push({ text: d.trim(), max: 90 });
  }
  if (long.length) {
    const short = await shorten(long, ficha.language);
    const map = new Map(long.map((l, i) => [l.text, short[i]]));
    for (const a of j.ads || []) {
      a.headlines = (a.headlines || []).map((h) => map.get(h.trim()) ?? h);
      a.descriptions = (a.descriptions || []).map((d) => map.get(d.trim()) ?? d);
    }
  }
  // Recorta por seguridad: Google rechaza el anuncio entero si un texto se pasa.
  const ok = (j.ads || []).map((a, i) => ({
    ref: Number(a.ref) || i + 1,
    group: Number((a as { group?: number }).group) || i + 1,
    headlines: Array.from(new Set(a.headlines.map((h) => h.trim()).filter((h) => h.length <= 30 && h.length > 0 && allowedText(h)))).slice(0, 15),
    descriptions: Array.from(new Set(a.descriptions.map((d) => d.trim()).filter((d) => d.length <= 90 && d.length > 0 && allowedText(d)))).slice(0, 4),
    basedOn: (a.basedOn || "").trim().slice(0, 160),
    path: (a.path || []).map(cleanPath).filter(Boolean).slice(0, 2),
  })).filter((a) => a.headlines.length >= 3 && a.descriptions.length >= 2);
  // Si no queda ninguno, decir qué llegó para poder corregir el encargo.
  if (!ok.length) {
    const a = j.ads?.[0];
    throw new Error(`La IA no devolvió anuncios válidos: ${j.ads?.length ?? 0} recibidos${a ? `; el primero con ${a.headlines?.length ?? 0} títulos (largos: ${(a.headlines || []).map((h) => String(h).length).join(",")}) y ${a.descriptions?.length ?? 0} descripciones (largos: ${(a.descriptions || []).map((d) => String(d).length).join(",")})` : `; respuesta: ${raw.slice(0, 200)}`}.`);
  }
  return ok;
}

// Reescribe cada texto para que quepa en su límite, sin cambiar el sentido ni los datos. Hasta dos rondas:
// a los que sigan largos se les dice cuántos caracteres tienen. Lo que no quepa se queda largo y se descarta después (nunca se corta a medias).
async function shorten(items: { text: string; max: number }[], language: string): Promise<string[]> {
  const out = items.map((x) => x.text);
  for (let round = 0; round < 2; round++) {
    const todo = out.map((t, i) => ({ i, t, max: items[i].max })).filter((x) => x.t.length > x.max);
    if (!todo.length) break;
    const sys = `Acortas textos de anuncios en el idioma indicado. Devuelves SOLO JSON: {"texts":[…]} en el mismo orden. Cada texto debe quedar por DEBAJO de su máximo de caracteres (cuenta espacios y signos): quita palabras de relleno o reformula más corto. Conserva el sentido, los datos y las cifras; frase completa y natural, sin puntos suspensivos.`;
    const user = `Idioma: ${language}\n` + todo.map((x, n) => `${n + 1}. (tiene ${x.t.length}, máximo ${x.max - 3}) ${x.t}`).join("\n");
    const j = json<{ texts: string[] }>(await ask(sys, user, 3000));
    todo.forEach((x, n) => { const t = String(j.texts?.[n] ?? "").trim(); if (t && t.length < x.t.length) out[x.i] = t; });
  }
  return out;
}

// Parte de la ruta visible de Google: minúsculas, sin tildes ni espacios, 15 caracteres.
export const cleanPath = (p: unknown) => String(p || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 15);

// Afirmaciones que no podemos hacer (rankings, reseñas, cifras de clientes): el texto que las lleve no pasa.
const BANNED = /m[aá]s regalad|n[º°o]\.? ?1\b|#1|n[uú]mero uno|estrellas|rese[ñn]as|valoraci|miles de|clientes satisfech|hogares (decorados|felices)/i;
export const allowedText = (t: string) => !BANNED.test(t);

export type MetaCopy = { message: string; headline: string; description: string; basedOn: string };

// Textos para Facebook/Instagram. Un solo juego de textos, compartido por el anuncio de imagen y el de vídeo.
export async function writeMetaAds(ficha: { name: string; sells: string; audience: string; language: string; price: number; url: string; notes?: string | null }, refs: Ref[]): Promise<MetaCopy> {
  const sys = `Escribes anuncios para Facebook e Instagram en el idioma indicado. Devuelves SOLO JSON: {"message","headline","description","basedOn"}. ${COPY_RULE}
- message (texto principal): 2-4 frases, máximo 300 caracteres. La primera frase engancha por sí sola (es lo único que se ve sin pulsar "ver más"). Lenguaje cercano, sin mayúsculas gritadas, sin exclamaciones dobles, sin promesas absolutas, sin emojis en exceso (máximo 2).
- headline (titular bajo la imagen): máximo 40 caracteres.
- description (línea pequeña bajo el titular): máximo 30 caracteres.
El anuncio lo ve un adulto que decide (madre, padre, docente); si el producto es para menores, háblale a ese adulto, nunca al menor.`;
  const user = `Producto: ${ficha.name} — ${ficha.sells}\nPara quién: ${ficha.audience}\nIdioma: ${ficha.language}\nPrecio: ${ficha.price}\nWeb: ${ficha.url}\nNotas: ${ficha.notes || ""}`;
  const j = json<MetaCopy>(await ask(sys, withRefs(user, refs), 1000));
  // Recorta por seguridad a los límites de Meta.
  return { message: j.message.trim().slice(0, 300), headline: j.headline.trim().slice(0, 40), description: j.description.trim().slice(0, 30), basedOn: (j.basedOn || "").trim().slice(0, 120) };
}

export type MetaAdCopy = MetaCopy & { script: string };

// Un anuncio de Meta que calca una referencia con nuestro cuadro. Si la referencia es un vídeo, además un guion para grabar el nuestro igual.
export async function writeMetaAdFromRef(ficha: { name: string; sells: string; audience: string; language: string; price: number; url: string; notes?: string | null }, ref: Ref, revise?: { previous: { message: string; headline: string; description: string }; feedback: string }): Promise<MetaAdCopy> {
  const sys = `Escribes un anuncio para Facebook e Instagram en el idioma indicado, calcando la referencia. Devuelves SOLO JSON: {"message","headline","description","basedOn","script"}.
- message (texto principal): máximo 300 caracteres. headline (titular bajo la imagen): máximo 40. description: máximo 30.
- script: si la referencia es un vídeo, guion para grabar el nuestro igual con nuestro cuadro: duración, plano a plano con segundos, texto sobreimpreso y música (la de la referencia). Si no es vídeo, "".
${COPY_RULE}`;
  const user = `Producto: ${ficha.name} — ${ficha.sells}\nPara quién: ${ficha.audience}\nIdioma: ${ficha.language}\nPrecio: desde ${ficha.price}\nWeb: ${ficha.url}\nNotas y datos reales: ${ficha.notes || ""}`;
  // Rehacer con comentarios: la versión anterior y lo que pide María, que manda sobre todo lo demás (salvo las reglas de no inventar).
  const extra = revise ? `\n\nVersión anterior del anuncio:\nTexto: ${revise.previous.message}\nTitular: ${revise.previous.headline}\nDescripción: ${revise.previous.description}\n\nComentarios para mejorarlo (aplícalos todos): ${revise.feedback}` : "";
  const j = json<MetaAdCopy>(await ask(sys, withRefs(user + extra, [ref]), 2000));
  return { message: j.message.trim().slice(0, 300), headline: j.headline.trim().slice(0, 40), description: (j.description || "").trim().slice(0, 30), basedOn: (j.basedOn || "").trim().slice(0, 160), script: ref.video ? (j.script || "").trim() : "" };
}

// Guion para montar nuestro vídeo calcando el de la referencia, con las fotos de nuestro producto (se le enseñan numeradas).
export type VideoPlanAI = { transition: "cut" | "fade"; scenes: { photo: number; seconds: number; zoom?: boolean; scale?: number; focusY?: number }[]; captions: { text: string; from: number; to: number }[] };
export async function writeVideoPlan(ficha: { name: string; sells: string; language: string; notes?: string | null }, ref: Ref, photos: string[], revise?: string) {
  const sys = `Montas un vídeo vertical 9:16 para Facebook e Instagram calcando el vídeo de la referencia, con las fotos de NUESTRO producto que te enseño numeradas. Devuelves SOLO JSON:
{"transition":"cut"|"fade","scenes":[{"photo":n,"seconds":s,"zoom":bool,"scale":k,"focusY":y}],"captions":[{"text","from","to"}]}
- Misma duración total que la referencia, mismo número de cortes y mismo ritmo (segundos por escena). transition: "cut" si cambia de golpe, "fade" si funde.
- zoom: true solo si en la referencia la cámara se acerca despacio. Si la referencia tiene la cámara fija, false.
- scale (1 a 2,5) y focusY (0 arriba, 0,5 centro, 1 abajo): encuadra cada foto para que el producto ocupe en pantalla lo mismo que en la referencia (si en la referencia el cuadro llena la pantalla, acércate). Mismo encuadre en todas si en la referencia la cámara no se mueve.
- Si hay menos fotos que escenas, repite fotos cambiando el encuadre; si hay más, elige las que más se parezcan a lo que se ve en la referencia.
- captions: los mismos textos sobreimpresos de la referencia, en los mismos segundos, traducidos al castellano de España y adaptados a nuestro producto; máximo 40 caracteres cada uno; mismos emojis. Nada de reseñas, cifras ni datos que no estén en la ficha.`;
  const user: any[] = [{ type: "text", text: `Producto: ${ficha.name} — ${ficha.sells}\nIdioma: ${ficha.language}\nDatos reales: ${ficha.notes || ""}\n\nReferencia (vídeo): ${ref.note}\nMúsica y audio: ${ref.audio || ""}${revise ? `\n\nComentarios para cambiar el vídeo (aplícalos todos): ${revise}` : ""}\n\nNuestras fotos (${photos.length}):` }];
  photos.forEach((u, i) => { user.push({ type: "text", text: `Foto ${i + 1}` }); user.push({ type: "image", source: { type: "url", url: u } }); });
  const j = json<VideoPlanAI>(await ask(sys, user, 2000));
  const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const scenes = (j.scenes || []).slice(0, 15).map((x) => ({ photo: photos[Math.round(num(x.photo, 1, photos.length, 1)) - 1], seconds: num(x.seconds, 0.5, 8, 2), zoom: !!x.zoom, scale: num(x.scale, 1, 2.5, 1), focusY: num(x.focusY, 0, 1, 0.5) }));
  const total = scenes.reduce((t, x) => t + x.seconds, 0);
  if (!scenes.length || total > 30) throw new Error("El guion del vídeo no es válido (sin escenas o más de 30 s).");
  const captions = (j.captions || []).map((c) => ({ text: String(c.text || "").trim().slice(0, 40), from: num(c.from, 0, total, 0), to: num(c.to, 0, total, total) })).filter((c) => c.text && c.to > c.from);
  return { transition: j.transition === "fade" ? "fade" as const : "cut" as const, scenes, captions };
}

export type GoogleExtras = {
  sitelinks: { text: string; desc1: string; desc2: string; url: string }[];
  callouts: string[];
  snippet: { header: string; values: string[] } | null;
  promotion: { percentOff: number; item: string; code?: string } | null;
  prices: { header: string; description: string; price: number; url: string }[];
};

// Recursos de los anuncios de búsqueda (enlaces de sitio, destacados, extracto, promoción y precios) con los datos reales de la ficha.
export async function writeGoogleExtras(ficha: { name: string; sells: string; language: string; currency: string; url: string; notes?: string | null }, pages: { name: string; url: string }[]): Promise<GoogleExtras> {
  const sys = `Preparas los recursos de una campaña de búsqueda de Google en el idioma indicado. Devuelves SOLO JSON:
{"sitelinks":[{"text","desc1","desc2","url"}],"callouts":[…],"snippet":{"header","values":[…]},"promotion":{"percentOff","item","code"}|null,"prices":[{"header","description","price","url"}]}
- sitelinks: 4-6 enlaces a las páginas más útiles de la lista (colecciones o temas); text ≤25 caracteres, desc1 y desc2 ≤35; url SOLO de la lista.
- callouts: 4-8 frases ≤25 caracteres con ventajas REALES de la ficha (envío, impresión, garantías…).
- snippet: header "Tipos" o "Estilos"; values 3-10 valores ≤25 caracteres.
- promotion: solo si la ficha tiene un descuento real: percentOff (número entero), item (≤20 caracteres, qué se descuenta), code (solo si la ficha da un código). Si no hay descuento real, null.
- prices: 3-8 productos o categorías con su precio REAL "desde" de la ficha; header ≤25, description ≤25, price número, url SOLO de la lista. Si la ficha no da precios, [].
No inventes datos, cifras, reseñas ni ofertas que no estén en la ficha.`;
  const user = `Negocio: ${ficha.name} — ${ficha.sells}\nIdioma: ${ficha.language}\nMoneda: ${ficha.currency}\nWeb: ${ficha.url}\nNotas y datos reales: ${ficha.notes || ""}\n\nPáginas (nombre | url):\n${pages.map((p) => `${p.name} | ${p.url}`).join("\n")}`;
  const j = json<GoogleExtras>(await ask(sys, user, 3000));
  const ok = new Set([...pages.map((p) => p.url), ficha.url]);
  const fit = (t: unknown, n: number) => { const x = String(t || "").trim(); return x.length <= n ? x : ""; };
  return {
    sitelinks: (j.sitelinks || []).map((x) => ({ text: fit(x.text, 25), desc1: fit(x.desc1, 35), desc2: fit(x.desc2, 35), url: x.url })).filter((x) => x.text && x.desc1 && x.desc2 && ok.has(x.url)).slice(0, 6),
    callouts: (j.callouts || []).map((x) => fit(x, 25)).filter((x) => x && allowedText(x)).slice(0, 8),
    snippet: j.snippet && ["Tipos", "Estilos"].includes(j.snippet.header) ? { header: j.snippet.header, values: (j.snippet.values || []).map((v) => fit(v, 25)).filter(Boolean).slice(0, 10) } : null,
    promotion: j.promotion && Number(j.promotion.percentOff) > 0 && Number(j.promotion.percentOff) < 100 && fit(j.promotion.item, 20) ? { percentOff: Math.round(Number(j.promotion.percentOff)), item: fit(j.promotion.item, 20), ...(j.promotion.code ? { code: String(j.promotion.code).trim().slice(0, 15) } : {}) } : null,
    prices: (j.prices || []).map((x) => ({ header: fit(x.header, 25), description: fit(x.description, 25), price: Number(x.price), url: x.url })).filter((x) => x.header && x.description && x.price > 0 && ok.has(x.url)).slice(0, 8),
  };
}
