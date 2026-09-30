// Lee una web y devuelve texto plano razonable para que el modelo entienda el negocio.
export async function fetchSiteText(url: string): Promise<string> {
  const u = url.startsWith("http") ? url : `https://${url}`;
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 AdEngine/0.1" }, redirect: "follow" });
  const html = await r.text();
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "";
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&quot;|&#39;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `URL: ${u}\nTÍTULO: ${title}\nDESCRIPCIÓN: ${desc}\n\nTEXTO:\n${body.slice(0, 12000)}`;
}
