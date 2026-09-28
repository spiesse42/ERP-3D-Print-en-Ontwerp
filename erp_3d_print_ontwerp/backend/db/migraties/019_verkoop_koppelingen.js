// ═══════════════════════════════════════════════════════════════════════
// Migratie 019 — verkoop: dossiers, printopdrachten en vrije regels (26-09)
// ═══════════════════════════════════════════════════════════════════════
// Bevestigd 26-09 (claude/beslissingen-2026-09-26.md): op één bonnetje in
// "Nieuwe verkoop" ook
// - een DOSSIER (één regel; prijs = werkbon, zonder aanvaarde offerte
//   aanpasbaar). Het dossier wordt afgerekend met hetzelfde bonnetjesnummer.
// - een voltooide LOSSE PRINTOPDRACHT (zonder dossier), hele opdracht,
//   voorstelprijs van de rekenmotor, aanpasbaar; maar één keer te verkopen.
// - een VRIJE regel (omschrijving + prijs, geen artikel, geen voorraad).
// artikel_id was verplicht → de tabel wordt herbouwd (zelfde id's: de
// voorraadmutaties verwijzen ernaar via bron_id). `berekend` = het bedrag dat
// het ERP voorstelde (dossier/printopdracht), ter vergelijking.
export const versie = 19;
export const naam = 'verkoop_regels: soort (artikel/dossier/printopdracht/vrij), dossier_id, printopdracht_id, berekend';

export function up(db) {
  db.exec(`
    CREATE TABLE verkoop_regels_nieuw (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      verkoop_id       INTEGER NOT NULL REFERENCES verkopen(id) ON DELETE CASCADE,
      volgorde         INTEGER NOT NULL,
      soort            TEXT NOT NULL DEFAULT 'artikel' CHECK (soort IN ('artikel','dossier','printopdracht','vrij')),
      artikel_id       INTEGER REFERENCES artikelen(id),
      dossier_id       INTEGER REFERENCES dossiers(id),
      printopdracht_id INTEGER REFERENCES printopdrachten(id),
      omschrijving     TEXT NOT NULL,
      aantal           REAL NOT NULL CHECK (aantal > 0),
      prijs_per_stuk   REAL NOT NULL CHECK (prijs_per_stuk >= 0),
      bedrag           REAL NOT NULL CHECK (bedrag >= 0),
      berekend         REAL CHECK (berekend IS NULL OR berekend >= 0),
      CHECK ((soort = 'artikel') = (artikel_id IS NOT NULL)),
      CHECK ((soort = 'dossier') = (dossier_id IS NOT NULL)),
      CHECK ((soort = 'printopdracht') = (printopdracht_id IS NOT NULL))
    );
    INSERT INTO verkoop_regels_nieuw (id, verkoop_id, volgorde, soort, artikel_id, omschrijving, aantal, prijs_per_stuk, bedrag)
      SELECT id, verkoop_id, volgorde, 'artikel', artikel_id, omschrijving, aantal, prijs_per_stuk, bedrag FROM verkoop_regels;
    DROP TABLE verkoop_regels;
    ALTER TABLE verkoop_regels_nieuw RENAME TO verkoop_regels;
    CREATE INDEX idx_verkoop_regels_verkoop ON verkoop_regels(verkoop_id);
    CREATE INDEX idx_verkoop_regels_dossier ON verkoop_regels(dossier_id);
    CREATE INDEX idx_verkoop_regels_opdracht ON verkoop_regels(printopdracht_id);
  `);
}
