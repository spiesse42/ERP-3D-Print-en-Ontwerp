// 26-11: een grote losse gcode (honderden MB) hoeft niet volledig naar het
// ERP: printtijd, grammen, kleuren en het voorbeeldbeeld staan in de kop en
// de staart (Bambu/Orca/Prusa). De backend leest ook enkel de eerste en
// laatste 4 MB. We sturen dus enkel die stukken door: snel en geen limiet.
// Een geslicet 3mf (zip) gaat wel volledig (gecomprimeerd, meestal klein).
export const MAX_SLICER_MB = 200;     // limiet voor upload en bijlage (backend)
const STUK = 4 * 1024 * 1024;

export const isGcode = b => /\.(gcode|gco|g)$/i.test(b?.name || '');
export const teGrootOmTeBewaren = b => !!b && b.size > MAX_SLICER_MB * 1024 * 1024;

export function slicerVoorUpload(bestand) {
  if (!bestand || !isGcode(bestand) || bestand.size <= 4 * STUK) return bestand;
  return new File([bestand.slice(0, STUK), '\n', bestand.slice(bestand.size - STUK)], bestand.name, { type: 'text/plain' });
}
