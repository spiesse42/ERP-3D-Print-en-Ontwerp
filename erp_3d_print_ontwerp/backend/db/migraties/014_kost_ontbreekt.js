// ═══════════════════════════════════════════════════════════════════════
// Migratie 014 — wat ontbrak in de productiekost (25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Bij een onvolledige productiekost bewaren WAT er ontbrak (bv. "inkoopprijs
// filament eSUN PLA"), zodat Marges en het dossier het kunnen tonen en je na
// het aanvullen de kost kunt herberekenen.
export const versie = 14;
export const naam = 'printopdrachten.kost_ontbreekt';

export function up(db) {
  db.exec(`ALTER TABLE printopdrachten ADD COLUMN kost_ontbreekt TEXT;`);
}
