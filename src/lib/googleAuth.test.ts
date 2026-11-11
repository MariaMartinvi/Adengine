import { test } from "node:test";
import assert from "node:assert/strict";

test("conexión de Google: detecta que falta el permiso de Google Ads", async () => {
  const { missingAdsScope } = await import("./google/auth");
  assert.equal(missingAdsScope("https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/datamanager openid"), false);
  assert.equal(missingAdsScope("https://www.googleapis.com/auth/userinfo.email openid"), true);
  assert.equal(missingAdsScope(""), true);
});
