// Países de una ficha: uno («ES») o varios («US,PR»). Sin ninguno válido, España.
export const countriesOf = (country: string): string[] => {
  const list = Array.from(new Set((country || "").toUpperCase().split(/[^A-Z]+/).filter((c) => c.length === 2)));
  return list.length ? list : ["ES"];
};

// En EE. UU. la mayoría no habla español: los anuncios en español van solo a quien usa Facebook/Instagram en español.
export const needsSpanishLocale = (country: string) => countriesOf(country).includes("US");

// Nombre de un idioma de Meta que es español. Meta puede devolverlos en el idioma de la cuenta («Español (España)»).
export const isSpanishLocale = (name: string) => /^(spanish|español)/i.test((name || "").trim());

// Qué zonas añadir y quitar para que una campaña quede exactamente con las que se quieren.
export const locationChanges = (have: string[], want: string[]) => ({
  add: want.filter((w) => !have.includes(w)),
  remove: have.filter((h) => !want.includes(h)),
});
