// Migratie 037 — printerkoppeling "moonraker_ha" (Snapmaker U1, 16-10)
// De koppeling staat in een CHECK → de tabel wordt herbouwd (zelfde id's;
// printruns, printopdrachten en dossier_regels verwijzen ernaar).
export const versie = 37;
export const naam = 'printers.koppeling: + moonraker_ha';
export const fkUit = true;

const KOLOMMEN = 'id, naam, machine_per_uur, verbruik_watt, actief, notities, aangemaakt_op, koppeling, ha_prefix, watt_entity, kwh_entity, camera_entity, pauze_entity, hervat_entity, annuleer_entity, slijtage_per_print';

export function up(db) {
  db.exec(`
    CREATE TABLE printers_nieuw (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      naam               TEXT NOT NULL UNIQUE COLLATE NOCASE,
      machine_per_uur    REAL CHECK (machine_per_uur IS NULL OR machine_per_uur >= 0),
      verbruik_watt      REAL CHECK (verbruik_watt IS NULL OR verbruik_watt >= 0),
      actief             INTEGER NOT NULL DEFAULT 1 CHECK (actief IN (0,1)),
      notities           TEXT,
      aangemaakt_op      TEXT NOT NULL DEFAULT (datetime('now')),
      koppeling          TEXT NOT NULL DEFAULT 'manueel' CHECK (koppeling IN ('manueel','bambu_ha','anycubic_ha','moonraker_ha')),
      ha_prefix          TEXT,
      watt_entity        TEXT,
      kwh_entity         TEXT,
      camera_entity      TEXT,
      pauze_entity       TEXT,
      hervat_entity      TEXT,
      annuleer_entity    TEXT,
      slijtage_per_print REAL CHECK (slijtage_per_print IS NULL OR slijtage_per_print >= 0)
    );
    INSERT INTO printers_nieuw (${KOLOMMEN}) SELECT ${KOLOMMEN} FROM printers;
    DROP TABLE printers;
    ALTER TABLE printers_nieuw RENAME TO printers;
  `);
}
