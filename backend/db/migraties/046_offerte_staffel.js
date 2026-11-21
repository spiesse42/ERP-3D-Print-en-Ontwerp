// Migratie 046 (21-11): prijs per aantal (staffel) op een offerte:
// JSON { regel_id, aantallen: [50, 100, 200] } — indicatief, voor één printregel.
export const versie = 46;
export const naam = 'offertes: prijs per aantal (staffel)';
export function up(db) {
  db.exec('ALTER TABLE offertes ADD COLUMN staffel TEXT;');
}
