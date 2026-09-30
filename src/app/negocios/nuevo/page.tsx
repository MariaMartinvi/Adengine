"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function Nuevo() {
  const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const r = useRouter();
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const res = await fetch("/api/negocios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const j = await res.json(); setBusy(false);
    if (!res.ok) return setErr(j.error);
    r.push(`/negocios/${j.id}`);
  }
  return (
    <main>
      <h1>Añadir negocio</h1>
      <p className="muted">Pega la URL. La herramienta lee la web, redacta la ficha y calcula el CAC tope y el CPC máximo. Después la revisas antes de que proponga nada.</p>
      <form onSubmit={go} className="row" style={{ marginTop: 20 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.rankcoworker.com" style={{ flex: 1, minWidth: 260 }} required />
        <button disabled={busy}>{busy ? "Leyendo la web…" : "Crear ficha"}</button>
      </form>
      {err && <div className="notice error" style={{ marginTop: 16 }}>{err}</div>}
    </main>
  );
}
