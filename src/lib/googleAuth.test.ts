import { test } from "node:test";
import assert from "node:assert/strict";

test("conexión de Google: detecta que falta el permiso de Google Ads", async () => {
  const { missingAdsScope } = await import("./google/auth");
  assert.equal(missingAdsScope("https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/datamanager openid"), false);
  assert.equal(missingAdsScope("https://www.googleapis.com/auth/userinfo.email openid"), true);
  assert.equal(missingAdsScope(""), true);
});

// En la tarea programada (ruta GET), Next.js 14 guarda en su caché permanente los fetch: el token de Google
// salía siempre el mismo, ya caducado, y la sincronización de las 06:00/16:00 daba 401 (12-14 nov).
test("token de Google: se pide sin caché y la tarea programada no cachea fetch", async () => {
  process.env.ENCRYPTION_KEY = "11".repeat(32);
  const { encrypt } = await import("./crypto");
  const { db } = await import("./db");
  (db as any).googleConnection = { findFirst: async () => ({ refreshTokenEnc: encrypt("rt") }) };
  let init: any;
  (globalThis as any).fetch = async (_url: string, i: any) => { init = i; return new Response(JSON.stringify({ access_token: "a", expires_in: 3600 })); };
  const { accessToken } = await import("./google/auth");
  assert.equal(await accessToken(), "a");
  assert.equal(init.cache, "no-store");
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../app/api/cron/sync/route.ts", import.meta.url), "utf8"), /export const fetchCache = "force-no-store"/);
});
