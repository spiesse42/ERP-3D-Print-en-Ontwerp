// Migratie 038 — artikel uit meerdere platen (21-10): de printregels van de
// andere platen (niet de laatste, die het eindproduct naar voorraad boekt)
// onthouden voor welk artikel ze zijn, zodat de gemeten productiekost alle
// platen meetelt.
export const versie = 38;
export const naam = 'dossier_regels.plaat_van';
export function up(db) { db.exec('ALTER TABLE dossier_regels ADD COLUMN plaat_van INTEGER REFERENCES artikelen(id)'); }
