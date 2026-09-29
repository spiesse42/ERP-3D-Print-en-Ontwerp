// ═══════════════════════════════════════════════════════════════════════
// Migratie 023 — factuur door het ERP (29-09)
// ═══════════════════════════════════════════════════════════════════════
// Het ERP maakt nu ook de factuur (reeks "Factuur 2026-004"), mailt ze naar
// Accountable en optioneel naar de klant. De vervaldatum staat op de factuur
// en telt voor de opvolging van onbetaalde facturen.
// klanten.land (ISO-code, leeg = België): adres op de factuur en Peppol-ID
// opzoeken voor buitenlandse klanten.
export const versie = 23;
export const naam = 'dossiers.afrekening_vervaldatum + klanten.land (factuur door het ERP)';

export function up(db) {
  db.exec(`
    ALTER TABLE dossiers ADD COLUMN afrekening_vervaldatum TEXT;
    ALTER TABLE klanten ADD COLUMN land TEXT;
  `);
}
