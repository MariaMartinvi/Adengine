import { test } from "node:test";
import assert from "node:assert/strict";
import { boxToRect, sinceText } from "./crop";

test("caja en fracciones → píxeles", () => {
  assert.deepEqual(boxToRect({ x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, 1000, 800), { left: 500, top: 200, width: 250, height: 400 });
});

test("una caja que se sale de la imagen se recorta al borde", () => {
  assert.deepEqual(boxToRect({ x: 0.8, y: -0.1, w: 0.5, h: 0.6 }, 1000, 1000), { left: 800, top: 0, width: 200, height: 500 });
});

test("una caja diminuta o sin datos no es un anuncio", () => {
  assert.equal(boxToRect({ x: 0.1, y: 0.1, w: 0.01, h: 0.5 }, 1000, 1000), null);
  assert.equal(boxToRect({ x: NaN, y: 0, w: 0, h: 0 } as any, 1000, 1000), null);
});

test("tiempo en circulación", () => {
  const hoy = new Date("2026-11-04T10:00:00Z");
  assert.equal(sinceText("2026-10-23", hoy), "12 días");
  assert.equal(sinceText("2026-03-19", hoy), "7 meses");
  assert.equal(sinceText("2023-11-01", hoy), "3 años");
  assert.equal(sinceText("no es fecha", hoy), "");
  assert.equal(sinceText("2026-12-01", hoy), "");
});
