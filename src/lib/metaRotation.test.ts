import { test } from "node:test";
import assert from "node:assert/strict";
import { metaRotation } from "./metaRotation";

const ad = (id: string, cost: number, conversions: number, purchases = 0) => ({ id, cost, conversions, purchases });

test("ganador claro: propone pausar el que cuesta más del doble por resultado", () => {
  const r = metaRotation([ad("a", 10, 5), ad("b", 12, 1), ad("c", 3, 1)], { cacCap: 6, days: 4 });
  assert.deepEqual(r.map((x) => x.id), ["b"]);
  assert.match(r[0].reason, /12\.00 por clic a compra/);
});

test("antes de 3 días no propone nada", () => {
  assert.deepEqual(metaRotation([ad("a", 10, 5), ad("b", 12, 0)], { cacCap: 6, days: 2 }), []);
});

test("sin resultados en ningún anuncio no hay ganador: nada", () => {
  assert.deepEqual(metaRotation([ad("a", 10, 0), ad("b", 12, 0)], { cacCap: 6, days: 5 }), []);
});

test("no pausa anuncios que aún no han gastado 1 CAC tope", () => {
  assert.deepEqual(metaRotation([ad("a", 10, 5), ad("b", 5, 0)], { cacCap: 6, days: 5 }), []);
});

test("nunca propone pausar el mejor, aunque solo haya uno con datos", () => {
  assert.deepEqual(metaRotation([ad("a", 30, 1)], { cacCap: 6, days: 5 }), []);
});

test("si hay compras, mandan las compras y no los clics a compra", () => {
  // b tiene más clics a compra pero ninguna compra: el ganador es a.
  const r = metaRotation([ad("a", 10, 1, 2), ad("b", 10, 6, 0)], { cacCap: 6, days: 5 });
  assert.deepEqual(r.map((x) => x.id), ["b"]);
  assert.match(r[0].reason, /sin compras/);
});
