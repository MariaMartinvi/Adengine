import { test } from "node:test";
import assert from "node:assert/strict";
import { groupsWithoutAd } from "./googleGroups";

test("descartar el único anuncio de un grupo con palabras lo deja sin anuncio", () => {
  const kws = [{ adGroup: "Copilot", included: true }, { adGroup: "Agencias", included: true }];
  const ads = [{ adGroup: "Copilot", included: true }, { adGroup: "Agencias", included: false }];
  assert.deepEqual(groupsWithoutAd(kws, ads), ["Agencias"]);
});

test("si las palabras del grupo también se quitan, no hay problema", () => {
  const kws = [{ adGroup: "Copilot", included: true }, { adGroup: "Agencias", included: false }];
  const ads = [{ adGroup: "Copilot", included: true }, { adGroup: "Agencias", included: false }];
  assert.deepEqual(groupsWithoutAd(kws, ads), []);
});

test("sin grupo cuenta como «Grupo 1»", () => {
  assert.deepEqual(groupsWithoutAd([{ included: true }], [{ adGroup: null, included: true }]), []);
  assert.deepEqual(groupsWithoutAd([{ included: true }], [{ included: false }]), ["Grupo 1"]);
});
