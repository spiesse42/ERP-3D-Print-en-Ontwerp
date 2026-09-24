// v5 — Eindproducten (afgewerkte, verkoopklare artikelen — bv. voor de
// webshop) als derde categorie naast onderdeel/dienst op artikel_types
// (2026-09-22, vervolg op db_migration_v4.js).
//
// 'onderdeel' (losse componenten, bv. sleutelhanger-ringetjes) en
// 'eindproduct' (afgewerkte producten) hebben allebei een voorraad via
// artikel_voorraad; enkel 'dienst' (prijslijst zonder voorraad, bv.
// verzendkosten) niet — zie routes/artikelen.js voor de volledige logica.
//
// SQLite kan een CHECK-constraint niet met een eenvoudige ALTER TABLE
// verruimen, dus de tabel wordt herbouwd: nieuwe tabel met de verruimde
// CHECK, bestaande rijen 1-op-1 overgezet (ids blijven behouden, dus de FK
// vanuit artikel_voorraad blijft geldig), oude tabel weg, nieuwe hernoemd —
// alles binnen 1 transactie met foreign_keys tijdelijk uit, exact hetzelfde
// patroon als de jobs-tabel-herbouwmigraties uit het oude pakket
// (db_migration_v13/v20/v29/v32).
export function migrateDbV5(db) {
  const huidigeSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='artikel_types'`).get();
  if (!huidigeSql || huidigeSql.sql.includes(`'eindproduct'`)) {
    // Al gemigreerd (of de tabel bestaat nog niet — dan maakt v4 hem al met
    // de juiste CHECK aan zodra die na v5 draait; in de praktijk draait v4
    // altijd eerst, dus dit tweede geval komt hier niet voor).
    return;
  }

  const fkWasAan = db.pragma('foreign_keys', { simple: true }) === 1;
  db.pragma('foreign_keys = OFF');
  const herbouw = db.transaction(() => {
    db.exec(`
      CREATE TABLE artikel_types_v5 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        naam TEXT NOT NULL UNIQUE,
        categorie TEXT NOT NULL CHECK (categorie IN ('onderdeel','eindproduct','dienst')),
        eenheid TEXT,
        verkoopprijs REAL NOT NULL,
        vaste_prijs INTEGER NOT NULL DEFAULT 0,
        min_aantal INTEGER,
        notities TEXT,
        aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO artikel_types_v5
        (id, naam, categorie, eenheid, verkoopprijs, vaste_prijs, min_aantal, notities, aangemaakt_op)
      SELECT id, naam, categorie, eenheid, verkoopprijs, vaste_prijs, min_aantal, notities, aangemaakt_op
      FROM artikel_types;
      DROP TABLE artikel_types;
      ALTER TABLE artikel_types_v5 RENAME TO artikel_types;
    `);
  });
  try {
    herbouw();
  } finally {
    if (fkWasAan) db.pragma('foreign_keys = ON');
  }
}
