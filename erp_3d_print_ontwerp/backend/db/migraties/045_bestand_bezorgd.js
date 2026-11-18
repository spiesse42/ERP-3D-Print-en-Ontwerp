// Migratie 045 (18-11): digitaal ontwerp (dossier met enkel ontwerp/
// aanpassing, niets fysieks te leveren). Afrekenen kan pas als het bestand
// bezorgd is: gemaild vanuit het ERP of met de hand aangeduid (WeTransfer…).
export const versie = 45;
export const naam = 'dossiers: digitaal bestand bezorgd';
export function up(db) {
  db.exec(`ALTER TABLE dossiers ADD COLUMN bezorgd_op TEXT;
    ALTER TABLE dossiers ADD COLUMN bezorgd_hoe TEXT;`);
}
