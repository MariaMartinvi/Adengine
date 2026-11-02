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

export type KeywordPick = { text: string; matchType: "EXACT" | "PHRASE"; intent: string };

export async function pickKeywords(ficha: { sells: string; audience: string; language: string; maxCpc: number }, ideas: { text: string; volume: number; cpcLow: number; cpcHigh: number }[]): Promise<{ keywords: KeywordPick[]; negatives: string[] }> {
  const sys = `Eres el planificador de un motor de anuncios en Google Búsqueda con estrategia de PRUDENCIA: pocas palabras, todas con intención de contratar/comprar, coste por clic bajo. Devuelves SOLO JSON: {"keywords":[{"text","matchType":"EXACT"|"PHRASE","intent"}],"negatives":[...]}.
Reglas: elige 25-45 palabras de la lista de ideas (solo textos que estén en la lista). Descarta informativas puras ("qué es", "gratis", "curso", "empleo", "definición"), marcas de terceros y todo lo que tenga cpcLow por encima de 1.3× el techo de CPC. Prioriza volumen ≥ 30 y cpcLow bajo. matchType EXACT para las de intención más clara, PHRASE para las de cola larga. intent: 5-8 palabras explicando por qué. negatives: 15-25 términos a excluir (gratis, empleo, curso, cómo hacer, plantilla, ejemplo, pdf, wikipedia, marcas competidoras que aparezcan, etc.) en el idioma del mercado.`;
  const user = `Negocio: ${ficha.sells}\nCliente: ${ficha.audience}\nIdioma: ${ficha.language}\nTecho CPC: ${ficha.maxCpc}\n\nIdeas (text | volume | cpcLow | cpcHigh):\n${ideas.slice(0, 300).map((i) => `${i.text} | ${i.volume} | ${i.cpcLow.toFixed(2)} | ${i.cpcHigh.toFixed(2)}`).join("\n")}`;
  return json(await ask(sys, user, 4000));
}

export async function writeAds(ficha: { name: string; sells: string; audience: string; language: string; price: number; saleEvent: string; url: string; notes?: string | null }, keywords: string[], refs: Ref[]): Promise<{ ref: number; headlines: string[]; descriptions: string[]; basedOn: string }[]> {
  const sys = `Escribes anuncios de búsqueda adaptables de Google en el idioma indicado. Devuelves SOLO JSON: {"ads":[{"ref":número de la referencia,"headlines":[15 títulos ≤30 caracteres],"descriptions":[4 descripciones ≤90 caracteres],"basedOn":"…"}]}. Un anuncio por referencia, en el mismo orden. En las referencias de Google, un título como «A - B» son dos títulos distintos que Google une: cálcalos como títulos separados, cada uno de 30 caracteres como máximo. ${COPY_RULE} Reglas: lenguaje de cliente, beneficio concreto, sin mayúsculas gritadas, sin exclamaciones dobles, sin promesas absolutas, sin "haz clic". Incluye el precio o la oferta de entrada cuando ayude. Cada título debe caber en 30 caracteres CONTADOS; cada descripción en 90. Varía: algunos títulos con la búsqueda del cliente, otros con la propuesta, otros con la prueba.`;
  const user = `Negocio: ${ficha.name} — ${ficha.sells}\nCliente: ${ficha.audience}\nIdioma: ${ficha.language}\nOferta de entrada: ${ficha.saleEvent} (${ficha.price})\nURL: ${ficha.url}\nNotas: ${ficha.notes || ""}\nBúsquedas objetivo: ${keywords.slice(0, 20).join(", ")}`;
  const j = json<{ ads: { ref?: number; headlines: string[]; descriptions: string[]; basedOn?: string }[] }>(await ask(sys, withRefs(user, refs), 8000));
  // Recorta por seguridad: Google rechaza el anuncio entero si un texto se pasa.
  return j.ads.map((a, i) => ({
    ref: Number(a.ref) || i + 1,
    headlines: Array.from(new Set(a.headlines.map((h) => h.trim()).filter((h) => h.length <= 30 && h.length > 0))).slice(0, 15),
    descriptions: Array.from(new Set(a.descriptions.map((d) => d.trim()).filter((d) => d.length <= 90 && d.length > 0))).slice(0, 4),
    basedOn: (a.basedOn || "").trim().slice(0, 160),
  })).filter((a) => a.headlines.length >= 3 && a.descriptions.length >= 2);
}

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
export async function writeMetaAdFromRef(ficha: { name: string; sells: string; audience: string; language: string; price: number; url: string; notes?: string | null }, ref: Ref): Promise<MetaAdCopy> {
  const sys = `Escribes un anuncio para Facebook e Instagram en el idioma indicado, calcando la referencia. Devuelves SOLO JSON: {"message","headline","description","basedOn","script"}.
- message (texto principal): máximo 300 caracteres. headline (titular bajo la imagen): máximo 40. description: máximo 30.
- script: si la referencia es un vídeo, guion para grabar el nuestro igual con nuestro cuadro: duración, plano a plano con segundos, texto sobreimpreso y música (la de la referencia). Si no es vídeo, "".
${COPY_RULE}`;
  const user = `Producto: ${ficha.name} — ${ficha.sells}\nPara quién: ${ficha.audience}\nIdioma: ${ficha.language}\nPrecio: desde ${ficha.price}\nWeb: ${ficha.url}\nNotas y datos reales: ${ficha.notes || ""}`;
  const j = json<MetaAdCopy>(await ask(sys, withRefs(user, [ref]), 2000));
  return { message: j.message.trim().slice(0, 300), headline: j.headline.trim().slice(0, 40), description: (j.description || "").trim().slice(0, 30), basedOn: (j.basedOn || "").trim().slice(0, 160), script: ref.video ? (j.script || "").trim() : "" };
}
