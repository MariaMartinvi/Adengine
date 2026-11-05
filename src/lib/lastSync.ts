import { db } from "./db";
// «Datos actualizados: jue 5 nov, 17:02» en hora de España (la sincronización corre a las 07:00 y 17:00 en invierno).
export async function lastSyncText() {
  const s = await db.setting.findUnique({ where: { key: "lastSync" } });
  if (!s) return "Datos sin actualizar todavía";
  return "Datos actualizados: " + new Date(s.value).toLocaleString("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
