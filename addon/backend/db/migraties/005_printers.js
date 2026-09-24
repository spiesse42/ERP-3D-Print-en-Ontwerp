// ═══════════════════════════════════════════════════════════════════════
// Migratie 005 — printers + rekenmotor-afspraken (stap 4, 24-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist op 24-09 (claude/domeinmodel-v2.md → "Rekenmotor"):
// - machinekost = altijd het tarief van de gekozen printer, GEEN terugval →
//   het globale tarief machine_per_uur verdwijnt
// - elke printer wordt gevoed door een BMCU/AMS → slijtage bij elke print
//   (tarief bmcu_per_job blijft, enkel het label verandert)
// - printers: toevoegen en (de)activeren. Koppeling met Home Assistant en
//   live-monitoring komen in stap 6 (extra kolommen in een latere migratie).
// De drie printers worden aangemaakt ZONDER tarief/verbruik: die vul jij in
// (Instellingen → Printers). Tot dan meldt de rekenmotor dat ze ontbreken.

export const versie = 5;
export const naam = 'printers; machinekost zonder terugval; BMCU/AMS bij elke print';

export function up(db) {
  db.exec(`
    CREATE TABLE printers (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      naam               TEXT NOT NULL UNIQUE COLLATE NOCASE,
      machine_per_uur    REAL CHECK (machine_per_uur IS NULL OR machine_per_uur >= 0),
      verbruik_watt      REAL CHECK (verbruik_watt IS NULL OR verbruik_watt >= 0),
      actief             INTEGER NOT NULL DEFAULT 1 CHECK (actief IN (0,1)),
      notities           TEXT,
      aangemaakt_op      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO printers (naam) VALUES ('Bambu Lab A1 Mini'), ('Bambu Lab A1'), ('AnyCubic Kobra S1');

    DELETE FROM tarieven WHERE sleutel = 'machine_per_uur';
    UPDATE tarieven SET label = 'BMCU/AMS-slijtage per print' WHERE sleutel = 'bmcu_per_job';
  `);
}
