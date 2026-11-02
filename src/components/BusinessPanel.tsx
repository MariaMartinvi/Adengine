"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Metric = { date: string; cost: number; clicks: number; conversions: number; impressions: number; adId?: string };
type Keyword = { id: string; text: string; matchType: string; maxCpc: number; estCpcLow?: number; estCpcHigh?: number; volume?: number; intent?: string; included: boolean; status: string; metrics: Metric[] };
type Proposal = { id: string; kind: string; reason: string; payload: any };
type Campaign = { id: string; name: string; status: string; channel: string; dailyBudget: number; totalCap: number; googleCampaignId?: string; keywords: Keyword[]; ads: { id: string; status: string; headlines: string[]; descriptions: string[]; mediaType?: string; mediaUrl?: string; basedOn?: string; finalUrl: string }[]; metrics: Metric[]; proposals: Proposal[] };
type Business = { id: string; name: string; url: string; sells: string; audience: string; country: string; language: string; currency: string; price: number; marginPct: number; saleEvent: string; cacCap: number; maxCpc: number; dailyBudget: number; totalCap: number; googleCustomerId?: string; metaAdAccountId?: string; metaPixelId?: string; metaPageId?: string; metaAdvertiser?: string; ageMin: number; ageMax: number; metaCta: string; notes?: string; campaigns: Campaign[]; references: Ref[]; actions: { id: string; kind: string; detail: string; auto: boolean; createdAt: string }[]; sales: { id: string; amount: number; currency: string; channel?: string; createdAt: string }[] };

const money = (n: number, c: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
const sum = (m: Metric[], k: keyof Metric) => m.reduce((s, x) => s + Number(x[k] || 0), 0);

type Option = { id: string; name: string };
type Ref = { id: string; channel: string; note: string; image?: string | null; video: boolean; audio?: string | null; product?: string | null; createdAt: string };

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
export default function BusinessPanel({ data, accounts, metaAccounts = [], metaPixels = [] }: { data: Business; accounts: Option[]; metaAccounts?: Option[]; metaPixels?: Option[] }) {
  const r = useRouter();
  const [b, setB] = useState(data);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  // Una campaña por canal: propuesta (DRAFT) y campaña viva de Google y de Meta, independientes.
  const isMeta = (c: Campaign) => c.channel === "meta";
  const gDraft = data.campaigns.find((c) => c.status === "DRAFT" && !isMeta(c));
  const mDraft = data.campaigns.find((c) => c.status === "DRAFT" && isMeta(c));
  // Las archivadas no cuentan: el canal vuelve a admitir una propuesta nueva.
  const isLive = (c: Campaign) => c.status !== "DRAFT" && c.status !== "ARCHIVED";
  const gLive = data.campaigns.find((c) => isLive(c) && !isMeta(c));
  const mLive = data.campaigns.find((c) => isLive(c) && isMeta(c));
  const [kws, setKws] = useState<Keyword[]>(gDraft?.keywords || []);
  const [budget, setBudget] = useState(gDraft?.dailyBudget ?? b.dailyBudget);
  const [cap, setCap] = useState(gDraft?.totalCap ?? b.totalCap);
  const [mBudget, setMBudget] = useState(mDraft?.dailyBudget ?? b.dailyBudget);
  const [mCap, setMCap] = useState(mDraft?.totalCap ?? b.totalCap);
  const [copy, setCopy] = useState({ message: mDraft?.ads[0]?.descriptions[0] || "", headline: mDraft?.ads[0]?.headlines[0] || "", description: mDraft?.ads[0]?.descriptions[1] || "" });
  const [media, setMedia] = useState({ imageUrls: "", videoUrl: "" });
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
  async function saveFicha() { setBusy("ficha"); await api(`/api/negocios/${b.id}`, b, "PATCH"); setBusy(""); r.refresh(); }
  async function propose() { setBusy("proponer"); await api(`/api/negocios/${b.id}/proponer`); setBusy(""); r.refresh(); }
  async function proposeMeta() { setBusy("meta"); await api(`/api/negocios/${b.id}/proponer`, { channel: "meta", ...media }); setBusy(""); r.refresh(); }
  async function addCover() { setBusy("portada"); const j = await api(`/api/campanas/${mLive!.id}/anuncios`, { imageUrl: newCover }); setBusy(""); if (j) { setNewCover(""); r.refresh(); } }
  async function approve(d: Campaign) {
    setBusy("aprobar");
    const body = isMeta(d)
      ? { campaignId: d.id, dailyBudget: mBudget, totalCap: mCap, ...copy, keywords: [] }
      : { campaignId: d.id, dailyBudget: budget, totalCap: cap, keywords: kws.map((k) => ({ id: k.id, maxCpc: k.maxCpc, included: k.included, matchType: k.matchType })) };
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
    setBusy("ref"); const j = await api(`/api/negocios/${b.id}/referencias`, { channel: ch, ...refForm[ch] }); setBusy("");
    if (j) { setRefForm({ ...refForm, [ch]: { note: "", image: "", video: false, audio: "", product: "" } }); r.refresh(); }
  }
  async function delRef(id: string) { setBusy("ref"); await api(`/api/referencias/${id}`, undefined, "DELETE"); setBusy(""); r.refresh(); }
  async function rebuild(c: Campaign) { setBusy("rehacer"); const j = await api(`/api/campanas/${c.id}/rehacer`, { links: adLinks }); setBusy(""); if (j) { setAdLinks({}); r.refresh(); } }
  async function archive(c: Campaign) {
    if (!confirm(`¿Archivar «${c.name}»? Queda en pausa en ${isMeta(c) ? "Meta" : "Google"} con su historial y podrás proponer una nueva.`)) return;
    setBusy("archivar"); await api(`/api/campanas/${c.id}/archivar`); setBusy(""); r.refresh();
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
      <div className="card" style={{ margin: "16px 0" }}>
        <h3>Referencias que funcionan en {ch === "meta" ? "Meta" : "Google"}</h3>
        <p className="small">Antes de generar, copiamos lo que funciona: la IA replica la estructura de estos anuncios (gancho, formato, oferta, botón) con los datos de este negocio. Nunca calca frases, imágenes ni cifras ajenas. Vídeos: sube una captura y describe en la nota qué pasa.</p>
        {list.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", margin: "10px 0" }}>
            {list.map((x, i) => (
              <div key={x.id} className="card" style={{ padding: 10 }}>
                <div className="small">Referencia {list.length - i}</div>
                {x.image && <img src={x.image} alt="" style={{ width: "100%", marginTop: 6 }} />}
                {x.note && <p className="small" style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>{x.note}</p>}
                {x.video && <p className="small" style={{ margin: "6px 0" }}>Vídeo · música y audio: {x.audio}</p>}
                {x.product && <p className="small" style={{ margin: "6px 0" }}>Nuestro cuadro: {x.product}</p>}
                <button className="btn-secondary" onClick={() => delRef(x.id)} disabled={!!busy}>Quitar</button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <label className="field">Nota (texto del anuncio, enlace, cuánto lleva activo…)<textarea rows={3} value={f.note} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, note: e.target.value } })} style={{ width: 340 }} /></label>
          <label className="field">Captura (opcional)<input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setRefForm({ ...refForm, [ch]: { ...f, image: await shrink(file) } }); }} /></label>
          {f.image && <img src={f.image} alt="" style={{ width: 80, alignSelf: "end" }} />}
          <label className="field">Nuestro cuadro para este anuncio (nombre y enlace)<input value={f.product} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, product: e.target.value } })} placeholder="La oveja que faltaba · https://…/cuadro/…" style={{ width: 340 }} /></label>
          <label className="row small" style={{ alignSelf: "end" }}><input type="checkbox" checked={f.video} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, video: e.target.checked } })} /> Es un vídeo</label>
          {f.video && <label className="field">Música y audio (la IA no oye el vídeo: estilo, instrumentos, si hay voz y qué dice)<input value={f.audio} onChange={(e) => setRefForm({ ...refForm, [ch]: { ...f, audio: e.target.value } })} placeholder="Clásica relajada, cuerda + piano, sin voz" style={{ width: 340 }} /></label>}
          <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => addRef(ch)} disabled={!!busy || (!f.note.trim() && !f.image) || (f.video && !f.audio.trim())}>{busy === "ref" ? "Guardando…" : "Añadir referencia"}</button>
        </div>
      </div>
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
            {live.channel === "meta" && <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={() => applyAudience(live)} disabled={!!busy}>{busy === "publico" ? "Aplicando…" : `Aplicar público de la ficha (${data.country}, ${data.ageMin}–${data.ageMax} años)`}</button>}
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
          {live.channel === "meta" && (
            <div className="row" style={{ marginBottom: 12 }}>
              <label className="field">Añadir portada (URL de imagen)<input value={newCover} onChange={(e) => setNewCover(e.target.value.trim())} placeholder="https://…/portada-2.jpg" style={{ width: 340 }} /></label>
              <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={addCover} disabled={!!busy || !newCover}>{busy === "portada" ? "Subiendo a Meta…" : "Añadir portada"}</button>
              <span className="small" style={{ alignSelf: "end" }}>Mismos textos y mismo presupuesto; Meta reparte entre todas.</span>
            </div>
          )}
          {live.channel === "meta" && (
            <div className="card" style={{ marginBottom: 12 }}>
              <h3>Botón y enlaces</h3>
              <p className="small">En Meta el botón no se edita: «Rehacer» crea anuncios nuevos con el botón de la ficha ({({ SHOP_NOW: "Comprar", LEARN_MORE: "Más información", SIGN_UP: "Registrarte" } as any)[data.metaCta]}) y estos enlaces, y deja los anteriores en pausa con su historial.</p>
              {live.ads.filter((a) => a.status === "ENABLED").map((a, i) => (
                <label key={a.id} className="field" style={{ marginTop: 8 }}>Anuncio {i + 1} · {a.mediaType === "video" ? "vídeo" : "imagen"}
                  <input value={adLinks[a.id] ?? a.finalUrl} onChange={(e) => setAdLinks({ ...adLinks, [a.id]: e.target.value.trim() })} />
                </label>
              ))}
              <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => rebuild(live)} disabled={!!busy}>{busy === "rehacer" ? "Rehaciendo en Meta…" : "Rehacer anuncios"}</button>
            </div>
          )}
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
                        <td>{a.mediaType === "video" ? "Vídeo" : <a href={a.mediaUrl} target="_blank" rel="noreferrer">Imagen {live.ads.filter((x) => x.mediaType === "image").indexOf(a) + 1}</a>}</td>
                        <td><span className={`status ${a.status}`}>{a.status === "ENABLED" ? "activo" : "pausado"}</span></td>
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

      <h2>Ficha</h2>
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
        </label>
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
        {b.metaAdAccountId && <label className="field">Botón de los anuncios (Meta)
          <select value={b.metaCta} onChange={(e) => set("metaCta", e.target.value)}>
            <option value="SHOP_NOW">Comprar</option>
            <option value="LEARN_MORE">Más información</option>
            <option value="SIGN_UP">Registrarte</option>
          </select>
        </label>}
        {b.metaAdAccountId && <label className="field">Edad mínima (Meta)<input type="number" min={18} max={65} value={b.ageMin} onChange={(e) => set("ageMin", +e.target.value)} /></label>}
        {b.metaAdAccountId && <label className="field">Edad máxima (Meta)<input type="number" min={18} max={65} value={b.ageMax} onChange={(e) => set("ageMax", +e.target.value)} /></label>}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={saveFicha} disabled={!!busy}>{busy === "ficha" ? "Guardando…" : "Guardar ficha"}</button>
      </div>
      {b.notes && <p className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{b.notes}</p>}

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
          <label className="field">Imágenes (una por línea; opcional: «imagen | enlace del producto»)<textarea rows={3} value={media.imageUrls} onChange={(e) => setMedia({ ...media, imageUrls: e.target.value })} placeholder={"https://…/cuadro-1.jpg | https://tienda.com/cuadro/1\nhttps://…/cuadro-2.jpg"} style={{ width: 300 }} /></label>
          <label className="field">Vídeo (URL, opcional)<input value={media.videoUrl} onChange={(e) => setMedia({ ...media, videoUrl: e.target.value.trim() })} placeholder="https://…/trailer.mp4" style={{ width: 300 }} /></label>
          <button className="btn-secondary" style={{ alignSelf: "end" }} onClick={proposeMeta} disabled={!!busy || !media.imageUrls.trim() || !refsOf("meta").length}>{busy === "meta" ? "Escribiendo textos y subiendo a Meta…" : mDraft ? "Volver a proponer (Meta)" : "Proponer campaña en Meta"}</button>
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
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            <label className="field">Texto principal ({copy.message.length}/300)<textarea rows={5} value={copy.message} maxLength={300} onChange={(e) => setCopy({ ...copy, message: e.target.value })} /></label>
            <label className="field">Titular ({copy.headline.length}/40)<input value={copy.headline} maxLength={40} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} /></label>
            <label className="field">Descripción ({copy.description.length}/30)<input value={copy.description} maxLength={30} onChange={(e) => setCopy({ ...copy, description: e.target.value })} /></label>
          </div>
          {mDraft.ads[0]?.basedOn && <p className="small" style={{ marginTop: 8 }}>Imita: {mDraft.ads[0].basedOn}</p>}
          <div className="grid" style={{ marginTop: 14 }}>
            {mDraft.ads.map((a, i) => (
              <div className="card" key={i}>
                <div className="small">Anuncio {i + 1} · {a.mediaType === "video" ? "vídeo" : "imagen"}</div>
                {a.mediaType === "video" ? <video src={a.mediaUrl} controls muted style={{ width: "100%", marginTop: 8 }} /> : <img src={a.mediaUrl} alt="" style={{ width: "100%", marginTop: 8 }} />}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button onClick={() => approve(mDraft)} disabled={!!busy || !copy.message || !copy.headline || !(mCap >= mBudget)}>{busy === "aprobar" ? "Creando en Meta…" : "Crear en pausa en Meta"}</button>
            <span className="small">Facebook + Instagram · un conjunto, {mDraft.ads.length} anuncio{mDraft.ads.length > 1 ? "s" : ""}</span>
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
              <thead><tr><th></th><th>Palabra</th><th>Concordancia</th><th className="num">Búsquedas/mes</th><th className="num">CPC estimado</th><th className="num">CPC máximo</th><th>Por qué</th></tr></thead>
              <tbody>
                {kws.map((k, i) => (
                  <tr key={k.id} style={{ opacity: k.included ? 1 : .45 }}>
                    <td><input type="checkbox" checked={k.included} onChange={(e) => setKws(kws.map((x, j) => j === i ? { ...x, included: e.target.checked } : x))} aria-label="Incluir" /></td>
                    <td>{k.text}</td>
                    <td><select value={k.matchType} onChange={(e) => setKws(kws.map((x, j) => j === i ? { ...x, matchType: e.target.value } : x))}><option value="EXACT">Exacta</option><option value="PHRASE">Frase</option></select></td>
                    <td className="num">{k.volume ?? "—"}</td>
                    <td className="num">{k.estCpcLow != null ? `${k.estCpcLow.toFixed(2)} – ${k.estCpcHigh?.toFixed(2)}` : "—"}</td>
                    <td className="num"><input type="number" step="0.05" min="0.05" value={k.maxCpc} className={k.maxCpc > b.maxCpc ? "over" : ""} onChange={(e) => setKws(kws.map((x, j) => j === i ? { ...x, maxCpc: +e.target.value } : x))} style={{ width: 80, textAlign: "right" }} /></td>
                    <td className="small">{k.intent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Anuncios</h2>
          <div className="grid">
            {gDraft.ads.map((a, i) => (
              <div className="card" key={i}>
                <div className="small">Anuncio {i + 1} · Google combina estos textos</div>
                {a.basedOn && <div className="small">Imita: {a.basedOn}</div>}
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{a.headlines.map((h, j) => <li key={j}>{h}</li>)}</ul>
                <p className="muted" style={{ marginTop: 8 }}>{a.descriptions.join(" · ")}</p>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button onClick={() => approve(gDraft)} disabled={!!busy || !inc.length || overCap > 0}>{busy === "aprobar" ? "Creando en Google Ads…" : "Crear en pausa en Google Ads"}</button>
            <span className="small">Lunes a viernes, 8–20 h · solo Búsqueda · puja manual con techo</span>
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

      <h2>Historial</h2>
      <ul className="log">
        {b.actions.map((a) => (
          <li key={a.id}><time suppressHydrationWarning>{new Date(a.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span><strong style={{ fontWeight: 500 }}>{a.kind.toLowerCase().replace(/_/g, " ")}</strong> · {a.detail}{a.auto && <span className="auto">automático</span>}</span></li>
        ))}
        {!b.actions.length && <li className="small">Sin actividad todavía.</li>}
      </ul>

      <div style={{ marginTop: 32 }}>
        <button className="btn-danger" onClick={remove} disabled={!!busy}>{busy === "borrar" ? "Borrando…" : "Borrar ficha"}</button>
      </div>
    </main>
  );
}
