import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validation";

// Bebés: CAC tope 6 €. Un día de métricas por campaña basta para probar las reglas.
const camp = (channel: string, cost: number, extra: Partial<{ impressions: number; clicks: number; conversions: number; purchases: number }> = {}) =>
  ({ channel, metrics: [{ cost, impressions: 0, clicks: 0, conversions: 0, purchases: 0, ...extra }] });
const sale = (channel: string, amount = 49) => ({ channel, amount });

test("sin gasto: aún pronto", () => {
  const v = validate({ cacCap: 6, campaigns: [], sales: [] });
  assert.equal(v.verdict.code, "pronto");
  assert.equal(v.cac, null);
});

test("gastado menos de 1 CAC tope y sin ventas: aún pronto", () => {
  assert.equal(validate({ cacCap: 6, campaigns: [camp("meta", 5)], sales: [] }).verdict.code, "pronto");
});

test("3 o más ventas de anuncios con CAC bajo el tope: escalar", () => {
  const v = validate({ cacCap: 6, campaigns: [camp("google", 9), camp("meta", 6)], sales: [sale("google"), sale("meta"), sale("meta")] });
  assert.equal(v.verdict.code, "escalar");
  assert.equal(v.cac, 5);
  assert.equal(v.byChannel.google.cac, 9);
  assert.equal(v.byChannel.meta.cac, 3);
});

test("ventas pero CAC por encima del tope: iterar", () => {
  const v = validate({ cacCap: 6, campaigns: [camp("meta", 30)], sales: [sale("meta"), sale("meta")] });
  assert.equal(v.verdict.code, "iterar");
  assert.match(v.verdict.reason, /caras/);
});

test("pocas ventas con CAC bueno: iterar por falta de muestra", () => {
  const v = validate({ cacCap: 6, campaigns: [camp("meta", 8)], sales: [sale("meta"), sale("meta")] });
  assert.equal(v.verdict.code, "iterar");
  assert.match(v.verdict.reason, /muestra/);
});

test("clics a compra sin ventas: iterar (web o precio)", () => {
  const v = validate({ cacCap: 6, campaigns: [camp("meta", 10, { conversions: 4 })], sales: [] });
  assert.equal(v.verdict.code, "iterar");
  assert.match(v.verdict.reason, /web o el precio/);
});

test("3 CAC tope gastados sin ventas: parar", () => {
  assert.equal(validate({ cacCap: 6, campaigns: [camp("google", 10), camp("meta", 8)], sales: [] }).verdict.code, "parar");
});

test("las ventas orgánicas no cuentan para el CAC", () => {
  const v = validate({ cacCap: 6, campaigns: [camp("meta", 20)], sales: [sale("organic"), sale("organic"), sale("organic")] });
  assert.equal(v.sales.ads, 0);
  assert.equal(v.sales.organic, 3);
  assert.equal(v.cac, null);
  assert.equal(v.verdict.code, "parar");
});

test("embudo: suma impresiones, clics, clics a compra y ventas", () => {
  const v = validate({ cacCap: 6, campaigns: [camp("google", 2, { impressions: 100, clicks: 5 }), camp("meta", 3, { impressions: 900, clicks: 20, conversions: 2 })], sales: [sale("meta")] });
  assert.deepEqual(v.funnel, { impressions: 1000, clicks: 25, checkouts: 2, sales: 1 });
  assert.equal(v.revenue, 49);
});
