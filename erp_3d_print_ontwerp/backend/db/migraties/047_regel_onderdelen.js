// Migratie 047 (21-11): onderdelen per stuk op een printregel zelf (bv. 1
// sleutelring per sleutelhanger), JSON [{ artikel_id, aantal }]. Zit in de
// prijs van de printregel (geen aparte regel op de offerte) en wordt bij de
// levering uit voorraad geboekt, net als de onderdelen van een product.
export const versie = 47;
export const naam = 'dossierregels: onderdelen per stuk';
export function up(db) {
  db.exec('ALTER TABLE dossier_regels ADD COLUMN onderdelen TEXT;');
}
