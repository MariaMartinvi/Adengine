import { test } from "node:test";
import assert from "node:assert/strict";
import { pickMetaAds } from "./metaPick";

const d = (s: string) => new Date(s);

test("Bebés: 7 referencias → los 3 vídeos y la imagen más antigua", () => {
  const ads = [
    { refId: "v-mar", video: true, since: d("2026-03-19") },
    { refId: "v-jul", video: true, since: d("2026-07-06") },
    { refId: "i-warning", video: false, since: d("2026-03-17") },
    { refId: "v-jun", video: true, since: d("2026-06-27") },
    { refId: "i-linea", video: false, since: d("2026-03-16") },
    { refId: "i-hold", video: false, since: d("2026-04-13") },
    { refId: "i-see", video: false, since: d("2026-05-12") },
  ];
  assert.deepEqual([...pickMetaAds(ads)].sort(), ["i-linea", "v-jul", "v-jun", "v-mar"]);
});

test("menos anuncios que el máximo: todos marcados", () => {
  assert.equal(pickMetaAds([{ refId: "a", video: false }, { refId: "b", video: false }]).size, 2);
});

test("sin fecha van detrás de los que la tienen", () => {
  const ads = [{ refId: "sin", video: false, since: null }, { refId: "con", video: false, since: d("2026-05-01") }];
  assert.deepEqual([...pickMetaAds(ads, 1)], ["con"]);
});
