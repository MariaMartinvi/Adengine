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
