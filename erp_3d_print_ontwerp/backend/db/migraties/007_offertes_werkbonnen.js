// ═══════════════════════════════════════════════════════════════════════
// Migratie 007 — offertes (versies) en werkbon (stap 5b, 25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (claude/domeinmodel-v2.md → "Offerte", "Statussen"):
// - offerte: concept volgt de dossierregels; bij versturen worden regels en
//   bedragen BEVROREN (momentopname, JSON); wijzigen = nieuwe versie met
//   hetzelfde nummer (OFF-2026-001 v2). Status afgeleid uit datums:
//   concept → verstuurd → aanvaard / geweigerd / verlopen (geldig_tot voorbij)
// - werkbon: één per dossier (WB-2026-0001), concept volgt de dossierregels
//   in stand "werkelijk" (gemeten kWh / werkelijke uren per printregel);
//   definitief = bij het afrekenen (momentopname). Afrekening ongedaan →
//   terug concept, versie + 1.
// - werkelijke uren/kWh staan op de dossierregel zelf (stap 6 vult ze later
//   automatisch vanuit de printers).

export const versie = 7;
export const naam = 'offertes met versies, werkbon, werkelijke uren/kWh per regel';

export function up(db) {
  db.exec(`
    CREATE TABLE offertes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dossier_id    INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
      nummer        TEXT NOT NULL,
      versie        INTEGER NOT NULL DEFAULT 1 CHECK (versie >= 1),
      geldig_tot    TEXT,
      levertermijn  TEXT,
      opmerking     TEXT,
      verstuurd_op  TEXT,
      aanvaard_op   TEXT,
      geweigerd_op  TEXT,
      momentopname  TEXT,
      totaal        REAL,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (nummer, versie),
      CHECK ((verstuurd_op IS NULL AND momentopname IS NULL AND totaal IS NULL)
          OR (verstuurd_op IS NOT NULL AND momentopname IS NOT NULL AND totaal IS NOT NULL)),
      CHECK (aanvaard_op IS NULL OR verstuurd_op IS NOT NULL),
      CHECK (geweigerd_op IS NULL OR verstuurd_op IS NOT NULL),
      CHECK (aanvaard_op IS NULL OR geweigerd_op IS NULL)
    );
    CREATE INDEX idx_offertes_dossier ON offertes(dossier_id);

    CREATE TABLE werkbonnen (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      dossier_id     INTEGER NOT NULL UNIQUE REFERENCES dossiers(id) ON DELETE CASCADE,
      nummer         TEXT NOT NULL UNIQUE,
      versie         INTEGER NOT NULL DEFAULT 1 CHECK (versie >= 1),
      opmerking      TEXT,
      definitief_op  TEXT,
      momentopname   TEXT,
      totaal         REAL,
      aangemaakt_op  TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK ((definitief_op IS NULL AND momentopname IS NULL AND totaal IS NULL)
          OR (definitief_op IS NOT NULL AND momentopname IS NOT NULL AND totaal IS NOT NULL))
    );

    ALTER TABLE dossier_regels ADD COLUMN werkelijk_uren REAL CHECK (werkelijk_uren IS NULL OR werkelijk_uren >= 0);
    ALTER TABLE dossier_regels ADD COLUMN werkelijk_kwh  REAL CHECK (werkelijk_kwh IS NULL OR werkelijk_kwh >= 0);
  `);
}
