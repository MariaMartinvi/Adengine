// Generación con el modelo: ficha desde URL, semillas, palabras y anuncios.
async function ask(system: string, user: string, maxTokens = 3000): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Modelo: ${JSON.stringify(j)}`);
  return j.content.map((c: any) => c.text || "").join("");
}
function json<T>(s: string): T {
  const clean = s.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(start, end + 1));
}

export type Ficha = {
  name: string; sells: string; audience: string; country: string; language: string; currency: string;
  price: number; marginPct: number; saleEvent: string; cacCap: number; maxCpc: number; dailyBudget: number; totalCap: number;
  seeds: string[]; notes: string;
};

export async function fichaFromSite(siteText: string): Promise<Ficha> {
  const sys = `Eres el analista de un motor de publicidad prudente. Lees el texto de una web y devuelves SOLO un JSON con la ficha del negocio. Sin texto fuera del JSON.
Campos: name, sells (qué vende, 1 frase), audience (a quién, 1 frase), country (ISO-2, el mercado principal que se deduce; si duda, "ES"), language (ISO-2), currency (ISO), price (precio de la venta que se debe optimizar: el primer pago real con tarjeta; en suscripción, el primer cobro, aunque sea una prueba de pago), marginPct (0-100, estimado por tipo de negocio: SaaS 80, servicios 60, ecommerce físico 35, POD 25, libros 20), saleEvent (nombre corto del evento de venta), cacCap (coste máximo por venta: para suscripciones estima margen de 3 meses × 0,5; para venta única precio × marginPct/100 × 0,5; redondea), maxCpc (techo por clic prudente para ese mercado, 0.3-1.2), dailyBudget (8-15), totalCap (250-400), seeds (8-12 búsquedas en el idioma del mercado que haría el cliente ANTES de contratar, en lenguaje de cliente, no de marketing; nada de términos genéricos caros como "agencia seo"), notes (2 frases: riesgos y palanca principal).`;
  return json<Ficha>(await ask(sys, siteText));
}

export type KeywordPick = { text: string; matchType: "EXACT" | "PHRASE"; intent: string };

export async function pickKeywords(ficha: { sells: string; audience: string; language: string; maxCpc: number }, ideas: { text: string; volume: number; cpcLow: number; cpcHigh: number }[]): Promise<{ keywords: KeywordPick[]; negatives: string[] }> {
  const sys = `Eres el planificador de un motor de anuncios en Google Búsqueda con estrategia de PRUDENCIA: pocas palabras, todas con intención de contratar/comprar, coste por clic bajo. Devuelves SOLO JSON: {"keywords":[{"text","matchType":"EXACT"|"PHRASE","intent"}],"negatives":[...]}.
Reglas: elige 25-45 palabras de la lista de ideas (solo textos que estén en la lista). Descarta informativas puras ("qué es", "gratis", "curso", "empleo", "definición"), marcas de terceros y todo lo que tenga cpcLow por encima de 1.3× el techo de CPC. Prioriza volumen ≥ 30 y cpcLow bajo. matchType EXACT para las de intención más clara, PHRASE para las de cola larga. intent: 5-8 palabras explicando por qué. negatives: 15-25 términos a excluir (gratis, empleo, curso, cómo hacer, plantilla, ejemplo, pdf, wikipedia, marcas competidoras que aparezcan, etc.) en el idioma del mercado.`;
  const user = `Negocio: ${ficha.sells}\nCliente: ${ficha.audience}\nIdioma: ${ficha.language}\nTecho CPC: ${ficha.maxCpc}\n\nIdeas (text | volume | cpcLow | cpcHigh):\n${ideas.slice(0, 300).map((i) => `${i.text} | ${i.volume} | ${i.cpcLow.toFixed(2)} | ${i.cpcHigh.toFixed(2)}`).join("\n")}`;
  return json(await ask(sys, user, 4000));
}

export async function writeAds(ficha: { name: string; sells: string; audience: string; language: string; price: number; saleEvent: string; url: string }, keywords: string[]): Promise<{ headlines: string[]; descriptions: string[] }[]> {
  const sys = `Escribes anuncios de búsqueda adaptables de Google en el idioma indicado. Devuelves SOLO JSON: {"ads":[{"headlines":[15 títulos ≤30 caracteres],"descriptions":[4 descripciones ≤90 caracteres]}]}. Genera 2 anuncios. Reglas: lenguaje de cliente, beneficio concreto, sin mayúsculas gritadas, sin exclamaciones dobles, sin promesas absolutas, sin "haz clic". Incluye el precio o la oferta de entrada cuando ayude. Cada título debe caber en 30 caracteres CONTADOS; cada descripción en 90. Varía: algunos títulos con la búsqueda del cliente, otros con la propuesta, otros con la prueba.`;
  const user = `Negocio: ${ficha.name} — ${ficha.sells}\nCliente: ${ficha.audience}\nIdioma: ${ficha.language}\nOferta de entrada: ${ficha.saleEvent} (${ficha.price})\nURL: ${ficha.url}\nBúsquedas objetivo: ${keywords.slice(0, 20).join(", ")}`;
  const j = json<{ ads: { headlines: string[]; descriptions: string[] }[] }>(await ask(sys, user, 3000));
  // Recorta por seguridad: Google rechaza el anuncio entero si un texto se pasa.
  return j.ads.map((a) => ({
    headlines: Array.from(new Set(a.headlines.map((h) => h.trim()).filter((h) => h.length <= 30 && h.length > 0))).slice(0, 15),
    descriptions: Array.from(new Set(a.descriptions.map((d) => d.trim()).filter((d) => d.length <= 90 && d.length > 0))).slice(0, 4),
  })).filter((a) => a.headlines.length >= 3 && a.descriptions.length >= 2);
}
