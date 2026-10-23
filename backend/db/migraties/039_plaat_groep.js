// Migratie 039 — samen op één plaat (23-10): meerdere printopdrachten (bv. 8
// verschillende producten) die samen op één plaat geprint worden. Alle leden
// krijgen plaat_groep = de id van de eerste ("trekker"); de runs hangen aan
// die trekker en gelden voor de hele groep. Kost wordt verdeeld naar gewicht.
export const versie = 39;
export const naam = 'printopdrachten.plaat_groep';
export function up(db) {
  db.exec(`ALTER TABLE printopdrachten ADD COLUMN plaat_groep INTEGER;
    CREATE INDEX idx_printopdrachten_plaat_groep ON printopdrachten(plaat_groep);`);
}
