// ═══════════════════════════════════════════════════════════════════════
// Migratie 015 — bestelnummer van de webshop op een aankoop (25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Bestelbon inlezen → aankoop "besteld" met het bestelnummer van de webshop.
// De factuur die later komt, wordt via dat nummer aan dezelfde aankoop
// gekoppeld (geen dubbele aankoop). Uitsluitend intern, zoals het
// factuurnummer van de leverancier.
export const versie = 15;
export const naam = 'aankopen.extern_bestelnummer';

export function up(db) {
  db.exec(`
    ALTER TABLE aankopen ADD COLUMN extern_bestelnummer TEXT;
    CREATE INDEX IF NOT EXISTS idx_aankopen_bestelnummer ON aankopen(extern_bestelnummer);
  `);
}
