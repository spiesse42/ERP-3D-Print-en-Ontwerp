// ═══════════════════════════════════════════════════════════════════════
// Migratie 020 — afbeelding per dossierregel (28-09)
// ═══════════════════════════════════════════════════════════════════════
// Een kleine afbeelding (data-URI, verkleind in de browser) bij een regel,
// bv. de plaat uit het slicerbestand. Komt op de offerte en de werkbon, zodat
// de klant ziet wat er geprint wordt. Klein gehouden (max. ± 300 kB): de
// volledige foto's staan als bijlage bij het dossier.
export const versie = 20;
export const naam = 'dossier_regels.afbeelding (kleine afbeelding voor offerte/werkbon)';

export function up(db) {
  db.exec('ALTER TABLE dossier_regels ADD COLUMN afbeelding TEXT');
}
