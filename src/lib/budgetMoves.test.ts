import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetMoves } from "./budgetMoves";
import { validate } from "./validation";

// Bebés: CAC de escalado 6 €, de validación 12 €; Google y Meta a 5 €/día cada una.
const g = { id: "g", channel: "google", dailyBudget: 5, totalCap: 150 };
const m = { id: "m", channel: "meta", dailyBudget: 5, totalCap: 150 };
const metric = (cost: number) => [{ cost, impressions: 0, clicks: 0, conversions: 0, purchases: 0 }];
const sale = (channel: string) => ({ channel, amount: 49 });
const run = (gCost: number, mCost: number, sales: { channel: string; amount: number }[], live = [g, m]) => {
  const b = { cacCap: 6, cacTest: 12 };
  const v = validate({ ...b, campaigns: [{ channel: "google", metrics: metric(gCost) }, { channel: "meta", metrics: metric(mCost) }], sales });
  return budgetMoves(b, v, live);
};

test("sin datos: ninguna propuesta", () => {
  assert.deepEqual(run(3, 3, []), []);
});

test("Google vende barato y Meta el triple de caro: pasar el 30 % de Meta a Google", () => {
  // Google 8 € / 2 ventas = 4 €; Meta 11 € / 1 venta = 11 € (> 2 × 4).
  const r = run(8, 11, [sale("google"), sale("google"), sale("meta")]);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, "MOVE_BUDGET");
  assert.equal(r[0].campaignId, "m");
  assert.deepEqual(r[0].payload, { toCampaignId: "g", amount: 1.5 });
});

test("un canal sin ventas tras 1 CAC de validación también cede presupuesto", () => {
  const r = run(10, 13, [sale("google"), sale("google"), sale("google")]);
  assert.equal(r[0].kind, "MOVE_BUDGET");
  assert.equal(r[0].campaignId, "m");
});

test("los dos canales parecidos: no mover", () => {
  assert.deepEqual(run(10, 6, [sale("google"), sale("google"), sale("meta")]).filter((x) => x.kind === "MOVE_BUDGET"), []);
});

test("veredicto Escalar con un solo canal: +25 % en ese canal", () => {
  const r = run(0, 15, [sale("meta"), sale("meta"), sale("meta")], [m]);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, "SET_BUDGET");
  assert.equal(r[0].campaignId, "m");
  assert.deepEqual(r[0].payload, { dailyBudget: 6.5, totalCap: 187.5 });
});

test("veredicto Parar: proponer pausar todas sus campañas", () => {
  const r = run(20, 20, []);
  assert.deepEqual(r.map((x) => [x.kind, x.campaignId]), [["PAUSE_CAMPAIGN", "g"], ["PAUSE_CAMPAIGN", "m"]]);
});
