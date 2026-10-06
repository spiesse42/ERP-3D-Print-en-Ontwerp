// ═══════════════════════════════════════════════════════════════════════
// Migratie 027 — webshopproducten + onderdelen per stuk (06-10)
// ═══════════════════════════════════════════════════════════════════════
// artikelen.webshop_slug / webshop_variant: koppeling met het product in de
//   webshop (Sanity: slug + label van de maatvariant). Uniek per combinatie.
// artikelen.webshop_foto / webshop_gewicht_g / webshop_bijgewerkt_op: wat bij
//   het ophalen uit de webshop meekwam (foto-URL, gewicht van het stuk).
// artikel_onderdelen: wat er per verkocht stuk mee de deur uitgaat (bv. een
//   sleutelring of een zakje). Wordt afgeboekt bij de verkoop.
export const versie = 27;
export const naam = 'artikelen.webshop_* + artikel_onderdelen';

export function up(db) {
  db.exec(`
    ALTER TABLE artikelen ADD COLUMN webshop_slug TEXT;
    ALTER TABLE artikelen ADD COLUMN webshop_variant TEXT;
    ALTER TABLE artikelen ADD COLUMN webshop_foto TEXT;
    ALTER TABLE artikelen ADD COLUMN webshop_gewicht_g REAL;
    ALTER TABLE artikelen ADD COLUMN webshop_bijgewerkt_op TEXT;
    CREATE UNIQUE INDEX uq_artikelen_webshop ON artikelen(webshop_slug, COALESCE(webshop_variant, '')) WHERE webshop_slug IS NOT NULL;
    CREATE TABLE artikel_onderdelen (
      artikel_id   INTEGER NOT NULL REFERENCES artikelen(id) ON DELETE CASCADE,
      onderdeel_id INTEGER NOT NULL REFERENCES artikelen(id),
      aantal       REAL NOT NULL CHECK (aantal > 0),
      volgorde     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (artikel_id, onderdeel_id),
      CHECK (artikel_id <> onderdeel_id)
    );
  `);
}
