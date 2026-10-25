// Migratie 040 — webshopbestelling → klantdossier (25-10): een bestelling
// met iets om te printen (bv. gepersonaliseerd) krijgt een klantdossier met
// de printregels. De bestelling onthoudt dat dossier en welke lijnen erin
// zitten (de rest kan gewoon uit voorraad verkocht worden).
export const versie = 40;
export const naam = 'webshop_bestellingen.dossier_id + dossier_items';
export function up(db) {
  db.exec(`ALTER TABLE webshop_bestellingen ADD COLUMN dossier_id INTEGER REFERENCES dossiers(id) ON DELETE SET NULL;
    ALTER TABLE webshop_bestellingen ADD COLUMN dossier_items TEXT;`);
}
