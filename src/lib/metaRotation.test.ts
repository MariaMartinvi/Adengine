import { test } from "node:test";
import assert from "node:assert/strict";
import { metaAdsToPause, metaRotation } from "./metaRotation";

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

test("pausa automática: 1 CAC de validación gastado sin clics a compra", () => {
  const ads = [{ id: "a", status: "ENABLED" }, { id: "b", status: "ENABLED" }, { id: "c", status: "PAUSED" }];
  const totals = new Map([["a", { cost: 12, conversions: 0 }], ["b", { cost: 11, conversions: 0 }], ["c", { cost: 50, conversions: 0 }]]);
  // Con el valor por defecto (2 × 6 = 12) solo «a»; es el mismo umbral que el antiguo 2 × CAC tope.
  assert.deepEqual(metaAdsToPause(ads, totals, 12).map((x) => x.id), ["a"]);
  // Con un CAC de validación de 20, ninguno todavía.
  assert.deepEqual(metaAdsToPause(ads, totals, 20), []);
});

test("variante de anuncio: hereda del original lo que no se indica", async () => {
  const { variantTexts } = await import("./engine");
  const base = { headlines: ["Titular"], descriptions: ["Mensaje", "Desde 49 €"], finalUrl: "https://x.es/p" };
  assert.deepEqual(variantTexts(base, { description: "63,20 € · Envío gratis" }, "https://x.es"), { headline: "Titular", message: "Mensaje", description: "63,20 € · Envío gratis", link: "https://x.es/p" });
  assert.deepEqual(variantTexts({ ...base, finalUrl: null }, { headline: " Nuevo ", message: "" }, "https://x.es"), { headline: "Nuevo", message: "Mensaje", description: "Desde 49 €", link: "https://x.es" });
});
