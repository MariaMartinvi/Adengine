import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMarket, mainCountries, splitBudget } from "./metaMarkets";

test("el principal se queda con los países sin grupo", () => {
  assert.deepEqual(mainCountries("US,MX,ES,CL,PR", [{ countries: "MX,CL" }, { countries: "US,PR" }]), ["ES"]);
  assert.deepEqual(mainCountries("ES", []), ["ES"]);
});

test("un grupo nuevo se valida", () => {
  const all = "US,MX,ES,CL,PR";
  assert.doesNotThrow(() => checkMarket(all, [], { key: "latam", countries: "MX,CL", share: 0.35 }));
  assert.throws(() => checkMarket(all, [], { key: "x", countries: "AR", share: 0.2 }), /AR no está/);
  assert.throws(() => checkMarket(all, [{ key: "latam", countries: "MX,CL" }], { key: "mx", countries: "MX", share: 0.2 }), /ya está en otro/);
  assert.throws(() => checkMarket("MX,CL", [], { key: "latam", countries: "MX,CL", share: 0.3 }), /no le quedaría/);
  assert.throws(() => checkMarket(all, [], { key: "latam", countries: "MX", share: 1 }), /reparto/);
});

test("el tope se reparte sin dejar a nadie por debajo de su gasto", () => {
  const r = splitBudget(150, [{ id: "main", spent: 80, share: 0.5 }, { id: "rt", spent: 5, share: 0.2 }, { id: "latam", spent: 0, share: 0.3 }]);
  assert.deepEqual(r, { main: 112.5, rt: 18, latam: 19.5 });
  assert.equal(Object.values(r).reduce((s, x) => s + x, 0), 150);
  assert.deepEqual(splitBudget(50, [{ id: "a", spent: 60, share: 1 }]), { a: 60 });   // tope ya superado: no baja del gasto
});

test("reparto: descuenta lo gastado por conjuntos que ya no se reparten (caso Bebés, conjunto 1 en pausa con 38,19 €)", () => {
  const sets = [{ id: "es", spent: 47.47, share: 0.5 }, { id: "rt", spent: 12.98, share: 0.2 }, { id: "mx", spent: 4.63, share: 0.21 }, { id: "us", spent: 1.88, share: 0.09 }];
  const r = splitBudget(150, sets, 38.19);
  const left = sets.reduce((s, x) => s + r[x.id] - x.spent, 0);
  assert.ok(Math.abs(left - 44.85) < 0.05, `quedan ${left}`);
});

import { lastActiveInSet, marketKey } from "./metaMarkets";

test("no se puede dejar un conjunto sin anuncios aunque otros conjuntos tengan", () => {
  const ads = [
    { id: "es1", status: "ENABLED", metaAdId: "1", market: null }, { id: "es2", status: "PAUSED", metaAdId: "2", market: null },
    { id: "mx1", status: "ENABLED", metaAdId: "3", market: "mexico-y-chile" }, { id: "mx2", status: "ENABLED", metaAdId: "4", market: "mexico-y-chile" },
  ];
  assert.equal(lastActiveInSet(ads, "es1"), true);    // España se quedaría sin nada aunque México tenga dos
  assert.equal(lastActiveInSet(ads, "mx1"), false);
  assert.equal(lastActiveInSet([...ads, { id: "es3", status: "ENABLED", metaAdId: "5", market: null }], "es1"), false);
});

test("nombre interno sin tildes", () => {
  assert.equal(marketKey("México y Chile"), "mexico-y-chile");
  assert.equal(marketKey("EE. UU."), "ee-uu");
});

import { missingInMarket } from "./metaMarkets";

test("al grupo solo se copian los activos del principal que le faltan", () => {
  const ads = [
    { id: "es11", status: "ENABLED", metaAdId: "1", market: null, mediaRef: "img11" },
    { id: "es3", status: "ENABLED", metaAdId: "2", market: null, mediaRef: "img3" },
    { id: "es13", status: "PAUSED", metaAdId: "3", market: null, mediaRef: "vid13" },
    { id: "mx11", status: "ENABLED", metaAdId: "4", market: "mx", mediaRef: "img11" },
  ];
  assert.deepEqual(missingInMarket(ads, "mx").map((a) => a.id), ["es3"]);
});

import { setTotal } from "./metaMarkets";

test("presupuesto de un conjunto: total = lo gastado + lo que queda, con fin en el futuro", () => {
  const now = new Date("2026-11-20T12:00:00+01:00");
  assert.equal(setTotal(47.51, 26.8, new Date("2026-11-26T10:59:55+01:00"), now), 74.31);
  assert.throws(() => setTotal(47.51, 0, new Date("2026-11-26T10:59:55+01:00"), now));
  assert.throws(() => setTotal(47.51, 10, new Date("2026-11-19T10:00:00+01:00"), now));
});
