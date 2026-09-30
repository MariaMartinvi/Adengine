import Link from "next/link";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";

const eur = (n: number, c = "EUR") => new Intl.NumberFormat("es-ES", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);

export default async function Home({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  const conn = await db.googleConnection.findFirst({ orderBy: { createdAt: "desc" } });
  const businesses = await db.business.findMany({ orderBy: { createdAt: "desc" }, include: { campaigns: { include: { metrics: true, proposals: { where: { status: "PENDING" } } } } } });
  const since = new Date(); since.setDate(since.getDate() - 7);

  return (
    <main>
      <h1>Negocios</h1>
      <p className="muted">Cada negocio tiene su ficha, su tope de CAC y su gasto máximo. La herramienta baja y pausa sola; subir siempre te lo pregunta.</p>
      {searchParams.connected && <div className="notice">Google Ads conectado como {conn?.email}.</div>}
      {searchParams.error && <div className="notice error">No se pudo conectar: {searchParams.error}</div>}
      {!conn && <div className="notice">Google Ads aún no está conectado. Pulsa «Conectar Google Ads» arriba con el correo del MCC.</div>}

      {businesses.length === 0 ? (
        <div className="empty">
          <p>Todavía no hay negocios. Pega una URL y la herramienta redacta la ficha, propone palabras con CPC reales y escribe los anuncios.</p>
          <Link href="/negocios/nuevo" className="btn">Añadir el primer negocio</Link>
        </div>
      ) : (
        <div className="grid">
          {businesses.map((b) => {
            const live = b.campaigns.find((c) => c.status !== "DRAFT");
            const m = live?.metrics || [];
            const spent = m.reduce((s, x) => s + x.cost, 0);
            const conv = m.reduce((s, x) => s + x.conversions, 0);
            const last7 = m.filter((x) => x.date >= since);
            const spent7 = last7.reduce((s, x) => s + x.cost, 0);
            const conv7 = last7.reduce((s, x) => s + x.conversions, 0);
            const cac = conv > 0 ? spent / conv : null;
            const pct = live ? Math.min(100, (spent / live.totalCap) * 100) : 0;
            const pending = b.campaigns.reduce((s, c) => s + c.proposals.length, 0);
            return (
              <Link key={b.id} href={`/negocios/${b.id}`} className="card" style={{ color: "inherit" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3>{b.name}</h3>
                  <span className={`status ${live?.status || ""}`}>{live ? ({ ENABLED: "activa", PAUSED: "en pausa", STOPPED: "detenida" } as any)[live.status] : b.campaigns.length ? "propuesta lista" : "sin campaña"}</span>
                </div>
                <div className="small">{b.url.replace(/^https?:\/\//, "")} · {b.country}</div>
                {live ? (
                  <>
                    <div className="gauge"><i className={pct > 90 ? "bad" : pct > 70 ? "warn" : ""} style={{ width: `${pct}%` }} /></div>
                    <div className="small">{eur(spent, b.currency)} de {eur(live.totalCap, b.currency)} gastados</div>
                    <dl className="kv" style={{ marginTop: 10 }}>
                      <dt>Últimos 7 días</dt><dd>{eur(spent7, b.currency)} · {conv7} ventas</dd>
                      <dt>Coste por venta</dt><dd className={cac != null && cac > b.cacCap ? "over" : ""}>{cac != null ? eur(cac, b.currency) : "—"} <span className="small">/ tope {eur(b.cacCap, b.currency)}</span></dd>
                      <dt>Pendiente</dt><dd>{pending ? `${pending} propuestas` : "nada"}</dd>
                    </dl>
                  </>
                ) : (
                  <dl className="kv" style={{ marginTop: 10 }}>
                    <dt>Venta</dt><dd>{b.saleEvent} · {eur(b.price, b.currency)}</dd>
                    <dt>CAC tope</dt><dd>{eur(b.cacCap, b.currency)}</dd>
                    <dt>CPC máximo</dt><dd>{eur(b.maxCpc, b.currency)}</dd>
                  </dl>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
