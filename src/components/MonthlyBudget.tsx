"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const eur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

// Presupuesto mensual para todas las campañas, con lo comprometido y lo gastado este mes al lado.
export default function MonthlyBudget({ monthly, committed, spent }: { monthly: number | null; committed: number; spent: number }) {
  const r = useRouter();
  const [v, setV] = useState(monthly == null ? "" : String(monthly));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true); setErr("");
    const res = await fetch("/api/ajustes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monthlyBudget: v }) });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error || "Error");
    setBusy(false); r.refresh();
  }
  const over = monthly != null && committed > monthly;
  return (
    <div className="card" style={{ margin: "16px 0", borderColor: over ? "var(--bad)" : undefined }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label className="field">Presupuesto mensual para todas las campañas (€)
          <span className="row"><input type="number" min={0} step={50} value={v} placeholder="Sin límite" onChange={(e) => setV(e.target.value)} style={{ width: 140 }} />
          <button className="btn-secondary" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></span>
        </label>
        <dl className="kv">
          <dt>Comprometido</dt><dd className={over ? "over" : ""}>{eur(committed)}/mes{monthly != null ? ` de ${eur(monthly)}` : ""} <span className="small">(diarios de las campañas activas × 30)</span></dd>
          <dt>Gastado este mes</dt><dd>{eur(spent)}{monthly != null ? ` de ${eur(monthly)}` : ""}</dd>
        </dl>
      </div>
      {over && <p className="small" style={{ color: "var(--bad)", marginTop: 8 }}>Las campañas activas suman {eur(committed - monthly!)} más al mes que tu presupuesto. Baja o pausa alguna (lo que está en «Parar» o «Aún pronto» primero).</p>}
      {err && <p className="small" style={{ color: "var(--bad)" }}>{err}</p>}
    </div>
  );
}
