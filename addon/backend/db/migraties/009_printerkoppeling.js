// ═══════════════════════════════════════════════════════════════════════
// Migratie 009 — printerkoppeling + printruns (stap 6a, 25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (domeinmodel → "Productie", 23-09; aangevuld 25-09):
// - koppeling per printer: 'bambu_ha' (Bambu Lab-integratie in HA, A1 Mini
//   en A1), 'anycubic_ha' (Anycubic S1 MQTT Bridge in HA, Kobra S1) of
//   'manueel' (starten/stoppen met een knop)
// - ha_prefix: het begin van de entiteitsnamen (bv. sensor.a1mini_0309..._);
//   daaruit volgen status, voortgang, temperaturen … (zie productie/adapters.js)
// - wattage- en kWh-meter, camera en knoppen (pauze/hervat/annuleer) apart
// - elke gestarte print = een PRINTRUN (automatisch, door de printerwachter),
//   met wattmetingen; kWh = verschil van de kWh-meter, anders trapeziumregel
//   over de wattmetingen (zoals het oude pakket). Koppelen aan printopdrachten
//   en bevestigen volgt in stap 6b.

export const versie = 9;
export const naam = 'printerkoppeling (Home Assistant) en printruns';

export function up(db) {
  db.exec(`
    ALTER TABLE printers ADD COLUMN koppeling TEXT NOT NULL DEFAULT 'manueel' CHECK (koppeling IN ('manueel','bambu_ha','anycubic_ha'));
    ALTER TABLE printers ADD COLUMN ha_prefix TEXT;
    ALTER TABLE printers ADD COLUMN watt_entity TEXT;
    ALTER TABLE printers ADD COLUMN kwh_entity TEXT;
    ALTER TABLE printers ADD COLUMN camera_entity TEXT;
    ALTER TABLE printers ADD COLUMN pauze_entity TEXT;
    ALTER TABLE printers ADD COLUMN hervat_entity TEXT;
    ALTER TABLE printers ADD COLUMN annuleer_entity TEXT;

    CREATE TABLE printruns (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      printer_id    INTEGER NOT NULL REFERENCES printers(id),
      gestart_op    TEXT NOT NULL,
      geeindigd_op  TEXT,
      uitkomst      TEXT NOT NULL DEFAULT 'bezig' CHECK (uitkomst IN ('bezig','klaar','mislukt','geannuleerd')),
      bestand       TEXT,
      kwh_start     REAL,
      kwh_eind      REAL,
      kwh           REAL CHECK (kwh IS NULL OR kwh >= 0),
      gewicht_g     REAL,
      bron          TEXT NOT NULL DEFAULT 'automatisch' CHECK (bron IN ('automatisch','manueel')),
      onvolledig    INTEGER NOT NULL DEFAULT 0 CHECK (onvolledig IN (0,1)),
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((uitkomst = 'bezig') = (geeindigd_op IS NULL))
    );
    CREATE INDEX idx_printruns_printer ON printruns(printer_id, gestart_op);

    CREATE TABLE wattmetingen (
      run_id   INTEGER NOT NULL REFERENCES printruns(id) ON DELETE CASCADE,
      tijdstip TEXT NOT NULL,
      watt     REAL NOT NULL CHECK (watt >= 0)
    );
    CREATE INDEX idx_wattmetingen_run ON wattmetingen(run_id, tijdstip);
  `);
}
