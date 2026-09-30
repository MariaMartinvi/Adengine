"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Metric = { date: string; cost: number; clicks: number; conversions: number; impressions: number };
type Keyword = { id: string; text: string; matchType: string; maxCpc: number; estCpcLow?: number; estCpcHigh?: number; volume?: number; intent?: string; included: boolean; status: string; metrics: Metric[] };
type Proposal = { id: string; kind: string; reason: string; payload: any };
type Campaign = { id: string; name: string; status: string; dailyBudget: number; totalCap: number; googleCampaignId?: string; keywords: Keyword[]; ads: { headlines: string[]; descriptions: string[] }[]; metrics: Metric[]; proposals: Proposal[] };
type Business = { id: string; name: string; url: string; sells: string; audience: string; country: string; language: string; currency: string; price: number; marginPct: number; saleEvent: string; cacCap: number; maxCpc: number; dailyBudget: number; totalCap: number; googleCustomerId?: string; notes?: string; campaigns: Campaign[]; actions: { id: string; kind: string; detail: string; auto: boolean; createdAt: string }[]; sales: { id: string; amount: number; currency: string; channel?: string; createdAt: string }[] };

const money = (n: number, c: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
const sum = (m: Metric[], k: keyof Metric) => m.reduce((s, x) => s + Number(x[k] || 0), 0);

export default function BusinessPanel({ data, accounts }: { data: Business; accounts: { id: string; name: string }[] }) {
  const r = useRouter();
  const [b, setB] = useState(data);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const draft = data.campaigns.find((c) => c.status === "DRAFT");
  const live = data.campaigns.find((c) => c.status !== "DRAFT");
  const [kws, setKws] = useState<Keyword[]>(draft?.keywords || []);
  const [budget, setBudget] = useState(draft?.dailyBudget ?? b.dailyBudget);
  const [cap, setCap] = useState(draft?.totalCap ?? b.totalCap);

  async function api(path: string, body?: unknown, method = "POST") {
    setErr("");
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || "Error"); return null; }
    return j;
  }
  async function saveFicha() { setBusy("ficha"); await api(`/api/negocios/${b.id}`, b, "PATCH"); setBusy(""); r.refresh(); }
  async function propose() { setBusy("proponer"); await api(`/api/negocios/${b.id}/proponer`); setBusy(""); r.refresh(); }
  async function approve() {
    setBusy("aprobar");
    const j = await api(`/api/negocios/${b.id}/aprobar`, { campaignId: draft!.id, dailyBudget: budget, totalCap: cap, keywords: kws.map((k) => ({ id: k.id, maxCpc: k.maxCpc, included: k.included, matchType: k.matchType })) });
    setBusy(""); if (j) r.refresh();
  }
  async function status(s: string) { setBusy(s); await api(`/api/campanas/${live!.id}/estado`, { status: s }); setBusy(""); r.refresh(); }
  async function decide(id: string, decision: string) { setBusy(id); await api(`/api/propuestas/${id}`, { decision }); setBusy(""); r.refresh(); }

  const inc = kws.filter((k) => k.included);
  const overCap = inc.filter((k) => k.maxCpc > b.maxCpc).length;
  const estDailyClicks = useMemo(() => inc.length ? budget / (inc.reduce((s, k) => s + k.maxCpc, 0) / inc.length) : 0, [inc, budget]);
  const set = (k: keyof Business, v: any) => setB({ ...b, [k]: v });

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
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={saveFicha} disabled={!!busy}>{busy === "ficha" ? "Guardando…" : "Guardar ficha"}</button>
        {!live && <button className="btn-secondary" onClick={propose} disabled={!!busy || !b.googleCustomerId}>{busy === "proponer" ? "Consultando CPC reales en Google…" : draft ? "Volver a proponer" : "Proponer campaña"}</button>}
        {!b.googleCustomerId && <span className="small">Elige la cuenta de Google Ads para poder proponer.</span>}
      </div>
      {b.notes && <p className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{b.notes}</p>}

      {draft && !live && (
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
            {draft.ads.map((a, i) => (
              <div className="card" key={i}>
                <div className="small">Anuncio {i + 1} · Google combina estos textos</div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{a.headlines.map((h, j) => <li key={j}>{h}</li>)}</ul>
                <p className="muted" style={{ marginTop: 8 }}>{a.descriptions.join(" · ")}</p>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <button onClick={approve} disabled={!!busy || !inc.length || overCap > 0}>{busy === "aprobar" ? "Creando en Google Ads…" : "Crear en pausa en Google Ads"}</button>
            <span className="small">Lunes a viernes, 8–20 h · solo Búsqueda · puja manual con techo</span>
          </div>
        </>
      )}

      {live && (
        <>
          <h2>Campaña · {live.name} <span className={`status ${live.status}`}>{({ ENABLED: "activa", PAUSED: "en pausa", STOPPED: "detenida" } as any)[live.status]}</span></h2>
          <div className="row" style={{ marginBottom: 14 }}>
            {live.status !== "ENABLED" && <button className="btn-ok" onClick={() => status("ENABLED")} disabled={!!busy}>Activar</button>}
            {live.status === "ENABLED" && <button className="btn-secondary" onClick={() => status("PAUSED")} disabled={!!busy}>Pausar</button>}
            <span className="small">{money(live.dailyBudget, b.currency)}/día · tope {money(live.totalCap, b.currency)} · gastado {money(sum(live.metrics, "cost"), b.currency)} · {sum(live.metrics, "conversions")} ventas</span>
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
          <div className="tablewrap">
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
          </div>
        </>
      )}

      {b.sales.length > 0 && (
        <>
          <h2>Ventas registradas</h2>
          <ul className="log">{b.sales.map((s) => <li key={s.id}><time>{new Date(s.createdAt).toLocaleString("es-ES")}</time><span>{money(s.amount, s.currency)} · {s.channel}</span></li>)}</ul>
        </>
      )}

      <h2>Historial</h2>
      <ul className="log">
        {b.actions.map((a) => (
          <li key={a.id}><time>{new Date(a.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span><strong style={{ fontWeight: 500 }}>{a.kind.toLowerCase().replace(/_/g, " ")}</strong> · {a.detail}{a.auto && <span className="auto">automático</span>}</span></li>
        ))}
        {!b.actions.length && <li className="small">Sin actividad todavía.</li>}
      </ul>
    </main>
  );
}
