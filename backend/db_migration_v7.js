// v7 — Aankoopfacturen/OCR: facturen-tabel (leverancier, factuurnummer,
// datum, type, bestandsnaam/-pad, mimetype, totaalbedrag) + optionele
// factuur_id-FK op filament_rollen en artikel_voorraad (2026-09-22).
//
// Herbouw van de OCR-koppelingsfunctie uit het oude pakket (zie
// sessie-notities.md, "Vervolgsessie deel 4"), aangepast aan het nieuwe
// schema: enkel filament_rollen en artikel_voorraad krijgen een factuur_id —
// géén equivalent van de oude 'uitgaven'-tabel, want die bestaat nog niet in
// erp-v2 (Financiën is Fase 3). factuur_id is bewust nullable met
// ON DELETE SET NULL: een factuur verwijderen mag nooit de onderliggende
// voorraad/rollen meeslepen, enkel de koppeling ernaar loskoppelen — zelfde
// afspraak als in het oude pakket.
export function migrateDbV7(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facturen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      leverancier TEXT,
      factuurnummer TEXT,
      datum TEXT,
      type TEXT NOT NULL CHECK (type IN ('factuur','bonnetje')),
      bestandsnaam TEXT NOT NULL,
      bestandspad TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      totaal_bedrag REAL,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const rolKolommen = db.prepare(`PRAGMA table_info(filament_rollen)`).all().map(k => k.name);
  if (!rolKolommen.includes('factuur_id')) {
    db.exec(`ALTER TABLE filament_rollen ADD COLUMN factuur_id INTEGER REFERENCES facturen(id) ON DELETE SET NULL`);
  }

  const voorraadKolommen = db.prepare(`PRAGMA table_info(artikel_voorraad)`).all().map(k => k.name);
  if (!voorraadKolommen.includes('factuur_id')) {
    db.exec(`ALTER TABLE artikel_voorraad ADD COLUMN factuur_id INTEGER REFERENCES facturen(id) ON DELETE SET NULL`);
  }
}
