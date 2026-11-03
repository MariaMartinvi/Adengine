"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

type Metric = { date: string; cost: number; clicks: number; conversions: number; impressions: number; adId?: string };
type Keyword = { id: string; text: string; matchType: string; maxCpc: number; finalUrl?: string | null; adGroup?: string | null; estCpcLow?: number; estCpcHigh?: number; volume?: number; intent?: string; included: boolean; status: string; metrics: Metric[] };
type Proposal = { id: string; kind: string; reason: string; payload: any };
type Campaign = { id: string; name: string; status: string; channel: string; metaRtAdSetId?: string | null; extras?: any; dailyBudget: number; totalCap: number; googleCampaignId?: string; keywords: Keyword[]; ads: { id: string; status: string; headlines: string[]; descriptions: string[]; mediaType?: string; mediaUrl?: string; basedOn?: string; brief?: string | null; videoPlan?: unknown; finalUrl: string; adGroup?: string | null; path1?: string | null; path2?: string | null; included?: boolean }[]; metrics: Metric[]; proposals: Proposal[] };
type Business = { id: string; name: string; url: string; sells: string; audience: string; country: string; language: string; currency: string; price: number; marginPct: number; saleEvent: string; cacCap: number; maxCpc: number; dailyBudget: number; totalCap: number; googleCustomerId?: string; metaAdAccountId?: string; metaPixelId?: string; metaPageId?: string; metaAdvertiser?: string; metaInstagramId?: string | null; metaRtShare: number; googleWeekdaysOnly: boolean; ageMin: number; ageMax: number; metaCta: string; googlePath1?: string | null; googlePath2?: string | null; musicUrl?: string | null; notes?: string; campaigns: Campaign[]; references: Ref[]; products: Product[]; actions: { id: string; kind: string; detail: string; auto: boolean; createdAt: string }[]; sales: { id: string; amount: number; currency: string; channel?: string; createdAt: string }[] };

const money = (n: number, c: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
const sum = (m: Metric[], k: keyof Metric) => m.reduce((s, x) => s + Number(x[k] || 0), 0);

type Option = { id: string; name: string };
type Ref = { id: string; channel: string; note: string; image?: string | null; video: boolean; audio?: string | null; product?: string | null; productId?: string | null; createdAt: string };
type Product = { id: string; name: string; url: string; image?: string | null; photos: string[] };

// Reduce la captura en el navegador (≤1280 px, JPEG) para que quepa en la BD y en la llamada a la IA.
function shrink(file: File): Promise<string> {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src); ok(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => ko(new Error("No se pudo leer la imagen"));
    img.src = URL.createObjectURL(file);
  });
}
export default function BusinessPanel({ data, accounts, accountsError, metaAccounts = [], metaPixels = [] }: { data: Business; accounts: Option[]; accountsError?: string; metaAccounts?: Option[]; metaPixels?: Option[] }) {
  const r = useRouter();
  const [b, setB] = useState(data);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  // Una campaña por canal: propuesta (DRAFT) y campaña viva de Google y de Meta, independientes.
  const isMeta = (c: Campaign) => c.channel === "meta";
  const gDraft = data.campaigns.find((c) => c.status === "DRAFT" && !isMeta(c));
  const mDraft = data.campaigns.find((c) => c.status === "DRAFT" && isMeta(c));
  const stuck = data.campaigns.find((c) => c.status === "CREATING");
  // Las archivadas no cuentan: el canal vuelve a admitir una propuesta nueva.
  const isLive = (c: Campaign) => !["DRAFT", "ARCHIVED", "CREATING"].includes(c.status);
  const gLive = data.campaigns.find((c) => isLive(c) && !isMeta(c));
  const mLive = data.campaigns.find((c) => isLive(c) && isMeta(c));
  const [kws, setKws] = useState<Keyword[]>(gDraft?.keywords || []);
  const [budget, setBudget] = useState(gDraft?.dailyBudget ?? b.dailyBudget);
  const [cap, setCap] = useState(gDraft?.totalCap ?? b.totalCap);
  const [mBudget, setMBudget] = useState(mDraft?.dailyBudget ?? b.dailyBudget);
  const [mCap, setMCap] = useState(mDraft?.totalCap ?? b.totalCap);
  // Texto de cada anuncio de Meta propuesto (uno por referencia), editable antes de crear.
  const [mCopy, setMCopy] = useState<Record<string, { message: string; headline: string; description: string }>>(Object.fromEntries((mDraft?.ads || []).map((a) => [a.id, { message: a.descriptions[0] || "", headline: a.headlines[0] || "", description: a.descriptions[1] || "" }])));
  // Ruta visible de cada anuncio de Google (tienda.com/parte1/parte2), editable antes de crear.
  const [gPaths, setGPaths] = useState<Record<string, { path1: string; path2: string }>>(Object.fromEntries((gDraft?.ads || []).map((a) => [a.id, { path1: a.path1 || "", path2: a.path2 || "" }])));
  // Por anuncio de Meta: si se crea y los comentarios para rehacerlo.
  const [mInc, setMInc] = useState<Record<string, boolean>>(Object.fromEntries((mDraft?.ads || []).map((a) => [a.id, a.included !== false])));
  const [mFeedback, setMFeedback] = useState<Record<string, string>>({});
  const [prodForm, setProdForm] = useState({ name: "", url: "", image: "" });
  const [newCover, setNewCover] = useState("");
  const [adLinks, setAdLinks] = useState<Record<string, string>>({});
  const [refForm, setRefForm] = useState<Record<string, { note: string; image: string; video: boolean; audio: string; product: string }>>({});
  const refsOf = (ch: string) => data.references.filter((x) => x.channel === ch);
  // Una pestaña por canal; se abre la que ya tiene algo.
  const [tab, setTab] = useState<"meta" | "google">(mLive || mDraft || (!gLive && !gDraft && data.metaAdAccountId) ? "meta" : "google");
  const [liveEdit, setLiveEdit] = useState<Record<string, { d: number; t: number }>>({});
  const lb = (c: Campaign) => liveEdit[c.id] || { d: c.dailyBudget, t: c.totalCap };

  async function api(path: string, body?: unknown, method = "POST") {
    setErr("");
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || "Error"); return null; }
    return j;
  }
  // La música se guarda al subirla: aquí no se manda, para no pisarla con el valor viejo del formulario.
  async function saveFicha() { setBusy("ficha"); await api(`/api/negocios/${b.id}`, { ...b, musicUrl: undefined }, "PATCH"); setBusy(""); r.refresh(); }
  async function propose() { setBusy("proponer"); await api(`/api/negocios/${b.id}/proponer`); setBusy(""); r.refresh(); }
  async function proposeMeta() { setBusy("meta"); await api(`/api/negocios/${b.id}/proponer`, { channel: "meta" }); setBusy(""); r.refresh(); }
  async function importSite() { setBusy("importar"); const j = await api(`/api/negocios/${b.id}/importar`); setBusy(""); if (j) { if (j.message) setErr(j.message); r.refresh(); } }
  async function addProduct() { setBusy("producto"); const j = await api(`/api/negocios/${b.id}/productos`, prodForm); setBusy(""); if (j) { setProdForm({ name: "", url: "", image: "" }); r.refresh(); } }
  // Fotos del producto para los vídeos: se suben al almacén y se guardan en orden.
  async function addPhotos(p: Product, files: FileList) {
    setErr(""); setBusy(`fotos-${p.id}`);
    try {
      const urls = [];
      for (const f of Array.from(files)) urls.push((await upload(`productos/${f.name}`, f, { access: "public", handleUploadUrl: "/api/subidas" })).url);
      if (await api(`/api/productos/${p.id}`, { photos: [...p.photos, ...urls] }, "PATCH")) r.refresh();
    } catch (e: any) { setErr(e.message || "No se pudieron subir las fotos"); }
    setBusy("");
  }
  async function delPhoto(p: Product, url: string) { setBusy(`fotos-${p.id}`); await api(`/api/productos/${p.id}`, { photos: p.photos.filter((u) => u !== url) }, "PATCH"); setBusy(""); r.refresh(); }
  // Música de los vídeos del negocio (p. ej. bajada de la Sound Collection de Meta).
  async function uploadMusic(file: File) {
    setErr(""); setBusy("musica");
    try {
      const blob = await upload(`musica/${file.name}`, file, { access: "public", handleUploadUrl: "/api/subidas", multipart: file.size > 20 * 1024 * 1024 });
      if (await api(`/api/negocios/${b.id}`, { musicUrl: blob.url }, "PATCH")) {
        setBusy("");
        // Los vídeos ya montados de la propuesta se rehacen con la música nueva.
        for (const x of mDraft?.ads.filter((x) => x.videoPlan && x.mediaType === "video") || []) await mountVideo(x.id);
        r.refresh();
      }
    } catch (e: any) { setErr(e.message || "No se pudo subir la música"); }
    setBusy("");
  }
  async function delProduct(id: string) { setBusy("producto"); await api(`/api/productos/${id}`, undefined, "DELETE"); setBusy(""); r.refresh(); }
  async function setRefProduct(id: string, productId: string) { setBusy("ref"); await api(`/api/referencias/${id}`, { productId }, "PATCH"); setBusy(""); r.refresh(); }
  async function addCover() { setBusy("portada"); const j = await api(`/api/campanas/${mLive!.id}/anuncios`, { imageUrl: newCover }); setBusy(""); if (j) { setNewCover(""); r.refresh(); } }
  async function approve(d: Campaign) {
    setBusy("aprobar");
    const body = isMeta(d)
      ? { campaignId: d.id, dailyBudget: mBudget, totalCap: mCap, ads: d.ads.map((a) => ({ id: a.id, ...mCopy[a.id], included: mInc[a.id] !== false })), keywords: [] }
      : { campaignId: d.id, dailyBudget: budget, totalCap: cap, keywords: kws.map((k) => ({ id: k.id, maxCpc: k.maxCpc, included: k.included, matchType: k.matchType, finalUrl: k.finalUrl || null })), ads: d.ads.map((a) => ({ id: a.id, ...gPaths[a.id] })) };
    const j = await api(`/api/negocios/${b.id}/aprobar`, body);
    setBusy(""); if (j) r.refresh();
  }
  async function status(c: Campaign, s: string) { setBusy(s); await api(`/api/campanas/${c.id}/estado`, { status: s }); setBusy(""); r.refresh(); }
  async function remove() {
    if (!confirm(`¿Borrar la ficha "${b.name}"? Se borran también sus campañas, ventas e historial en AdEngine.`)) return;
    setBusy("borrar"); const j = await api(`/api/negocios/${b.id}`, undefined, "DELETE"); setBusy("");
    if (j) { r.push("/"); r.refresh(); } else window.scrollTo(0, 0);
  }
  async function saveBudget(c: Campaign) { setBusy("presupuesto"); const j = await api(`/api/campanas/${c.id}/presupuesto`, { dailyBudget: lb(c).d, totalCap: lb(c).t }); setBusy(""); if (j) r.refresh(); }
  async function applyAudience(c: Campaign) { setBusy("publico"); await api(`/api/campanas/${c.id}/publico`); setBusy(""); r.refresh(); }
  async function addRef(ch: string) {
    const f = refForm[ch];
    setBusy("ref"); const j = await api(`/api/negocios/${b.id}/referencias`, { channel: ch, note: f.note, image: f.image, video: f.video, audio: f.audio, productId: f.product || null }); setBusy("");
    if (j) { setRefForm({ ...refForm, [ch]: { note: "", image: "", video: false, audio: "", product: "" } }); r.refresh(); }
  }
  async function delRef(id: string) { setBusy("ref"); await api(`/api/referencias/${id}`, undefined, "DELETE"); setBusy(""); r.refresh(); }
  async function rebuild(c: Campaign) { setBusy("rehacer"); const j = await api(`/api/campanas/${c.id}/rehacer`, { links: adLinks }); setBusy(""); if (j) { setAdLinks({}); r.refresh(); } }
  async function archive(c: Campaign) {
    if (!confirm(`¿Archivar «${c.name}»? Queda en pausa en ${isMeta(c) ? "Meta" : "Google"} con su historial y podrás proponer una nueva.`)) return;
    setBusy("archivar"); await api(`/api/campanas/${c.id}/archivar`); setBusy(""); r.refresh();
  }
  // Sube un vídeo o una imagen propia al almacén y la pone en ese anuncio de la propuesta de Meta.
  async function replaceMedia(adId: string, file: File) {
    setErr(""); setBusy(`medio-${adId}`);
    try {
      const blob = await upload(`anuncios/${file.name}`, file, { access: "public", handleUploadUrl: "/api/subidas", multipart: file.size > 20 * 1024 * 1024 });
      const j = await api(`/api/anuncios/${adId}/medio`, { url: blob.url, kind: file.type.startsWith("video/") ? "video" : "image" });
      if (j) r.refresh();
    } catch (e: any) { setErr(e.message || "No se pudo subir el archivo"); }
    setBusy("");
  }
  // Vídeos de la propuesta: se montan solos, uno a uno, al abrir la propuesta (cada uno tarda medio minuto o más).
  const [vBusy, setVBusy] = useState("");
  const tried = useRef(new Set<string>());
  async function mountVideo(adId: string, feedback?: string) {
    setErr(""); setVBusy(adId);
    const j = await api(`/api/anuncios/${adId}/video`, feedback ? { feedback } : {});
    setVBusy("");
    if (j) { if (feedback) setMFeedback((f) => ({ ...f, [adId]: "" })); r.refresh(); }
  }
  useEffect(() => {
    if (vBusy || mLive) return;
    const next = mDraft?.ads.find((a) => a.videoPlan && a.mediaType !== "video" && !tried.current.has(a.id));
    if (next) { tried.current.add(next.id); mountVideo(next.id); }
  });
  async function unlock(c: Campaign) {
    if (!confirm(`«${c.name}» se quedó a medias al crearse. ¿Volver a dejarla como propuesta? Mira antes en ${isMeta(c) ? "Meta" : "Google"} si quedó una campaña en pausa con ese nombre y archívala allí.`)) return;
    setBusy("desbloquear"); await api(`/api/campanas/${c.id}/desbloquear`); setBusy(""); r.refresh();
  }
  async function adStatus(adId: string, status: "ENABLED" | "PAUSED") { setBusy(`estado-${adId}`); await api(`/api/anuncios/${adId}/estado`, { status }); setBusy(""); r.refresh(); }
  async function rewrite(adId: string) {
    setBusy(`rehacer-${adId}`);
    const j = await api(`/api/anuncios/${adId}/reescribir`, { feedback: mFeedback[adId] || "" });
    setBusy("");
    if (j) { setMCopy({ ...mCopy, [adId]: { message: j.message, headline: j.headline, description: j.description } }); setMFeedback({ ...mFeedback, [adId]: "" }); r.refresh(); }
  }
  async function extras(c: Campaign) { setBusy("recursos"); await api(`/api/campanas/${c.id}/recursos`); setBusy(""); r.refresh(); }
  async function photos(c: Campaign) { setBusy("fotos"); await api(`/api/campanas/${c.id}/fotos`); setBusy(""); r.refresh(); }
  async function schedule(c: Campaign) { setBusy("horario"); await api(`/api/campanas/${c.id}/horario`); setBusy(""); r.refresh(); }
  async function addRt(c: Campaign) { setBusy("remarketing"); await api(`/api/campanas/${c.id}/remarketing`); setBusy(""); r.refresh(); }
  async function discard(c: Campaign) {
    if (!confirm("¿Descartar esta propuesta? No existe aún en Meta ni en Google; se borra de AdEngine.")) return;
    setBusy("descartar"); await api(`/api/campanas/${c.id}`, undefined, "DELETE"); setBusy(""); r.refresh();
  }
  async function decide(id: string, decision: string) { setBusy(id); await api(`/api/propuestas/${id}`, { decision }); setBusy(""); r.refresh(); }

  const inc = kws.filter((k) => k.included);
  const overCap = inc.filter((k) => k.maxCpc > b.maxCpc).length;
  const estDailyClicks = useMemo(() => inc.length ? budget / (inc.reduce((s, k) => s + k.maxCpc, 0) / inc.length) : 0, [inc, budget]);
  const set = (k: keyof Business, v: any) => setB({ ...b, [k]: v });

  const renderRefs = (ch: "meta" | "google") => {
    const f = refForm[ch] || { note: "", image: "", video: false, audio: "", product: "" };
    const list = refsOf(ch);
    return (
      <details className="card" style={{ margin: "16px 0" }} open={!list.length}>
        <summary style={{ cursor: "pointer" }}><strong style={{ fontWeight: 500 }}>Referencias que funcionan en {ch === "meta" ? "Meta" : "Google"}</strong> <span className="small">· {list.length}{list.some((x) => x.video) ? ` (${list.filter((x) => x.video).length} en vídeo)` : ""} · pulsa para abrir</span></summary>
        <p className="small">Antes de generar, copiamos lo que funciona: la IA replica la estructura de estos anuncios (gancho, formato, oferta, botón) con los datos de este negocio. Nunca calca frases, imágenes ni cifras ajenas. Vídeos: sube una captura y describe en la nota qué pasa.</p>
        {list.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", margin: "10px 0" }}>
            {list.map((x, i) => (
              <div key={x.id} className="card" style={{ padding: 10 }}>
                <div className="small">Referencia {list.length - i}</div>
                {x.image && <img src={x.image} alt="" style={{ width: "100%", marginTop: 6 }} />}
                {x.note && (x.note.length > 180
                  ? <details style={{ margin: "6px 0" }}><summary className="small" style={{ cursor: "pointer" }}>{x.note.slice(0, 180)}… <u>ver todo</u></summary><p className="small" style={{ whiteSpace: "pre-wrap" }}>{x.note}</p></details>
                  : <p className="small" style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{x.note}</p>)}
                {x.video && <p className="small" style={{ margin: "6px 0" }}>Vídeo · música y audio: {x.audio}</p>}
                <label className="field" style={{ margin: "6px 0" }}>Nuestro cuadro
                  <select value={x.productId || ""} onChange={(e) => setRefProduct(x.id, e.target.value)} disabled={!!busy}>
                    <option value="">{x.product ? `Sin elegir (antes: ${x.product.split(" · ")[0]})` : "Sin elegir"}</option>
                    {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <button className="btn-secondary" onClick={() => delRef(x.id)} disabled={!!busy}>Quitar</button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <label className="field">Nota (texto del anuncio, enlace, cuánto lleva activo…)<textarea rows={3} value={f.note} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, note: e.target.value } })} style={{ width: 340 }} /></label>
          <label className="field">Captura (opcional)<input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setRefForm({ ...refForm, [ch]: { ...f, image: await shrink(file) } }); }} /></label>
          {f.image && <img src={f.image} alt="" style={{ width: 80, alignSelf: "end" }} />}
          <label className="field">Nuestro cuadro para este anuncio
            <select value={f.product} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, product: e.target.value } })}>
              <option value="">Elegir…</option>
              {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="row small" style={{ alignSelf: "end" }}><input type="checkbox" checked={f.video} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, video: e.target.checked } })} /> Es un vídeo</label>
          {f.video && <label className="field">Música y audio (la IA no oye el vídeo: estilo, instrumentos, si hay voz y qué dice)<input value={f.audio} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, audio: e.target.value } })} placeholder="Clásica relajada, cuerda + piano, sin voz" style={{ width: 340 }} /></label>}
          <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => addRef(ch)} disabled={!!busy || (!f.note.trim() && !f.image) || (f.video && !f.audio.trim())}>{busy === "ref" ? "Guardando…" : "Añadir referencia"}</button>
        </div>
      </details>
    );
  };

  const renderLive = (live: Campaign) => (
        <div key={live.id}>
          <h2>Campaña · {live.name} <span className={`status ${live.status}`}>{({ ENABLED: "activa", PAUSED: "en pausa", STOPPED: "detenida" } as any)[live.status]}</span></h2>
          <div className="row" style={{ marginBottom: 14 }}>
            {live.status !== "ENABLED" && <button className="btn-ok" onClick={() => status(live, "ENABLED")} disabled={!!busy}>Activar</button>}
            {live.status !== "ENABLED" && <button className="btn-secondary" onClick={() => archive(live)} disabled={!!busy}>{busy === "archivar" ? "Archivando…" : "Archivar campaña"}</button>}
            {live.status === "ENABLED" && <button className="btn-secondary" onClick={() => status(live, "PAUSED")} disabled={!!busy}>Pausar</button>}
            <span className="small">{money(live.dailyBudget, b.currency)}/día · tope {money(live.totalCap, b.currency)} · gastado {money(sum(live.metrics, "cost"), b.currency)} · {sum(live.metrics, "conversions")} ventas</span>
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <label className="field">{live.channel === "meta" ? "€/día (aprox.)" : "€/día"}<input type="number" step="1" value={lb(live).d} onChange={(e) => setLiveEdit({ ...liveEdit, [live.id]: { ...lb(live), d: +e.target.value } })} style={{ width: 100 }} /></label>
            <label className="field">Tope total<input type="number" step="10" value={lb(live).t} onChange={(e) => setLiveEdit({ ...liveEdit, [live.id]: { ...lb(live), t: +e.target.value } })} style={{ width: 100 }} /></label>
            <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => saveBudget(live)} disabled={!!busy || !(lb(live).d > 0) || !(lb(live).t >= lb(live).d)}>{busy === "presupuesto" ? "Guardando…" : "Guardar presupuesto"}</button>
            <span className="small" style={{ alignSelf: "end" }}>Presupuesto de esta campaña (el de la ficha es para las propuestas nuevas).</span>
          </div>
          {live.proposals.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h3>Propuestas pendientes</h3>
              <p className="small">La herramienta las sugiere con datos de los últimos 14 días. Nada se aplica sin tu aprobación.</p>
              {live.proposals.map((p) => (
                <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <span>{p.reason}</span>
                  <span className="row">
                    <button className="btn-secondary" onClick={() => decide(p.id, "DISMISSED")} disabled={!!busy}>Descartar</button>
                    <button onClick={() => decide(p.id, "APPROVED")} disabled={!!busy}>Aplicar</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Ajustes que se usan poco: pasar a la campaña creada lo cambiado en la ficha, añadir piezas… */}
          <details className="card" style={{ marginBottom: 14 }}>
          <summary style={{ cursor: "pointer" }}><strong style={{ fontWeight: 500 }}>Más ajustes de la campaña</strong> <span className="small">· aplicar cambios de la ficha, añadir {live.channel === "meta" ? "portadas, remarketing" : "recursos, fotos"}… · pulsa para abrir</span></summary>
          <p className="small">Lo que cambias en la ficha (público, horario…) solo vale para las propuestas nuevas; estos botones lo pasan a esta campaña ya creada.</p>
          <div className="row" style={{ marginBottom: 12 }}>
            {live.channel !== "meta" && <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => extras(live)} disabled={!!busy}>{busy === "recursos" ? "Añadiendo recursos…" : "Añadir recursos (enlaces, destacados, promoción…)"}</button>}
            {live.channel !== "meta" && <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => photos(live)} disabled={!!busy}>{busy === "fotos" ? "Subiendo fotos…" : "Añadir fotos"}</button>}
            {live.channel !== "meta" && <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => schedule(live)} disabled={!!busy}>{busy === "horario" ? "Aplicando…" : `Aplicar horario de la ficha (${data.googleWeekdaysOnly ? "laborables 8-20" : "todos los días"})`}</button>}
            {live.channel === "meta" && !live.metaRtAdSetId && data.metaRtShare > 0 && <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => addRt(live)} disabled={!!busy}>{busy === "remarketing" ? "Creando remarketing…" : `Añadir remarketing (${data.metaRtShare} %)`}</button>}
            {live.channel === "meta" && <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => applyAudience(live)} disabled={!!busy}>{busy === "publico" ? "Aplicando…" : `Aplicar público de la ficha (${data.country}, ${data.ageMin}–${data.ageMax} años)`}</button>}
          </div>
          {live.channel === "meta" && (
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="field">Añadir un anuncio de imagen (URL de la imagen)<input value={newCover} onChange={(e) => setNewCover(e.target.value.trim())} placeholder="https://…/portada-2.jpg" style={{ width: 340 }} /></label>
              <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={addCover} disabled={!!busy || !newCover}>{busy === "portada" ? "Subiendo a Meta…" : "Añadir portada"}</button>
              <span className="small" style={{ alignSelf: "end" }}>Mismos textos y mismo presupuesto; Meta reparte entre todas.</span>
            </div>
          )}
          {live.channel === "meta" && (
            <details className="card" style={{ marginBottom: 12 }}>
              <summary style={{ cursor: "pointer" }}><strong style={{ fontWeight: 500 }}>Cambiar botón o enlaces de los anuncios</strong> <span className="small">· solo si hace falta · pulsa para abrir</span></summary>
              <p className="small">En Meta el botón no se edita: «Rehacer» crea anuncios nuevos con el botón de la ficha ({({ SHOP_NOW: "Comprar", LEARN_MORE: "Más información", SIGN_UP: "Registrarte" } as any)[data.metaCta]}) y estos enlaces, y deja los anteriores en pausa con su historial.</p>
              {live.ads.filter((a) => a.status === "ENABLED").map((a, i) => (
                <label key={a.id} className="field" style={{ marginTop: 8 }}>Anuncio {i + 1} · {a.mediaType === "video" ? "vídeo" : "imagen"}
                  <input value={adLinks[a.id] ?? a.finalUrl} onChange={(e) => setAdLinks({ ...adLinks, [a.id]: e.target.value.trim() })} />
                </label>
              ))}
              <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => rebuild(live)} disabled={!!busy}>{busy === "rehacer" ? "Rehaciendo en Meta…" : "Rehacer anuncios"}</button>
            </details>
          )}
          </details>
          {live.channel === "meta" && (
            <div className="tablewrap">
              <table>
                <thead><tr><th>Anuncio</th><th>Estado</th><th className="num">Impr.</th><th className="num">Clics</th><th className="num">Gasto</th><th className="num">Clics a compra</th><th className="num">Coste/clic a compra</th></tr></thead>
                <tbody>
                  {live.ads.map((a) => {
                    const m = live.metrics.filter((x) => x.adId === a.id);
                    const cost = sum(m, "cost"), conv = sum(m, "conversions");
                    const cpa = conv ? cost / conv : null;
                    return (
                      <tr key={a.id} style={{ opacity: a.status === "PAUSED" ? .5 : 1 }}>
                        <td><a href={a.mediaUrl} target="_blank" rel="noreferrer">{a.mediaType === "video" ? "Vídeo" : "Imagen"} {live.ads.filter((x) => x.mediaType === a.mediaType).indexOf(a) + 1}</a>{a.headlines[0] ? <div className="small">{a.headlines[0]}</div> : null}</td>
                        <td><span className={`status ${a.status}`}>{a.status === "ENABLED" ? "activo" : "pausado"}</span>{" "}
                          <button className="btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => adStatus(a.id, a.status === "ENABLED" ? "PAUSED" : "ENABLED")} disabled={!!busy}>{busy === `estado-${a.id}` ? "…" : a.status === "ENABLED" ? "Pausar" : "Reactivar"}</button></td>
                        <td className="num">{sum(m, "impressions")}</td>
                        <td className="num">{sum(m, "clicks")}</td>
                        <td className="num">{cost.toFixed(2)}</td>
                        <td className="num">{conv}</td>
                        <td className={`num ${cpa != null && cpa > b.cacCap ? "over" : ""}`}>{cpa != null ? cpa.toFixed(2) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!live.metrics.length && <p className="small">Sin datos todavía · se actualiza cada mañana.</p>}
            </div>
          )}
          {live.channel !== "meta" && <div className="tablewrap">
            <table>
              <thead><tr><th>Palabra</th><th>Estado</th><th className="num">CPC máx.</th><th className="num">Impr.</th><th className="num">Clics</th><th className="num">CPC real</th><th className="num">Gasto</th><th className="num">Ventas</th><th className="num">Coste/venta</th></tr></thead>
              <tbody>
                {live.keywords.map((k) => {
                  const cost = sum(k.metrics, "cost"), clicks = sum(k.metrics, "clicks"), conv = sum(k.metrics, "conversions");
                  const cac = conv ? cost / conv : null;
                  return (
                    <tr key={k.id} style={{ opacity: k.status === "PAUSED" ? .5 : 1 }}>
                      <td>{k.text} <span className="small">{k.matchType === "EXACT" ? "[exacta]" : "\"frase\""}</span></td>
                      <td><span className={`status ${k.status}`}>{k.status === "ENABLED" ? "activa" : "pausada"}</span></td>
                      <td className="num">{k.maxCpc.toFixed(2)}</td>
                      <td className="num">{sum(k.metrics, "impressions")}</td>
                      <td className="num">{clicks}</td>
                      <td className="num">{clicks ? (cost / clicks).toFixed(2) : "—"}</td>
                      <td className="num">{cost.toFixed(2)}</td>
                      <td className="num">{conv}</td>
                      <td className={`num ${cac != null && cac > b.cacCap ? "over" : ""}`}>{cac != null ? cac.toFixed(2) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
        </div>
  );

  return (
    <main>
      <h1>{b.name}</h1>
      <div className="small"><a href={b.url} target="_blank" rel="noreferrer">{b.url}</a></div>
      {err && <div className="notice error" style={{ marginTop: 16 }}>{err}</div>}
      {stuck && <div className="notice error" style={{ marginTop: 16 }}>«{stuck.name}» se quedó a medias al crearse en {isMeta(stuck) ? "Meta" : "Google"} y AdEngine no la controla. <button className="btn-secondary" onClick={() => unlock(stuck)} disabled={!!busy}>Volver a propuesta</button></div>}

      {/* Abierta mientras el negocio no tiene campañas; luego, cerrada para que se vea lo que está en marcha. */}
      <details className="card" style={{ marginTop: 16 }} open={!data.campaigns.length}>
      <summary style={{ cursor: "pointer" }}><strong style={{ fontWeight: 500 }}>Ficha</strong> <span className="small">· {b.dailyBudget} {b.currency}/día · tope {b.totalCap} · pulsa para abrir</span></summary>
      <p className="muted">Es la única entrada del motor. Los cuatro topes de abajo son tu freno de mano: la herramienta nunca los supera.</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        <label className="field">Qué vende<input value={b.sells} onChange={(e) => set("sells", e.target.value)} /></label>
        <label className="field">A quién<input value={b.audience} onChange={(e) => set("audience", e.target.value)} /></label>
        <label className="field">País<input value={b.country} onChange={(e) => set("country", e.target.value.toUpperCase())} maxLength={2} /></label>
        <label className="field">Idioma<input value={b.language} onChange={(e) => set("language", e.target.value.toLowerCase())} maxLength={2} /></label>
        <label className="field">Venta que optimizamos<input value={b.saleEvent} onChange={(e) => set("saleEvent", e.target.value)} /></label>
        <label className="field">Precio de esa venta<input type="number" step="0.01" value={b.price} onChange={(e) => set("price", +e.target.value)} /></label>
        <label className="field">CAC tope (coste máx. por venta)<input type="number" step="1" value={b.cacCap} onChange={(e) => set("cacCap", +e.target.value)} /></label>
        <label className="field">CPC máximo (techo por clic)<input type="number" step="0.05" value={b.maxCpc} onChange={(e) => set("maxCpc", +e.target.value)} /></label>
        <label className="field">Presupuesto diario<input type="number" step="1" value={b.dailyBudget} onChange={(e) => set("dailyBudget", +e.target.value)} /></label>
        <label className="field">Gasto total máximo<input type="number" step="10" value={b.totalCap} onChange={(e) => set("totalCap", +e.target.value)} /></label>
        <label className="field">Cuenta de Google Ads
          {accounts.length ? (
            <select value={b.googleCustomerId || ""} onChange={(e) => set("googleCustomerId", e.target.value)}>
              <option value="">Elegir…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
            </select>
          ) : <input value={b.googleCustomerId || ""} onChange={(e) => set("googleCustomerId", e.target.value)} placeholder="9148745988" />}
          {accountsError && <span className="small" style={{ color: "#b45309" }}>No se pudo leer la lista de cuentas: {accountsError}</span>}
        </label>
        {b.googleCustomerId && <label className="row small" style={{ gap: 6, alignSelf: "end" }}><input type="checkbox" checked={b.googleWeekdaysOnly} onChange={(e) => set("googleWeekdaysOnly", e.target.checked)} /> Google: solo laborables de 8 a 20 h (B2B)</label>}
        {b.googleCustomerId && <label className="field">Ruta del enlace en Google (texto visible, 15 car. por parte)
          <span className="row" style={{ gap: 4 }}>/<input value={b.googlePath1 || ""} maxLength={15} onChange={(e) => set("googlePath1", e.target.value)} placeholder="comprar" style={{ width: 110 }} />/<input value={b.googlePath2 || ""} maxLength={15} onChange={(e) => set("googlePath2", e.target.value)} placeholder="cuadros" style={{ width: 110 }} /></span>
        </label>}
        <label className="field">Cuenta de Meta
          {metaAccounts.length ? (
            <select value={b.metaAdAccountId || ""} onChange={(e) => setB({ ...b, metaAdAccountId: e.target.value, metaPixelId: "" })}>
              <option value="">Sin Meta</option>
              {metaAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}
            </select>
          ) : <input value={b.metaAdAccountId || ""} onChange={(e) => set("metaAdAccountId", e.target.value)} placeholder="2190420808485726" />}
        </label>
        <label className="field">Píxel de Meta
          {metaPixels.length && b.metaAdAccountId === data.metaAdAccountId ? (
            <select value={b.metaPixelId || ""} onChange={(e) => set("metaPixelId", e.target.value)}>
              <option value="">Elegir…</option>
              {metaPixels.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}
            </select>
          ) : <input value={b.metaPixelId || ""} onChange={(e) => set("metaPixelId", e.target.value)} placeholder={b.metaAdAccountId ? "Guarda la ficha para elegirlo" : "1431144915623956"} />}
        </label>
        {b.metaAdAccountId && <label className="field">Página de Facebook (id de Meta Business, no el del enlace)<input value={b.metaPageId || ""} onChange={(e) => set("metaPageId", e.target.value.trim())} placeholder="1254151691124601" /></label>}
        {b.metaAdAccountId && <label className="field">Anunciante (aviso UE)<input value={b.metaAdvertiser || ""} onChange={(e) => set("metaAdvertiser", e.target.value)} placeholder="Quién se anuncia y paga" /></label>}
        {b.metaAdAccountId && <label className="field">Instagram (identificador; Configuración del negocio → Cuentas de Instagram)<input value={b.metaInstagramId || ""} onChange={(e) => set("metaInstagramId", e.target.value.replace(/\D/g, ""))} placeholder="17841…" /></label>}
        {b.metaAdAccountId && <label className="field">Remarketing en Meta (% del tope; 0 = sin remarketing)<input type="number" min={0} max={50} step={5} value={b.metaRtShare} onChange={(e) => set("metaRtShare", Math.round(+e.target.value))} /></label>}
        {b.metaAdAccountId && <label className="field">Botón de los anuncios (Meta)
          <select value={b.metaCta} onChange={(e) => set("metaCta", e.target.value)}>
            <option value="SHOP_NOW">Comprar</option>
            <option value="LEARN_MORE">Más información</option>
            <option value="SIGN_UP">Registrarte</option>
          </select>
        </label>}
        {b.metaAdAccountId && <label className="field">Música de los vídeos (Meta)
          {data.musicUrl ? <audio controls src={data.musicUrl} style={{ width: "100%" }} /> : <span className="small" style={{ color: "#b45309" }}>Sin música: los vídeos saldrán en silencio</span>}
          <input type="file" accept="audio/*,video/mp4" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMusic(f); e.target.value = ""; }} />
          {busy === "musica" && <span className="small">Subiendo…</span>}
        </label>}
        {b.metaAdAccountId && <label className="field">Edad mínima (Meta)<input type="number" min={18} max={65} value={b.ageMin} onChange={(e) => set("ageMin", +e.target.value)} /></label>}
        {b.metaAdAccountId && <label className="field">Edad máxima (Meta)<input type="number" min={18} max={65} value={b.ageMax} onChange={(e) => set("ageMax", +e.target.value)} /></label>}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={saveFicha} disabled={!!busy}>{busy === "ficha" ? "Guardando…" : "Guardar ficha"}</button>
      </div>
      {b.notes && <p className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{b.notes}</p>}
      </details>

      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer" }}><strong style={{ fontWeight: 500 }}>Nuestros productos y páginas</strong> <span className="small">· {data.products.length} · pulsa para abrir</span></summary>
        <p className="small">Con ellos se hacen los anuncios: cada referencia elige su producto y el anuncio lleva su imagen y su enlace. Las colecciones sirven de página de destino para las palabras de Google.</p>
        <button className="btn-secondary" onClick={importSite} disabled={!!busy}>{busy === "importar" ? "Leyendo la web…" : "Importar desde la web"}</button>
        <span className="small" style={{ marginLeft: 8 }}>Lee el mapa del sitio ({b.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}/sitemap.xml) y añade las páginas de producto y colección que falten.</span>
        {data.products.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", margin: "10px 0" }}>
            {data.products.map((p) => (
              <div key={p.id} className="card" style={{ padding: 8 }}>
                {p.image && <img src={p.image} alt="" style={{ width: "100%" }} />}
                <div className="small" style={{ margin: "4px 0" }}><a href={p.url} target="_blank" rel="noreferrer">{p.name}</a></div>
                {p.photos.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                    {p.photos.map((u) => (
                      <span key={u} style={{ position: "relative" }}>
                        <img src={u} alt="" style={{ width: 40, height: 40, objectFit: "cover" }} />
                        <button onClick={() => delPhoto(p, u)} disabled={!!busy} title="Quitar foto" style={{ position: "absolute", top: -6, right: -6, padding: "0 5px", fontSize: 11 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <label className="small" style={{ display: "block", marginBottom: 4, cursor: "pointer" }}>
                  {busy === `fotos-${p.id}` ? "Subiendo fotos…" : `Fotos para vídeo (${p.photos.length}) · añadir`}
                  <input type="file" accept="image/*" multiple style={{ display: "none" }} disabled={!!busy} onChange={(e) => { if (e.target.files?.length) addPhotos(p, e.target.files); e.target.value = ""; }} />
                </label>
                <button className="btn-secondary" onClick={() => delProduct(p.id)} disabled={!!busy}>Quitar</button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <label className="field">Nombre<input value={prodForm.name} onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })} placeholder="La oveja que faltaba" /></label>
          <label className="field">Enlace<input value={prodForm.url} onChange={(e) => setProdForm({ ...prodForm, url: e.target.value.trim() })} placeholder="https://…/cuadro/…" /></label>
          <label className="field">Imagen (enlace)<input value={prodForm.image} onChange={(e) => setProdForm({ ...prodForm, image: e.target.value.trim() })} placeholder="https://…/foto.jpg" /></label>
          <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={addProduct} disabled={!!busy || !prodForm.name || !prodForm.url}>{busy === "producto" ? "Guardando…" : "Añadir producto"}</button>
        </div>
      </details>

      <div className="tabs" role="tablist">
        {(["meta", "google"] as const).map((t) => {
          const live = t === "meta" ? mLive : gLive, draft = t === "meta" ? mDraft : gDraft;
          return (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {t === "meta" ? "Meta" : "Google"}
              <span className={`status ${live?.status || ""}`}>{live ? ({ ENABLED: "activa", PAUSED: "en pausa", STOPPED: "detenida" } as any)[live.status] : draft ? "propuesta" : "sin campaña"}</span>
            </button>
          );
        })}
      </div>

      {tab === "meta" && (
        <>
          {!b.metaAdAccountId && <p className="muted">Elige una cuenta de Meta en la ficha y guárdala para poder proponer.</p>}
          {renderRefs("meta")}
      {!mLive && b.metaAdAccountId && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn-secondary" onClick={proposeMeta} disabled={!!busy || !refsOf("meta").length || refsOf("meta").some((x) => !x.productId)}>{busy === "meta" ? "Calcando referencias y subiendo a Meta…" : mDraft ? "Volver a proponer (Meta)" : "Proponer campaña en Meta"}</button>
          <span className="small">Un anuncio por referencia, con la imagen y el enlace de su cuadro.{refsOf("meta").some((x) => !x.productId) ? " Falta elegir «Nuestro cuadro» en alguna referencia." : ""}</span>
        </div>
      )}
      {mDraft && !mLive && (
        <>
          <h2>Propuesta Meta · revisa y aprueba</h2>
          <p className="muted">Nada existe en Meta hasta que pulses «Crear en pausa». Público: {b.country}, {data.ageMin}–{data.ageMax} años. Optimiza hacia el clic de compra del píxel. El gasto total es un tope que Meta respeta sola.</p>
          <div className="row" style={{ margin: "10px 0 16px" }}>
            <label className="field">Presupuesto diario (aprox.)<input type="number" step="1" value={mBudget} onChange={(e) => setMBudget(+e.target.value)} style={{ width: 120 }} /></label>
            <label className="field">Gasto total máximo<input type="number" step="10" value={mCap} onChange={(e) => setMCap(+e.target.value)} style={{ width: 120 }} /></label>
            <div className="small" style={{ alignSelf: "end" }}>~{mBudget > 0 ? Math.ceil(mCap / mBudget) : 0} días de campaña</div>
          </div>
          {mDraft.ads.some((a) => a.videoPlan) && !data.musicUrl && <p className="small" style={{ color: "#b45309" }}>Sin música: los vídeos salen en silencio. Sube una en la ficha («Música de los vídeos») y pulsa «Volver a montar el vídeo».</p>}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", marginTop: 14 }}>
            {mDraft.ads.map((a, i) => {
              const k = mCopy[a.id] || { message: "", headline: "", description: "" };
              const set = (f: string, v: string) => setMCopy({ ...mCopy, [a.id]: { ...k, [f]: v } });
              return (
                <div className="card" key={a.id} style={{ opacity: mInc[a.id] === false ? 0.5 : 1 }}>
                  <label className="row small" style={{ gap: 6, marginBottom: 4 }}><input type="checkbox" checked={mInc[a.id] !== false} onChange={(e) => setMInc({ ...mInc, [a.id]: e.target.checked })} /> Incluir en la campaña</label>
                  <div className="small">Anuncio {i + 1} · <a href={a.finalUrl} target="_blank" rel="noreferrer">{a.finalUrl.replace(/^https?:\/\//, "")}</a></div>
                  {a.basedOn && <div className="small">Imita: {a.basedOn}</div>}
                  {a.mediaType === "video" ? <video src={a.mediaUrl} controls playsInline style={{ width: "100%", marginTop: 8 }} /> : <img src={a.mediaUrl} alt="" style={{ width: "100%", marginTop: 8 }} />}
                  {!!a.videoPlan && (
                    <div className="row small" style={{ marginTop: 4, gap: 6 }}>
                      {vBusy === a.id ? <span>Montando el vídeo como el de la referencia…</span> : a.mediaType !== "video" ? <span style={{ color: "#b45309" }}>La referencia es un vídeo: falta montar el nuestro.</span> : <span>Vídeo calcado de la referencia.</span>}
                      <button className="btn-secondary" onClick={() => mountVideo(a.id)} disabled={!!vBusy || !!busy}>{a.mediaType === "video" ? "Volver a montar el vídeo" : "Montar vídeo"}</button>
                    </div>
                  )}
                  <label className="field" style={{ marginTop: 6 }}>{busy === `medio-${a.id}` ? "Subiendo a Meta…" : "Cambiar por mi vídeo o imagen"}
                    <input type="file" accept="video/*,image/*" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) replaceMedia(a.id, f); }} />
                  </label>
                  <label className="field">Texto principal ({k.message.length}/300)<textarea rows={4} value={k.message} maxLength={300} onChange={(e) => set("message", e.target.value)} /></label>
                  <label className="field">Titular ({k.headline.length}/40)<input value={k.headline} maxLength={40} onChange={(e) => set("headline", e.target.value)} /></label>
                  <label className="field">Descripción ({k.description.length}/30)<input value={k.description} maxLength={30} onChange={(e) => set("description", e.target.value)} /></label>
                  <label className="field" style={{ marginTop: 8 }}>Comentarios para mejorarlo<textarea rows={2} value={mFeedback[a.id] || ""} onChange={(e) => setMFeedback({ ...mFeedback, [a.id]: e.target.value })} placeholder="Más corto, habla de cumpleaños, sin emojis…" /></label>
                  <button className="btn-secondary" style={{ marginTop: 6 }} onClick={() => rewrite(a.id)} disabled={!!busy || !(mFeedback[a.id] || "").trim()}>{busy === `rehacer-${a.id}` ? "Reescribiendo…" : "Rehacer con mis comentarios"}</button>
                  {!!a.videoPlan && <button className="btn-secondary" style={{ marginTop: 6, marginLeft: 6 }} onClick={() => mountVideo(a.id, mFeedback[a.id])} disabled={!!busy || !!vBusy || !(mFeedback[a.id] || "").trim()}>Rehacer el vídeo con mis comentarios</button>}
                  {a.brief && <details style={{ marginTop: 8 }}><summary className="small">Guion para grabar el vídeo</summary><p className="small" style={{ whiteSpace: "pre-wrap" }}>{a.brief}</p></details>}
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button onClick={() => approve(mDraft)} disabled={!!busy || !!vBusy || mDraft.ads.some((a) => mInc[a.id] !== false && a.videoPlan && a.mediaType !== "video") || mDraft.ads.some((a) => mInc[a.id] !== false && (!mCopy[a.id]?.message || !mCopy[a.id]?.headline)) || !mDraft.ads.some((a) => mInc[a.id] !== false) || !(mCap >= mBudget)}>{busy === "aprobar" ? "Creando en Meta…" : "Crear en pausa en Meta"}</button>
            <button className="btn-secondary" onClick={() => discard(mDraft)} disabled={!!busy}>{busy === "descartar" ? "Descartando…" : "Descartar propuesta"}</button>
            <span className="small">Facebook + Instagram · {mDraft.ads.filter((a) => mInc[a.id] !== false).length} de {mDraft.ads.length} anuncios marcados · {data.metaRtShare > 0 ? `captación (${100 - data.metaRtShare} %) + remarketing a visitantes de la web sin compra (${data.metaRtShare} %)` : "solo captación (sin remarketing)"}</span>
          </div>
        </>
      )}

          {mLive && renderLive(mLive)}
        </>
      )}

      {tab === "google" && (
        <>
          {!b.googleCustomerId && <p className="muted">Elige una cuenta de Google Ads en la ficha y guárdala para poder proponer.</p>}
          {renderRefs("google")}
          {!gLive && b.googleCustomerId && (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn-secondary" onClick={propose} disabled={!!busy || !refsOf("google").length}>{busy === "proponer" ? "Consultando CPC reales en Google…" : gDraft ? "Volver a proponer (Google)" : "Proponer campaña en Google"}</button>
            </div>
          )}
      {gDraft && !gLive && (
        <>
          <h2>Propuesta · revisa y aprueba</h2>
          <p className="muted">Nada existe en Google hasta que pulses «Crear en pausa». Edita el CPC máximo de cada palabra, quita las que no quieras y ajusta presupuesto y tope.</p>
          <div className="row" style={{ margin: "10px 0 16px" }}>
            <label className="field">Presupuesto diario<input type="number" step="1" value={budget} onChange={(e) => setBudget(+e.target.value)} style={{ width: 120 }} /></label>
            <label className="field">Gasto total máximo<input type="number" step="10" value={cap} onChange={(e) => setCap(+e.target.value)} style={{ width: 120 }} /></label>
            <div className="small" style={{ alignSelf: "end" }}>{inc.length} palabras · ~{estDailyClicks.toFixed(0)} clics/día como máximo · {overCap ? <span className="over">{overCap} por encima del techo {money(b.maxCpc, b.currency)}</span> : "todas dentro del techo"}</div>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th></th><th>Palabra</th><th>Grupo</th><th>Concordancia</th><th className="num">Búsquedas/mes</th><th className="num">CPC estimado</th><th className="num">CPC máximo</th><th>Lleva a</th><th>Por qué</th></tr></thead>
              <tbody>
                {kws.map((k, i) => (
                  <tr key={k.id} style={{ opacity: k.included ? 1 : .45 }}>
                    <td><input type="checkbox" checked={k.included} onChange={(e) => setKws(kws.map((x, j) => j === i ? { ...x, included: e.target.checked } : x))} aria-label="Incluir" /></td>
                    <td>{k.text}</td>
                    <td className="small">{k.adGroup || "—"}</td>
                    <td><select value={k.matchType} onChange={(e) => setKws(kws.map((x, j) => j === i ? { ...x, matchType: e.target.value } : x))}><option value="EXACT">Exacta</option><option value="PHRASE">Frase</option></select></td>
                    <td className="num">{k.volume ?? "—"}</td>
                    <td className="num">{k.estCpcLow != null ? `${k.estCpcLow.toFixed(2)} – ${k.estCpcHigh?.toFixed(2)}` : "—"}</td>
                    <td className="num"><input type="number" step="0.05" min="0.05" value={k.maxCpc} className={k.maxCpc > b.maxCpc ? "over" : ""} onChange={(e) => setKws(kws.map((x, j) => j === i ? { ...x, maxCpc: +e.target.value } : x))} style={{ width: 80, textAlign: "right" }} /></td>
                    <td><select value={k.finalUrl || ""} onChange={(e) => setKws(kws.map((x, j) => j === i ? { ...x, finalUrl: e.target.value || null } : x))} style={{ maxWidth: 200 }}>
                      <option value="">La del anuncio</option>
                      {data.products.map((p) => <option key={p.id} value={p.url}>{p.name}</option>)}
                    </select></td>
                    <td className="small">{k.intent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {gDraft.extras && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Recursos del anuncio</h3>
              <p className="small">Se añaden a la campaña al crearla; Google los enseña junto a los anuncios cuando ayudan.</p>
              {gDraft.extras.sitelinks?.length > 0 && <p className="small"><strong>Enlaces de sitio:</strong> {gDraft.extras.sitelinks.map((x: any) => `${x.text} (${x.desc1} · ${x.desc2})`).join(" | ")}</p>}
              {gDraft.extras.callouts?.length > 0 && <p className="small"><strong>Destacados:</strong> {gDraft.extras.callouts.join(" · ")}</p>}
              {gDraft.extras.snippet && <p className="small"><strong>{gDraft.extras.snippet.header}:</strong> {gDraft.extras.snippet.values.join(", ")}</p>}
              {gDraft.extras.promotion && <p className="small"><strong>Promoción:</strong> {gDraft.extras.promotion.percentOff} % en {gDraft.extras.promotion.item}{gDraft.extras.promotion.code ? ` (código ${gDraft.extras.promotion.code})` : ""}</p>}
              {gDraft.extras.prices?.length > 0 && <p className="small"><strong>Precios:</strong> {gDraft.extras.prices.map((x: any) => `${x.header} desde ${x.price} ${b.currency}`).join(" · ")}</p>}
            </div>
          )}
          <h2>Anuncios</h2>
          <div className="grid">
            {gDraft.ads.map((a, i) => (
              <div className="card" key={i}>
                <div className="small">Anuncio {i + 1}{a.adGroup ? ` · grupo «${a.adGroup}»` : ""} · Google combina estos textos</div>
                {a.basedOn && <div className="small">Imita: {a.basedOn}</div>}
                <div className="small"><a href={a.finalUrl} target="_blank" rel="noreferrer">{a.finalUrl.replace(/^https?:\/\//, "")}</a></div>
                <div className="row small" style={{ gap: 4, marginTop: 6 }}>Ruta que se ve: {b.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "")}/
                  <input value={gPaths[a.id]?.path1 ?? ""} maxLength={15} placeholder={b.googlePath1 || "parte1"} onChange={(e) => setGPaths({ ...gPaths, [a.id]: { path1: e.target.value, path2: gPaths[a.id]?.path2 ?? "" } })} style={{ width: 110 }} />/
                  <input value={gPaths[a.id]?.path2 ?? ""} maxLength={15} placeholder={b.googlePath2 || "parte2"} onChange={(e) => setGPaths({ ...gPaths, [a.id]: { path1: gPaths[a.id]?.path1 ?? "", path2: e.target.value } })} style={{ width: 110 }} />
                </div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{a.headlines.map((h, j) => <li key={j}>{h}</li>)}</ul>
                <p className="muted" style={{ marginTop: 8 }}>{a.descriptions.join(" · ")}</p>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button onClick={() => approve(gDraft)} disabled={!!busy || !inc.length || overCap > 0}>{busy === "aprobar" ? "Creando en Google Ads…" : "Crear en pausa en Google Ads"}</button>
            <button className="btn-secondary" onClick={() => discard(gDraft)} disabled={!!busy}>{busy === "descartar" ? "Descartando…" : "Descartar propuesta"}</button>
            <span className="small">{data.googleWeekdaysOnly ? "Lunes a viernes, 8–20 h" : "Todos los días, a cualquier hora"} · solo Búsqueda · puja manual con techo · con las fotos de hasta 3 cuadros como imágenes (Google decide cuándo enseñarlas)</span>
          </div>
        </>
      )}

          {gLive && renderLive(gLive)}
        </>
      )}

      {b.sales.length > 0 && (
        <>
          <h2>Ventas registradas</h2>
          <ul className="log">{b.sales.map((s) => <li key={s.id}><time suppressHydrationWarning>{new Date(s.createdAt).toLocaleString("es-ES")}</time><span>{money(s.amount, s.currency)} · {s.channel}</span></li>)}</ul>
        </>
      )}

      <details className="card" style={{ marginTop: 16 }}>
      <summary style={{ cursor: "pointer" }}><strong style={{ fontWeight: 500 }}>Historial</strong> <span className="small">· {b.actions.length} · pulsa para abrir</span></summary>
      <ul className="log">
        {b.actions.map((a) => (
          <li key={a.id}><time suppressHydrationWarning>{new Date(a.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span><strong style={{ fontWeight: 500 }}>{a.kind.toLowerCase().replace(/_/g, " ")}</strong> · {a.detail}{a.auto && <span className="auto">automático</span>}</span></li>
        ))}
        {!b.actions.length && <li className="small">Sin actividad todavía.</li>}
      </ul>
      </details>

      <div style={{ marginTop: 32 }}>
        <button className="btn-danger" onClick={remove} disabled={!!busy}>{busy === "borrar" ? "Borrando…" : "Borrar ficha"}</button>
      </div>
    </main>
  );
}
