import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRsaTexts } from "./rsaTexts";

const H = ["Cuadros de la Virgen María", "Cuadros modernos de la Virgen", "Pintura Virgen María en lienzo"];
const D = ["Cuadros de la Virgen María hechos con devoción. Un recordatorio diario en tu pared.", "Impresos en España."];

test("textos válidos: se limpian los espacios", () => {
  assert.deepEqual(checkRsaTexts([" " + H[0] + " ", ...H.slice(1), ""], D), { headlines: H, descriptions: D });
});

test("titular de más de 30 caracteres o descripción de más de 90: error", () => {
  assert.throws(() => checkRsaTexts([...H, "x".repeat(31)], D), /30 caracteres/);
  assert.throws(() => checkRsaTexts(H, [...D, "y".repeat(91)]), /90 caracteres/);
});

test("pocos o demasiados textos, o repetidos: error", () => {
  assert.throws(() => checkRsaTexts(H.slice(0, 2), D), /3 y 15/);
  assert.throws(() => checkRsaTexts(H, D.slice(0, 1)), /2 y 4/);
  assert.throws(() => checkRsaTexts([...H, H[0].toLowerCase()], D), /repetido/);
});
