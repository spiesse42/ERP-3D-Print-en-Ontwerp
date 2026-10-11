// Migratie 032 — webshopvelden beheerd in het ERP (11-10).
// artikelen.webshop_data: JSON met de velden die het ERP naar Sanity pusht
//   (beschrijving, categorie, foto's, vinkjes, kleuren, gewicht, …)
// artikelen.webshop_sanity_id: _id van het product in Sanity
// artikelen.webshop_sanity_rev: _updatedAt na de laatste push (om te zien of
//   iemand het product intussen in Sanity wijzigde)
// artikelen.webshop_gepusht_op: tijdstip van de laatste push
export const versie = 32;
export const naam = 'artikelen.webshop_data + sanity-koppeling';

export function up(db) {
  db.exec(`
    ALTER TABLE artikelen ADD COLUMN webshop_data TEXT;
    ALTER TABLE artikelen ADD COLUMN webshop_sanity_id TEXT;
    ALTER TABLE artikelen ADD COLUMN webshop_sanity_rev TEXT;
    ALTER TABLE artikelen ADD COLUMN webshop_gepusht_op TEXT;
  `);
}
