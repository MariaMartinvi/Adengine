// Presupuesto mensual de la cartera frente a lo comprometido (diarios de las campañas activas) y lo gastado este mes.
import { db } from "./db";

export const DAYS = 30.4;

export async function monthlyBudget(): Promise<number | null> {
  const s = await db.setting.findUnique({ where: { key: "monthlyBudget" } });
  return s && Number(s.value) > 0 ? Number(s.value) : null;
}

export async function portfolio() {
  const monthly = await monthlyBudget();
  const live = await db.campaign.findMany({ where: { status: "ENABLED", OR: [{ googleCampaignId: { not: null } }, { metaCampaignId: { not: null } }] }, select: { dailyBudget: true } });
  const committed = live.reduce((s, c) => s + c.dailyBudget, 0) * DAYS;
  const first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0);
  const spent = (await db.dailyMetric.aggregate({ where: { date: { gte: first } }, _sum: { cost: true } }))._sum.cost || 0;
  return { monthly, committed, spent, room: monthly == null ? null : monthly - committed };
}
