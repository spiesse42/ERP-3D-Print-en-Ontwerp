// ═══════════════════════════════════════════════════════════════════════
// Migratie 013 — "Gratis geleverd" (25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Een klantopdracht die de klant krijgt zonder te betalen (goodwill, test,
// eigen fout …). Geen afrekening in Accountable, geen omzet, wel zichtbaar in
// Marges (kost tegenover € 0) en in het Financiën-overzicht.
// Aparte kolommen i.p.v. een extra soort afrekening: zo blijven omzet,
// drempels, opvolging en de Accountable-import ongewijzigd, en kan een oudere
// versie van het ERP de databank nog lezen.
export const versie = 13;
export const naam = 'gratis geleverd (gratis_op, gratis_waarde)';

export function up(db) {
  db.exec(`
    ALTER TABLE dossiers ADD COLUMN gratis_op TEXT;
    ALTER TABLE dossiers ADD COLUMN gratis_waarde REAL;
  `);
}
