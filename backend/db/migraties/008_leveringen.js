// ═══════════════════════════════════════════════════════════════════════
// Migratie 008 — leveringen + pakbon (stap 5c, 25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (domeinmodel → "Leveringen en pakbon", 23-09 en 25-09):
// - levering in meerdere keren, per dossierregel en per aantal
// - elke levering heeft een pakbon (PB-2026-001, eigen interne nummering,
//   geen fiscaal document), ZONDER prijzen
// - een artikelregel met voorraad (eigen product of doorverkocht gekocht
//   artikel) boekt bij levering FIFO uit (reden "levering"); printregels en
//   diensten niet
// - de laatste levering kan ongedaan gemaakt worden (voorraad terug op
//   dezelfde partijen; het pakbonnummer wordt niet hergebruikt)
// - de omschrijving wordt per leverregel bewaard, zodat de pakbon later
//   hetzelfde blijft tonen

export const versie = 8;
export const naam = 'leveringen en pakbon';

export function up(db) {
  db.exec(`
    CREATE TABLE leveringen (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dossier_id    INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      nummer        TEXT NOT NULL UNIQUE,
      datum         TEXT NOT NULL,
      opmerking     TEXT,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_leveringen_dossier ON leveringen(dossier_id);

    CREATE TABLE levering_regels (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      levering_id      INTEGER NOT NULL REFERENCES leveringen(id) ON DELETE CASCADE,
      dossier_regel_id INTEGER NOT NULL REFERENCES dossier_regels(id),
      aantal           REAL NOT NULL CHECK (aantal > 0),
      omschrijving     TEXT NOT NULL
    );
    CREATE INDEX idx_levering_regels_regel ON levering_regels(dossier_regel_id);
  `);
}
