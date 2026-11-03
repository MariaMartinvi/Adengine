// Ventas a Google Ads por la Data Manager API (la API de Google Ads ya no acepta subidas de clics de integraciones nuevas).
import { accessToken } from "./auth";

// Una venta atribuida a un clic (gclid) en la acción de conversión "Venta · negocio" (tipo importar desde clics).
// validateOnly: Google la comprueba sin apuntarla.
export async function sendClickConversion(cid: string, conversionActionId: string, p: { gclid: string; value: number; currency: string; orderId: string; when: Date }, validateOnly = false) {
  const login = process.env.GOOGLE_LOGIN_CUSTOMER_ID!.replace(/-/g, "");
  const r = await fetch("https://datamanager.googleapis.com/v1/events:ingest", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      destinations: [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: cid }, loginAccount: { accountType: "GOOGLE_ADS", accountId: login }, productDestinationId: conversionActionId }],
      events: [{ adIdentifiers: { gclid: p.gclid }, conversionValue: p.value, currency: p.currency, eventTimestamp: p.when.toISOString(), transactionId: p.orderId, eventSource: "WEB" }],
      validateOnly,
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Data Manager (${r.status}): ${j.error?.message || JSON.stringify(j).slice(0, 300)}`);
  return j;
}
