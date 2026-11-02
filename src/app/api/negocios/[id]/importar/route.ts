import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/engine";
export const maxDuration = 60;

// Importa las páginas de producto y de colección de la web del negocio desde su /sitemap.xml:
// nombre (og:title o <title>, sin el nombre de la tienda) e imagen (la del sitemap u og:image). No duplica las ya cargadas.
const SKIP = /\/(p|legal|carrito|cart|checkout|gracias|thanks|cuenta|account|login|admin|blog|faq|contacto|contact)(\/|$)|\/encuentra|\.(xml|txt|pdf)$/i;
const COLLECTION = /\/(coleccion|colecciones|collections?|categoria|category|tema)\//i;

const meta = (html: string, prop: string) => html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1];
const decode = (t: string) => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const b = await db.business.findUniqueOrThrow({ where: { id: params.id }, include: { products: true } });
    const origin = new URL(b.url).origin;
    const xml = await (await fetch(`${origin}/sitemap.xml`, { headers: { "User-Agent": "AdEngine" } })).text();
    const entries = Array.from(xml.matchAll(/<url>([\s\S]*?)<\/url>/g)).map((m) => ({
      url: m[1].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim() || "",
      image: m[1].match(/<image:loc>([^<]+)<\/image:loc>/)?.[1]?.trim(),
    }));
    const have = new Set(b.products.map((p) => p.url));
    const todo = entries.filter((e) => e.url.startsWith(origin) && new URL(e.url).pathname !== "/" && !SKIP.test(e.url) && !have.has(e.url)).slice(0, 150);
    if (!todo.length) return NextResponse.json({ ok: true, added: 0, message: entries.length ? "No hay páginas nuevas que importar." : "No se encontró /sitemap.xml con páginas." });

    const found: { name: string; url: string; image: string | null }[] = [];
    for (let i = 0; i < todo.length; i += 8) {
      await Promise.all(todo.slice(i, i + 8).map(async (e) => {
        try {
          const html = await (await fetch(e.url, { headers: { "User-Agent": "AdEngine" }, signal: AbortSignal.timeout(8000) })).text();
          const title = meta(html, "og:title") || html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
          let name = decode(title).split(/ [·|–—-] /)[0].trim() || decodeURIComponent(new URL(e.url).pathname.split("/").pop() || "");
          if (COLLECTION.test(e.url)) name = `Colección · ${name}`;
          const image = e.image || meta(html, "og:image") || null;
          found.push({ name: name.slice(0, 120), url: e.url, image: image && /^https?:\/\//.test(image) ? image : null });
        } catch { /* página que no responde: se salta */ }
      }));
    }
    if (found.length) await db.product.createMany({ data: found.map((f) => ({ businessId: b.id, ...f })) });
    await log(b.id, "IMPORTAR", `Importadas ${found.length} páginas de ${origin}/sitemap.xml.`);
    return NextResponse.json({ ok: true, added: found.length });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
