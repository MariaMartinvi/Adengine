// Países de una ficha: uno («ES») o varios («US,PR»). Sin ninguno válido, España.
export const countriesOf = (country: string): string[] => {
  const list = Array.from(new Set((country || "").toUpperCase().split(/[^A-Z]+/).filter((c) => c.length === 2)));
  return list.length ? list : ["ES"];
};

// En EE. UU. la mayoría no habla español: los anuncios en español van solo a quien usa Facebook/Instagram en español.
export const needsSpanishLocale = (country: string) => countriesOf(country).includes("US");
