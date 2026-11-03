"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type Decision = { id: string; businessId: string; business: string; channel: string; reason: string };

// Propuestas pendientes de todos los negocios, con Aplicar/Descartar sin tener que entrar en cada uno.
export default function Decisions({ items }: { items: Decision[] }) {
  const r = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  async function decide(id: string, decision: "APPROVED" | "DISMISSED") {
    setBusy(id); setErr("");
    const res = await fetch(`/api/propuestas/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error || "Error");
    setBusy(""); r.refresh();
  }
  return (
    <>
      {items.map((p) => (
        <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
          <span><Link href={`/negocios/${p.businessId}`}><strong style={{ fontWeight: 500 }}>{p.business}</strong></Link> <span className="small">· {p.channel}</span><br />{p.reason}</span>
          <span className="row">
            <button className="btn-secondary" onClick={() => decide(p.id, "DISMISSED")} disabled={!!busy}>Descartar</button>
            <button onClick={() => decide(p.id, "APPROVED")} disabled={!!busy}>{busy === p.id ? "Aplicando…" : "Aplicar"}</button>
          </span>
        </div>
      ))}
      {err && <p className="small" style={{ color: "var(--bad)" }}>{err}</p>}
    </>
  );
}
