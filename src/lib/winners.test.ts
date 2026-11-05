import { test } from "node:test";
import assert from "node:assert/strict";
import { winnersToSave } from "./winners";

test("2+ ventas con CAC ≤ escalado → se propone; ya propuesto o caro o 1 venta → no", () => {
  const ads = [
    { id: "a", cost: 40, purchases: 2 },  // CAC 20 ≤ 25
    { id: "b", cost: 60, purchases: 2 },  // CAC 30 > 25
    { id: "c", cost: 10, purchases: 1 },  // 1 venta
    { id: "d", cost: 30, purchases: 3 },  // CAC 10, pero ya propuesto
  ];
  assert.deepEqual(winnersToSave(ads, 25, new Set(["d"])), [{ id: "a", cac: 20, purchases: 2 }]);
});
