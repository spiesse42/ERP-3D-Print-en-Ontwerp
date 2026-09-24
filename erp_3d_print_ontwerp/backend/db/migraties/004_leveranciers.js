// ═══════════════════════════════════════════════════════════════════════
// Migratie 004 — leveranciersgegevens (stap 3b, 24-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Het volledige leveranciersscherm heeft een paar extra velden nodig.
// Enkel kolommen erbij, geen herbouw. De aankopen zelf stonden al klaar in
// migratie 001 (één document van bestelling tot ontvangst, status afgeleid).

export const versie = 4;
export const naam = 'leveranciers: telefoon, btw-nummer, klantnummer';

export function up(db) {
  db.exec(`
    ALTER TABLE leveranciers ADD COLUMN telefoon TEXT;
    ALTER TABLE leveranciers ADD COLUMN btw_nummer TEXT;
    ALTER TABLE leveranciers ADD COLUMN klantnummer TEXT;   -- ons klantnummer bij die leverancier
    CREATE INDEX idx_aankopen_leverancier ON aankopen(leverancier_id);
  `);
}
