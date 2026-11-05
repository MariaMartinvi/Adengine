import { test } from "node:test";
import assert from "node:assert/strict";
import { adDayRow } from "./meta/ads";

test("fila de Meta: clics, visitas a la página, pagos iniciados y compras", () => {
  const r = adDayRow({ ad_id: "1", date_start: "2026-11-04", impressions: "1000", inline_link_clicks: "20", spend: "4.5",
    actions: [{ action_type: "landing_page_view", value: "15" }, { action_type: "omni_landing_page_view", value: "16" }, { action_type: "offsite_conversion.fb_pixel_initiate_checkout", value: "3" }, { action_type: "omni_purchase", value: "1" }],
    action_values: [{ action_type: "omni_purchase", value: "39" }] });
  assert.deepEqual(r, { adId: "1", date: "2026-11-04", impressions: 1000, clicks: 20, visits: 16, cost: 4.5, conversions: 3, purchases: 1, purchaseValue: 39 });
});

test("sin acciones: todo a cero", () => {
  const r = adDayRow({ ad_id: "2", date_start: "2026-11-04" });
  assert.equal(r.visits, 0); assert.equal(r.purchases, 0);
});
