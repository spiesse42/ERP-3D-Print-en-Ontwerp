// ═══════════════════════════════════════════════════════════════════════
// Migratie 006 — dossiers + regels (stap 5a, 25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (claude/domeinmodel-v2.md → "Dossier", "Statussen", "Documenten"):
// - 1 opdracht = 1 dossier; soort klantopdracht / eigen product / intern;
//   een klant is optioneel
// - de regels zijn echte rijen met een eigen id (leveringen en
//   printopdrachten verwijzen er later naar); multicolor = één rij per kleur
//   in dossier_regel_materialen
// - geen los statusveld: gebeurtenissen met een datum (afgerekend_op,
//   betaald_op, geannuleerd_op …); de fase wordt afgeleid
//   (domein/status/dossier.js). Offerte/levering/productie volgen in 5b/5c/6.
// - de afrekening is een VERWIJZING naar Accountable (factuur of bonnetje,
//   nummer, datum, bedrag); het ERP nummert zelf geen fiscale documenten

export const versie = 6;
export const naam = 'dossiers, dossierregels en materialen per regel';

export function up(db) {
  db.exec(`
    CREATE TABLE dossiers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      nummer            TEXT NOT NULL UNIQUE,
      soort             TEXT NOT NULL DEFAULT 'klant' CHECK (soort IN ('klant','eigen','intern')),
      klant_id          INTEGER REFERENCES klanten(id),
      titel             TEXT NOT NULL,
      notities          TEXT,
      afgerekend_soort  TEXT CHECK (afgerekend_soort IS NULL OR afgerekend_soort IN ('factuur','bonnetje')),
      afgerekend_nummer TEXT,
      afgerekend_op     TEXT,
      afgerekend_bedrag REAL CHECK (afgerekend_bedrag IS NULL OR afgerekend_bedrag >= 0),
      betaald_op        TEXT,
      geannuleerd_op    TEXT,
      gearchiveerd      INTEGER NOT NULL DEFAULT 0 CHECK (gearchiveerd IN (0,1)),
      aangemaakt_op     TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((afgerekend_op IS NULL AND afgerekend_soort IS NULL AND afgerekend_nummer IS NULL AND afgerekend_bedrag IS NULL)
          OR (afgerekend_op IS NOT NULL AND afgerekend_soort IS NOT NULL AND afgerekend_nummer IS NOT NULL AND afgerekend_bedrag IS NOT NULL)),
      CHECK (afgerekend_op IS NULL OR soort = 'klant'),
      CHECK (betaald_op IS NULL OR afgerekend_op IS NOT NULL),
      CHECK (geannuleerd_op IS NULL OR afgerekend_op IS NULL)
    );
    CREATE INDEX idx_dossiers_klant ON dossiers(klant_id);

    CREATE TABLE dossier_regels (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      dossier_id        INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      volgorde          INTEGER NOT NULL,
      type              TEXT NOT NULL CHECK (type IN ('printen','ontwerp','aanpassing','artikel','extra')),
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
      handmatig_bedrag  REAL CHECK (handmatig_bedrag IS NULL OR handmatig_bedrag >= 0)
    );
    CREATE INDEX idx_dossier_regels_dossier ON dossier_regels(dossier_id);

    CREATE TABLE dossier_regel_materialen (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      regel_id         INTEGER NOT NULL REFERENCES dossier_regels(id) ON DELETE CASCADE,
      volgorde         INTEGER NOT NULL,
      artikel_id       INTEGER REFERENCES artikelen(id),
      filament_type_id INTEGER REFERENCES filament_types(id),
      gram             REAL NOT NULL DEFAULT 0 CHECK (gram >= 0),
      CHECK ((artikel_id IS NULL) <> (filament_type_id IS NULL))
    );
    CREATE INDEX idx_regel_materialen_regel ON dossier_regel_materialen(regel_id);
  `);
}
