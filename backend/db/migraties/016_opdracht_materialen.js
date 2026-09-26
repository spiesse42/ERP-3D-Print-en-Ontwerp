// ═══════════════════════════════════════════════════════════════════════
// Migratie 016 — filament van een losse printopdracht (26-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Een printopdracht zonder dossier (eigen product of intern, bv. een run die
// vanaf de printerkaart als "nieuwe printopdracht" gekoppeld werd) had geen
// plek voor het filament: dat stond enkel op een printregel van een dossier.
// Gevolg: de productiekost bleef altijd onvolledig ("printregel (filament)").
// Beslist 26-09 (optie A): de losse opdracht krijgt zelf filament + gram,
// zelfde vorm als dossier_regel_materialen (per kleur een filament OF een
// prijsgroep). gram = het filament voor de hele opdracht (alle stuks samen).
// Een opdracht MET dossierregel blijft haar filament van die regel halen.
export const versie = 16;
export const naam = 'printopdracht_materialen (filament van een losse printopdracht)';

export function up(db) {
  db.exec(`
    CREATE TABLE printopdracht_materialen (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      printopdracht_id INTEGER NOT NULL REFERENCES printopdrachten(id) ON DELETE CASCADE,
      volgorde         INTEGER NOT NULL,
      artikel_id       INTEGER REFERENCES artikelen(id),
      filament_type_id INTEGER REFERENCES filament_types(id),
      gram             REAL NOT NULL DEFAULT 0 CHECK (gram >= 0),
      CHECK ((artikel_id IS NULL) <> (filament_type_id IS NULL))
    );
    CREATE INDEX idx_opdracht_materialen_opdracht ON printopdracht_materialen(printopdracht_id);
  `);
}
