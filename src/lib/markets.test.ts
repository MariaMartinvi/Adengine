import { test } from "node:test";
import assert from "node:assert/strict";
import { countriesOf, needsSpanishLocale } from "./markets";

test("una ficha puede tener uno o varios países", () => {
  assert.deepEqual(countriesOf("ES"), ["ES"]);
  assert.deepEqual(countriesOf("us, pr"), ["US", "PR"]);
  assert.deepEqual(countriesOf("US,PR,US"), ["US", "PR"]);
  assert.deepEqual(countriesOf(""), ["ES"]);
});

test("solo en EE. UU. hace falta pedir que hablen español", () => {
  assert.equal(needsSpanishLocale("US,PR"), true);
  assert.equal(needsSpanishLocale("MX"), false);
  assert.equal(needsSpanishLocale("ES"), false);
});
