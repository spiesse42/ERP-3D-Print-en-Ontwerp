// Migratie 028 — webshopbestellingen (07-10): betaalde bestellingen uit de
// webshop (Supabase), opgehaald door het ERP. verkopen.webshop_bestelling =
// de bestelling waarvoor de verkoop gemaakt werd.
export const versie = 28;
export const naam = 'webshop_bestellingen + verkopen.webshop_bestelling';

export function up(db) {
  db.exec(`
    CREATE TABLE webshop_bestellingen (
      id              TEXT PRIMARY KEY,
      besteld_op      TEXT NOT NULL,
      status          TEXT NOT NULL,
      klant_naam      TEXT,
      email           TEXT,
      telefoon        TEXT,
      adres           TEXT,
      opmerking       TEXT,
      items           TEXT NOT NULL,
      totaal          REAL NOT NULL DEFAULT 0,
      verzending      TEXT,
      verzendkost     REAL NOT NULL DEFAULT 0,
      tracking_url    TEXT,
      opgehaald_op    TEXT NOT NULL DEFAULT (datetime('now')),
      afgehandeld_op  TEXT
    );
    ALTER TABLE verkopen ADD COLUMN webshop_bestelling TEXT REFERENCES webshop_bestellingen(id);
  `);
}
