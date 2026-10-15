// Migratie 035 — kortingen (15-10)
// - per regel: dossier_regels.korting (JSON) met korting op het filament, de
//   printuren en de hele regel, elk in % of in €:
//   { materiaal: { waarde, soort: 'pct'|'eur' }, printuren: {…}, regel: {…} }
// - nieuw soort regel 'korting': korting op het totaal van de andere regels
//   (korting.totaal), als aparte regel op offerte, werkbon en factuur.
// Het soort regel staat in een CHECK → de tabel wordt herbouwd (zelfde id's;
// materialen, leveringen en printopdrachten verwijzen ernaar).
export const versie = 35;
export const naam = 'dossier_regels: kortingen + regel "korting"';
export const fkUit = true;

const KOLOMMEN = 'id, dossier_id, volgorde, type, omschrijving, aantal, printer_id, tijd_min, voorbereiding_min, nabewerking_min, minuten, tarief, artikel_id, bedrag, per_stuk, handmatig_bedrag, werkelijk_uren, werkelijk_kwh, afbeelding, slicer_bijlage_id, slicer_plaat, per_plaat';

export function up(db) {
  db.exec(`
    CREATE TABLE dossier_regels_nieuw (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      dossier_id        INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      volgorde          INTEGER NOT NULL,
      type              TEXT NOT NULL CHECK (type IN ('printen','ontwerp','aanpassing','artikel','extra','korting')),
      omschrijving      TEXT,
      aantal            REAL CHECK (aantal IS NULL OR aantal >= 0),
      printer_id        INTEGER REFERENCES printers(id),
      tijd_min          REAL CHECK (tijd_min IS NULL OR tijd_min >= 0),
      voorbereiding_min REAL CHECK (voorbereiding_min IS NULL OR voorbereiding_min >= 0),
      nabewerking_min   REAL CHECK (nabewerking_min IS NULL OR nabewerking_min >= 0),
      minuten           REAL CHECK (minuten IS NULL OR minuten >= 0),
      tarief            REAL CHECK (tarief IS NULL OR tarief >= 0),
      artikel_id        INTEGER REFERENCES artikelen(id),
      bedrag            REAL CHECK (bedrag IS NULL OR bedrag >= 0),
      per_stuk          INTEGER NOT NULL DEFAULT 0 CHECK (per_stuk IN (0,1)),
      handmatig_bedrag  REAL CHECK (handmatig_bedrag IS NULL OR handmatig_bedrag >= 0),
      werkelijk_uren    REAL CHECK (werkelijk_uren IS NULL OR werkelijk_uren >= 0),
      werkelijk_kwh     REAL CHECK (werkelijk_kwh IS NULL OR werkelijk_kwh >= 0),
      afbeelding        TEXT,
      slicer_bijlage_id INTEGER REFERENCES bijlagen(id) ON DELETE SET NULL,
      slicer_plaat      INTEGER CHECK (slicer_plaat IS NULL OR slicer_plaat > 0),
      per_plaat         INTEGER CHECK (per_plaat IS NULL OR per_plaat > 0),
      korting           TEXT
    );
    INSERT INTO dossier_regels_nieuw (${KOLOMMEN}) SELECT ${KOLOMMEN} FROM dossier_regels;
    DROP TABLE dossier_regels;
    ALTER TABLE dossier_regels_nieuw RENAME TO dossier_regels;
    CREATE INDEX idx_dossier_regels_dossier ON dossier_regels(dossier_id);
  `);
}
