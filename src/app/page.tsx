import Link from "next/link";
import { db } from "@/lib/db";
import { validate, type Verdict } from "@/lib/validation";
import { portfolio } from "@/lib/portfolio";
import MonthlyBudget from "@/components/MonthlyBudget";
import Decisions, { type Decision } from "@/components/Decisions";
export const dynamic = "force-dynamic";

const eur = (n: number, c = "EUR") => new Intl.NumberFormat("es-ES", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);
const when = (d: Date) => d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
// Orden de la tabla: primero lo que pide una decisión de dinero (parar, escalar), luego iterar y lo que aún es pronto.
const ORDER: Record<Verdict["code"], number> = { parar: 0, escalar: 1, iterar: 2, pronto: 3 };
const ICON: Record<Verdict["code"], string> = { escalar: "🟢", iterar: "🟡", pronto: "⚪", parar: "🔴" };

export default async function Home({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  const conn = await db.googleConnection.findFirst({ orderBy: { createdAt: "desc" } });
  const week = new Date(Date.now() - 7 * 86400000);
  const businesses = await db.business.findMany({ include: { sales: true, actions: { where: { auto: true, kind: "REGLA", createdAt: { gte: week } }, orderBy: { createdAt: "desc" } }, campaigns: { include: { metrics: true, proposals: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" } } } } } });
  const pf = await portfolio();

  const rows = businesses.map((b) => {
    const v = validate({ cacCap: b.cacCap, cacTest: b.cacTest, campaigns: b.campaigns, sales: b.sales });
    const live = b.campaigns.filter((c) => ["ENABLED", "PAUSED", "STOPPED"].includes(c.status) && (c.googleCampaignId || c.metaCampaignId));
    const spent7 = b.campaigns.flatMap((c) => c.metrics).filter((m) => m.date >= week).reduce((s, m) => s + m.cost, 0);
    const pending = b.campaigns.filter((c) => c.status !== "ARCHIVED").flatMap((c) => c.proposals.map((p) => ({ p, c })));
    // Meta activa hace más de un día y sin ninguna impresión: algo la frena (revisión, pago, «en preparación»).
    const stalled = live.filter((c) => c.channel === "meta" && c.status === "ENABLED" && Date.now() - c.createdAt.getTime() > 86400000 && !c.metrics.some((m) => m.impressions > 0));
    const next = pending.length ? `Revisar ${pending.length} propuesta${pending.length === 1 ? "" : "s"}`
      : !live.length ? (b.campaigns.some((c) => c.status === "DRAFT") ? "Revisar la propuesta y crear la campaña" : "Proponer campaña")
      : v.verdict.code === "parar" ? "Pausar o cambiar producto/precio"
      : v.verdict.code === "escalar" ? "Subir presupuesto poco a poco"
      : v.verdict.code === "iterar" ? v.verdict.reason
      : "Esperar datos";
    return { b, v, live, spent7, pending, stalled, next };
  }).sort((x, y) => (x.live.length ? 0 : 1) - (y.live.length ? 0 : 1) || ORDER[x.v.verdict.code] - ORDER[y.v.verdict.code] || y.v.spend - x.v.spend);

  const decisions: Decision[] = rows.flatMap((r) => r.pending.map(({ p, c }) => ({ id: p.id, businessId: r.b.id, business: r.b.name, channel: c.channel === "meta" ? "Meta" : "Google", reason: p.reason })));
  const autos = rows.flatMap((r) => r.b.actions.map((a) => ({ ...a, business: r.b.name }))).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  const alerts = rows.flatMap((r) => r.stalled.map((c) => `${r.b.name}: Meta lleva ${Math.round((Date.now() - c.createdAt.getTime()) / 3600000)} h activa sin publicar ningún anuncio (mira la columna «Entrega» en el Administrador de anuncios).`));
  const spentAll = rows.reduce((s, r) => s + r.v.spend, 0), salesAll = rows.reduce((s, r) => s + r.v.sales.ads, 0);
  const count = (k: Verdict["code"]) => rows.filter((r) => r.live.length && r.v.verdict.code === k).length;

  return (
    <main>
      <h1>Negocios</h1>
      <p className="muted">¿Qué MVP vende a un coste que deja margen? Arriba, lo que necesita tu decisión; abajo, cada negocio con su veredicto.</p>
      {searchParams.connected && <div className="notice">Google Ads conectado como {conn?.email}.</div>}
      {searchParams.error && <div className="notice error">No se pudo conectar: {searchParams.error}</div>}
      {!conn && <div className="notice">Google Ads aún no está conectado. Pulsa «Conectar Google Ads» arriba con el correo del MCC.</div>}

      {businesses.length === 0 ? (
        <div className="empty">
          <p>Todavía no hay negocios. Pega una URL y la herramienta redacta la ficha, propone palabras con CPC reales y escribe los anuncios.</p>
          <Link href="/negocios/nuevo" className="btn">Añadir el primer negocio</Link>
        </div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", margin: "16px 0" }}>
            <div className="card"><div className="small">Gastado este mes</div><strong style={{ fontSize: 22, fontWeight: 500 }}>{eur(pf.spent)}</strong>{pf.monthly != null && <div className="small">de {eur(pf.monthly)}</div>}</div>
            <div className="card"><div className="small">Ventas de anuncios</div><strong style={{ fontSize: 22, fontWeight: 500 }}>{salesAll}</strong><div className="small">desde el inicio</div></div>
            <div className="card"><div className="small">CAC global</div><strong style={{ fontSize: 22, fontWeight: 500 }}>{salesAll ? eur(spentAll / salesAll) : "—"}</strong><div className="small">{eur(spentAll)} en anuncios</div></div>
            <div className="card"><div className="small">Veredictos</div><strong style={{ fontSize: 22, fontWeight: 500 }}>🟢 {count("escalar")} · 🟡 {count("iterar")} · ⚪ {count("pronto")} · 🔴 {count("parar")}</strong></div>
          </div>
          <MonthlyBudget monthly={pf.monthly} committed={pf.committed} spent={pf.spent} />

          {(decisions.length > 0 || alerts.length > 0 || autos.length > 0) && (
            <div className="card" style={{ marginBottom: 16, borderColor: decisions.length || alerts.length ? "var(--warn)" : undefined }}>
              <h3 style={{ marginTop: 0 }}>Para hoy</h3>
              {alerts.map((a) => <p key={a} className="small" style={{ color: "var(--bad)", margin: "4px 0" }}>⚠ {a}</p>)}
              {decisions.length > 0 && <><strong style={{ fontWeight: 500, display: "block", marginTop: 8 }}>Para que decidas ({decisions.length})</strong><Decisions items={decisions} /></>}
              {autos.length > 0 && <>
                <strong style={{ fontWeight: 500, display: "block", marginTop: 12 }}>Hecho automáticamente esta semana ({autos.length})</strong>
                <ul className="log">{autos.slice(0, 10).map((a) => <li key={a.id}><time suppressHydrationWarning>{when(a.createdAt)}</time><span><strong style={{ fontWeight: 500 }}>{a.business}</strong> · {a.detail}</span></li>)}</ul>
              </>}
            </div>
          )}

          <div className="row" style={{ justifyContent: "space-between", margin: "8px 0" }}>
            <h2 style={{ margin: 0 }}>Cartera</h2>
            <Link href="/negocios/nuevo" className="btn btn-secondary">Añadir negocio</Link>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Negocio</th><th>Veredicto</th><th>Canales</th><th className="num">7 días</th><th className="num">Total</th><th className="num">Ventas</th><th className="num">CAC real</th><th>Siguiente paso</th></tr></thead>
              <tbody>
                {rows.map(({ b, v, live, spent7, next }) => (
                  <tr key={b.id}>
                    <td><Link href={`/negocios/${b.id}`}><strong style={{ fontWeight: 500 }}>{b.name}</strong></Link><div className="small">{b.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</div></td>
                    <td>{live.length ? <span className={`status ${v.verdict.code}`}>{ICON[v.verdict.code]} {v.verdict.label}</span> : <span className="small">sin campaña</span>}</td>
                    <td className="small">{live.length ? live.map((c) => <div key={c.id}>{c.channel === "meta" ? "Meta" : "Google"} <span className={`status ${c.status}`}>{({ ENABLED: "activa", PAUSED: "en pausa", STOPPED: "detenida" } as any)[c.status]}</span> {c.dailyBudget} €/día</div>) : "—"}</td>
                    <td className="num">{eur(spent7, b.currency)}</td>
                    <td className="num">{eur(v.spend, b.currency)}</td>
                    <td className="num">{v.sales.ads}{v.sales.organic ? <span className="small"> +{v.sales.organic}</span> : null}</td>
                    <td className={`num ${v.cac != null && v.cac > b.cacCap ? "over" : ""}`}>{v.cac != null ? eur(v.cac, b.currency) : "—"}<div className="small">escalado {eur(b.cacCap, b.currency)}</div></td>
                    <td className="small" style={{ maxWidth: 260 }}>{next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
