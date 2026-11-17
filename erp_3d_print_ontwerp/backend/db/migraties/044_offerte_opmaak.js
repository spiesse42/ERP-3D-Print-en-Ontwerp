// Migratie 044 (17-11): opmaak van een offerte.
// - een_regel: omschrijving waaronder alle printregels als één regel op de
//   offerte komen (bv. "Beeld Sainte Geneviève, 3 delen"); ontwerp, afwerking,
//   artikels… blijven apart. Het totaal blijft gelijk.
// - fotos: JSON-lijst met id's van foto-bijlagen van het dossier, groot op
//   een aparte laatste pagina "Beelden".
export const versie = 44;
export const naam = 'offertes: printregels als één regel en foto-pagina';
export function up(db) {
  db.exec(`ALTER TABLE offertes ADD COLUMN een_regel TEXT;
    ALTER TABLE offertes ADD COLUMN fotos TEXT;`);
}
