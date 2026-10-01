// Adaptador de Meta (Facebook + Instagram) sobre la Marketing API. No hay nada de Meta fuera de esta carpeta.
// Acceso con el token de un usuario del sistema del porfolio (no caduca): META_ACCESS_TOKEN.

const BASE = () => `https://graph.facebook.com/${process.env.META_API_VERSION || "v26.0"}`;
export const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

async function call(path: string, params: Record<string, unknown> = {}, method: "GET" | "POST" = "GET") {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("Falta META_ACCESS_TOKEN.");
  const qs = new URLSearchParams({ access_token: token });
  for (const [k, v] of Object.entries(params)) qs.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const r = method === "GET"
    ? await fetch(`${BASE()}${path}?${qs}`)
    : await fetch(`${BASE()}${path}`, { method, body: qs });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Meta (${r.status}): ${j.error?.error_user_msg || j.error?.message || "error desconocido"}`);
  return j;
}

export async function listAdAccounts(): Promise<{ id: string; name: string; currency: string }[]> {
  const j = await call("/me/adaccounts", { fields: "account_id,name,currency" });
  return (j.data || []).map((a: any) => ({ id: a.account_id, name: a.name, currency: a.currency }));
}

export async function listPixels(adAccountId: string): Promise<{ id: string; name: string }[]> {
  const j = await call(`/${act(adAccountId)}/adspixels`, { fields: "id,name" });
  return (j.data || []).map((p: any) => ({ id: p.id, name: p.name }));
}
