// ═══════════════════════════════════════════════════════════════════════
// Migratie 010 — printopdrachten + runs koppelen (stap 6b, 25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (domeinmodel → "Printopdrachten", 23-09; 25-09):
// - printopdracht: printer (wachtrij per printer), dossierregel (optioneel),
//   soort klant / eigen product / intern, naam, aantal stuks, volgorde,
//   aantal goede stuks. Status AFGELEID: gepland → bezig → te bevestigen →
//   voltooid, of mislukt (laatste poging mislukt, wacht op herprint) /
//   geannuleerd
// - koppelen gebeurt ALTIJD door jou: een run wordt gekoppeld aan een
//   opdracht (kan verhuizen naar de printer van de run) of als intern
//   gemarkeerd (kalibratie, test, overig)
// - werkbon: enkel GESLAAGDE runs tellen (beslist 25-09, optie A); mislukte
//   pogingen blijven zichtbaar als kost (marge-analyse)
// - aangevuld: kWh van een onvolledige/gemiste run aangevuld uit de
//   geschiedenis van de kWh-meter in Home Assistant

export const versie = 10;
export const naam = 'printopdrachten, runs koppelen, kWh aanvullen uit HA-geschiedenis';

export function up(db) {
  db.exec(`
    CREATE TABLE printopdrachten (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      printer_id       INTEGER NOT NULL REFERENCES printers(id),
      dossier_regel_id INTEGER REFERENCES dossier_regels(id),
      soort            TEXT NOT NULL DEFAULT 'klant' CHECK (soort IN ('klant','eigen','intern')),
      naam             TEXT NOT NULL,
      aantal           REAL NOT NULL DEFAULT 1 CHECK (aantal > 0),
      volgorde         INTEGER NOT NULL DEFAULT 0,
      aantal_goed      REAL CHECK (aantal_goed IS NULL OR aantal_goed >= 0),
      voltooid_op      TEXT,
      geannuleerd_op   TEXT,
      notities         TEXT,
      aangemaakt_op    TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((voltooid_op IS NULL) = (aantal_goed IS NULL)),
      CHECK (voltooid_op IS NULL OR geannuleerd_op IS NULL)
    );
    CREATE INDEX idx_printopdrachten_printer ON printopdrachten(printer_id, volgorde);
    CREATE INDEX idx_printopdrachten_regel ON printopdrachten(dossier_regel_id);

    ALTER TABLE printruns ADD COLUMN printopdracht_id INTEGER REFERENCES printopdrachten(id);
    ALTER TABLE printruns ADD COLUMN intern TEXT CHECK (intern IS NULL OR intern IN ('kalibratie','test','overig'));
    ALTER TABLE printruns ADD COLUMN aangevuld INTEGER NOT NULL DEFAULT 0 CHECK (aangevuld IN (0,1));
    CREATE INDEX idx_printruns_opdracht ON printruns(printopdracht_id);
  `);
}
