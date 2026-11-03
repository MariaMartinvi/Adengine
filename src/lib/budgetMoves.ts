// Reparto del dinero de un negocio, con sus ventas reales. Solo propone (María aprueba):
// · Parar → pausar sus campañas. · Entre Google y Meta: con ≥ 3 ventas, si un canal vende con CAC ≤ escalado y el otro
//   cuesta más del doble (o no vende tras 1 CAC de validación) → pasar el 30 % del diario del peor al mejor.
// · Escalar (y nada que mover) → +25 % de diario en el mejor canal, con el tope total en proporción.
import type { validate } from "./validation";

type Live = { id: string; channel: string; dailyBudget: number; totalCap: number };
export type BudgetMove = { campaignId: string; kind: "MOVE_BUDGET" | "SET_BUDGET" | "PAUSE_CAMPAIGN"; payload: Record<string, unknown>; reason: string };

const half = (n: number) => Math.round(n * 2) / 2; // importes a medio euro
const ch = (c: string) => (c === "meta" ? "meta" : "google");
const name = (c: string) => (ch(c) === "meta" ? "Meta" : "Google");

export function budgetMoves(b: { cacCap: number; cacTest?: number | null }, v: ReturnType<typeof validate>, live: Live[]): BudgetMove[] {
  if (!live.length) return [];
  if (v.verdict.code === "parar") return live.map((c) => ({ campaignId: c.id, kind: "PAUSE_CAMPAIGN", payload: {}, reason: `Pausar ${name(c.channel)}: ${v.verdict.reason}` }));

  const by = (c: Live) => v.byChannel[ch(c.channel)];
  const gl = live.find((c) => ch(c.channel) === "google"), mt = live.find((c) => ch(c.channel) === "meta");
  if (gl && mt && v.sales.ads >= 3) {
    for (const [good, bad] of [[gl, mt], [mt, gl]] as const) {
      const G = by(good), B = by(bad);
      const worse = B.cac != null ? B.cac > 2 * G.cac! : B.spend >= v.cacTest;
      if (G.cac != null && G.cac <= b.cacCap && worse) {
        const amount = half(0.3 * bad.dailyBudget);
        if (amount > 0) return [{ campaignId: bad.id, kind: "MOVE_BUDGET", payload: { toCampaignId: good.id, amount }, reason:
          `Pasar ${amount} €/día de ${name(bad.channel)} a ${name(good.channel)}: ${name(good.channel)} vende a ${G.cac.toFixed(2)} € y ${name(bad.channel)} ${B.cac != null ? `a ${B.cac.toFixed(2)} €` : `no vende tras ${B.spend.toFixed(2)} €`}. El total del negocio no cambia.` }];
      }
    }
  }

  if (v.verdict.code === "escalar") {
    const best = [...live].filter((c) => by(c).cac != null).sort((x, y) => by(x).cac! - by(y).cac!)[0];
    if (best) return [{ campaignId: best.id, kind: "SET_BUDGET", payload: { dailyBudget: half(best.dailyBudget * 1.25), totalCap: half(best.totalCap * 1.25) }, reason:
      `Subir ${name(best.channel)} un 25 % (${best.dailyBudget} → ${half(best.dailyBudget * 1.25)} €/día): ${v.verdict.reason}` }];
  }
  return [];
}
