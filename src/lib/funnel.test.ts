import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, funnelsOf } from "./funnel";

const base = { impressions: 10000, clicks: 150, visits: 130, checkouts: 10, purchases: 4 };

test("con menos de 100 clics no se diagnostica", () => {
  assert.equal(diagnose("meta", { ...base, clicks: 60 }).code, "datos");
});
test("Meta: CTR bajo → el anuncio", () => {
  assert.equal(diagnose("meta", { ...base, impressions: 30000 }).code, "anuncio");
});
test("Meta: muchos clics que no cargan la página → carga", () => {
  assert.equal(diagnose("meta", { ...base, visits: 80 }).code, "carga");
});
test("Meta: visitas que no empiezan a pagar → página", () => {
  assert.equal(diagnose("meta", { ...base, checkouts: 2 }).code, "pagina");
});
test("Meta: empiezan a pagar pero no terminan → pago", () => {
  assert.equal(diagnose("meta", { ...base, checkouts: 10, purchases: 1 }).code, "pago");
});
test("Meta: con pocos pagos iniciados no se culpa al pago", () => {
  assert.equal(diagnose("meta", { ...base, checkouts: 4, purchases: 0 }).code, "ok");
});
test("Meta: todo bien", () => {
  const d = diagnose("meta", base);
  assert.equal(d.code, "ok"); assert.match(d.text, /2,7 %/);
});
test("Google: CTR bajo → anuncio; clics sin compras → página", () => {
  assert.equal(diagnose("google", { impressions: 10000, clicks: 150, purchases: 3 }).code, "anuncio");
  assert.equal(diagnose("google", { impressions: 3000, clicks: 150, purchases: 1 }).code, "pagina");
  assert.equal(diagnose("google", { impressions: 3000, clicks: 150, purchases: 2 }).code, "ok");
});

test("funnelsOf: suma por canal los últimos 14 días y cuenta ventas reales del canal", () => {
  const now = new Date("2026-11-20T10:00:00Z");
  const camps = [
    { channel: "meta", metrics: [{ date: "2026-11-15", impressions: 1000, clicks: 50, visits: 40, conversions: 3 }, { date: "2026-10-01", impressions: 9999, clicks: 999, visits: 999, conversions: 99 }] },
    { channel: "google", metrics: [{ date: "2026-11-18", impressions: 200, clicks: 10, conversions: 1 }] },
  ];
  const sales = [{ channel: "meta", createdAt: "2026-11-16" }, { channel: "google", createdAt: "2026-11-17" }, { channel: null, createdAt: "2026-11-17" }, { channel: "meta", createdAt: "2026-10-02" }];
  const f = funnelsOf(camps, sales, 14, now);
  assert.deepEqual({ ...f.meta, diagnosis: undefined }, { impressions: 1000, clicks: 50, visits: 40, checkouts: 3, purchases: 1, diagnosis: undefined });
  assert.equal(f.google.clicks, 10); assert.equal(f.google.purchases, 1);
  assert.equal(f.meta.diagnosis.code, "datos");
});
