// ═══════════════════════════════════════════════════════════════════════
// Migratie 003 — catalogus naar analogie met Odoo (stap 3a, 24-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist op 24-09 (claude/domeinmodel-v2.md, "Vijf aanpassingen"):
//
// 1. De vaste `soort` (filament/onderdeel/eindproduct/dienst) wordt:
//    - type:  filament / artikel / dienst  (bepaalt het gedrag)
//    - vinkjes: wordt_gekocht, wordt_verkocht, zelf_geprint
//    - categorie_id: vrije boom (tabel categorieen), enkel om te ordenen.
//    Omzetting van bestaande rijen:
//      filament    → filament, gekocht
//      onderdeel   → artikel, gekocht (+ verkocht als er een verkoopprijs is)
//      eindproduct → artikel, zelf geprint + verkocht
//      dienst      → dienst, verkocht
// 2. artikel_leveranciers: leverancier + diens productcode/omschrijving,
//    laatste prijs, levertijd (voor OCR-herkenning en "te bestellen").
// 3. Minimum én maximum per artikel; voor filament ook max_rollen op de
//    prijsgroep (het artikel kan per kleur overschrijven).
// 5. Rolgewicht per prijsgroep (standaard 1000 g) → kostprijs per kg.
// (4. Voorraadtelling heeft geen eigen tabel nodig: correcties.)
//
// SQLite kan CHECK-regels niet wijzigen, dus de tabel artikelen wordt
// herbouwd (zelfde id's). Andere tabellen verwijzen ernaar, daarom
// `fkUit = true` (zie db/index.js).

export const versie = 3;
export const naam = 'catalogus: type + vinkjes + categorieën, leveranciersgegevens, min/max, rolgewicht';
export const fkUit = true;

export function up(db) {
  db.exec(`
    CREATE TABLE categorieen (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      naam          TEXT NOT NULL,
      ouder_id      INTEGER REFERENCES categorieen(id),
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (ouder_id IS NULL OR ouder_id <> id)
    );
    CREATE UNIQUE INDEX uq_categorieen_naam ON categorieen(COALESCE(ouder_id, 0), naam COLLATE NOCASE);

    INSERT INTO categorieen (naam) VALUES ('Filament'), ('Onderdelen'), ('Eindproducten'), ('Diensten');

    ALTER TABLE filament_types ADD COLUMN max_rollen INTEGER CHECK (max_rollen IS NULL OR max_rollen >= 0);
    ALTER TABLE filament_types ADD COLUMN rolgewicht_g REAL NOT NULL DEFAULT 1000 CHECK (rolgewicht_g > 0);

    CREATE TABLE artikelen_nieuw (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      type             TEXT NOT NULL CHECK (type IN ('filament','artikel','dienst')),
      wordt_gekocht    INTEGER NOT NULL DEFAULT 0 CHECK (wordt_gekocht IN (0,1)),
      wordt_verkocht   INTEGER NOT NULL DEFAULT 0 CHECK (wordt_verkocht IN (0,1)),
      zelf_geprint     INTEGER NOT NULL DEFAULT 0 CHECK (zelf_geprint IN (0,1)),
      categorie_id     INTEGER REFERENCES categorieen(id),
      naam             TEXT,
      filament_type_id INTEGER REFERENCES filament_types(id),
      kleur_id         INTEGER REFERENCES filament_kleuren(id),
      eenheid          TEXT NOT NULL DEFAULT 'stuks',
      verkoopprijs     REAL CHECK (verkoopprijs IS NULL OR verkoopprijs >= 0),
      inkoopprijs      REAL CHECK (inkoopprijs IS NULL OR inkoopprijs >= 0),
      marge_pct        REAL CHECK (marge_pct IS NULL OR marge_pct >= 0),
      productieprijs   REAL CHECK (productieprijs IS NULL OR productieprijs >= 0),
      vaste_prijs      INTEGER NOT NULL DEFAULT 0 CHECK (vaste_prijs IN (0,1)),
      min_voorraad     REAL CHECK (min_voorraad IS NULL OR min_voorraad >= 0),
      max_voorraad     REAL CHECK (max_voorraad IS NULL OR max_voorraad >= 0),
      locatie          TEXT,
      notities         TEXT,
      gearchiveerd     INTEGER NOT NULL DEFAULT 0 CHECK (gearchiveerd IN (0,1)),
      aangemaakt_op    TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (min_voorraad IS NULL OR max_voorraad IS NULL OR max_voorraad >= min_voorraad),
      CHECK (
        (type = 'filament' AND filament_type_id IS NOT NULL AND kleur_id IS NOT NULL AND naam IS NULL
                           AND wordt_gekocht = 1 AND zelf_geprint = 0)
        OR (type = 'artikel' AND filament_type_id IS NULL AND kleur_id IS NULL AND naam IS NOT NULL
                           AND (wordt_gekocht = 1 OR zelf_geprint = 1))
        OR (type = 'dienst'  AND filament_type_id IS NULL AND kleur_id IS NULL AND naam IS NOT NULL
                           AND zelf_geprint = 0 AND (wordt_gekocht = 1 OR wordt_verkocht = 1)
                           AND min_voorraad IS NULL AND max_voorraad IS NULL)
      )
    );

    INSERT INTO artikelen_nieuw (id, type, wordt_gekocht, wordt_verkocht, zelf_geprint, categorie_id,
        naam, filament_type_id, kleur_id, eenheid, verkoopprijs, inkoopprijs, marge_pct, productieprijs,
        vaste_prijs, min_voorraad, max_voorraad, locatie, notities, gearchiveerd, aangemaakt_op)
      SELECT id,
        CASE soort WHEN 'filament' THEN 'filament' WHEN 'dienst' THEN 'dienst' ELSE 'artikel' END,
        CASE soort WHEN 'filament' THEN 1 WHEN 'onderdeel' THEN 1 ELSE 0 END,
        CASE soort WHEN 'eindproduct' THEN 1 WHEN 'dienst' THEN 1
                   WHEN 'onderdeel' THEN (verkoopprijs IS NOT NULL) ELSE 0 END,
        CASE soort WHEN 'eindproduct' THEN 1 ELSE 0 END,
        (SELECT c.id FROM categorieen c WHERE c.ouder_id IS NULL AND c.naam =
           CASE soort WHEN 'filament' THEN 'Filament' WHEN 'onderdeel' THEN 'Onderdelen'
                      WHEN 'eindproduct' THEN 'Eindproducten' ELSE 'Diensten' END),
        CASE soort WHEN 'filament' THEN NULL ELSE naam END,
        filament_type_id, kleur_id, eenheid, verkoopprijs, inkoopprijs, marge_pct, productieprijs,
        vaste_prijs,
        CASE soort WHEN 'dienst' THEN NULL ELSE min_voorraad END,
        NULL, locatie, notities, gearchiveerd, aangemaakt_op
      FROM artikelen;

    DROP TABLE artikelen;
    ALTER TABLE artikelen_nieuw RENAME TO artikelen;
    CREATE UNIQUE INDEX uq_artikelen_filament ON artikelen(filament_type_id, kleur_id) WHERE type = 'filament';
    CREATE UNIQUE INDEX uq_artikelen_naam ON artikelen(naam COLLATE NOCASE) WHERE type <> 'filament';
    CREATE INDEX idx_artikelen_categorie ON artikelen(categorie_id);

    -- Wat een leverancier over een artikel weet. De productcode (of anders de
    -- omschrijving) van de leverancier is hoe de OCR een factuurregel later
    -- herkent. Eén code wijst bij een leverancier altijd naar één artikel.
    CREATE TABLE artikel_leveranciers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      artikel_id      INTEGER NOT NULL REFERENCES artikelen(id) ON DELETE CASCADE,
      leverancier_id  INTEGER NOT NULL REFERENCES leveranciers(id),
      productcode     TEXT,
      omschrijving    TEXT,
      laatste_prijs   REAL CHECK (laatste_prijs IS NULL OR laatste_prijs >= 0),
      levertijd_dagen INTEGER CHECK (levertijd_dagen IS NULL OR levertijd_dagen >= 0),
      voorkeur        INTEGER NOT NULL DEFAULT 0 CHECK (voorkeur IN (0,1)),
      bijgewerkt_op   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_artlev_artikel ON artikel_leveranciers(artikel_id);
    CREATE UNIQUE INDEX uq_artlev_code ON artikel_leveranciers(leverancier_id, productcode COLLATE NOCASE) WHERE productcode IS NOT NULL;
  `);
}
