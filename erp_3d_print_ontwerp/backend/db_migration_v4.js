// v4 — Artikelen (onderdelen zoals ringen/sleutelhangers + diensten zoals
// verzendkosten) + batch-groepering voor voorraad (2026-09-22).
//
// Aanleiding: bij het bespreken van Aankoopfacturen/OCR bleek dat niet enkel
// filament wordt aangekocht — ook fysieke onderdelen (met een voorraadaantal)
// horen straks via OCR ingelezen te worden, en moeten nadien bruikbaar zijn op
// offertes/werkbonnen (Fase 2). Filament/Voorraad is bewust filament-specifiek
// (merk/type/kleur/verkoopprijs-per-kg) en leent zich daar niet voor — vandaar
// een apart, generiek "Artikelen"-concept, naar het model van het oude pakket
// (één catalogus met een categorie-vlag: 'onderdeel' met voorraad, 'dienst'
// zonder). Zie sessie-overleg voor de volledige afweging.
//
// Tegelijk: jouw vraag om rollen/artikelen die op verschillende momenten zijn
// toegevoegd, in de lijst niet plat door elkaar te tonen maar gegroepeerd per
// "toevoegmoment" (batch) — bv. "Anycubic PLA Geel: 1 regel, met bij het
// openklikken de aparte aankoopmomenten". Gekozen voor een EXPLICIETE
// batch-referentie (i.p.v. groeperen op toevallig gelijke datum/prijs): elke
// rij krijgt een `batch_id` die verwijst naar het id van de EERSTE rij van die
// batch (zelfverwijzend, geen aparte tabel nodig) — rijen die in dezelfde
// "X toevoegen"-actie zijn aangemaakt, delen dezelfde batch_id.
export function migrateDbV4(db) {
  // ── batch_id op filament_rollen ───────────────────────────────────────────
  const rolKolommen = db.prepare(`PRAGMA table_info(filament_rollen)`).all().map(k => k.name);
  if (!rolKolommen.includes('batch_id')) {
    db.exec(`ALTER TABLE filament_rollen ADD COLUMN batch_id INTEGER REFERENCES filament_rollen(id)`);
    // Backfill: bestaande rollen (van vóór deze migratie) kennen we de
    // oorspronkelijke groepering niet van — elke bestaande rol wordt dus zijn
    // eigen, aparte batch (batch_id = eigen id). Nieuwe rollen vanaf nu delen
    // een batch_id zodra ze in 1 "aantal rollen"-actie zijn aangemaakt.
    db.exec(`UPDATE filament_rollen SET batch_id = id WHERE batch_id IS NULL`);
  }

  // ── Artikelen: catalogus + voorraad ───────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS artikel_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naam TEXT NOT NULL UNIQUE,
      categorie TEXT NOT NULL CHECK (categorie IN ('onderdeel','dienst')),
      eenheid TEXT,
      verkoopprijs REAL NOT NULL,
      vaste_prijs INTEGER NOT NULL DEFAULT 0,
      min_aantal INTEGER,
      notities TEXT,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artikel_voorraad (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artikel_type_id INTEGER NOT NULL REFERENCES artikel_types(id),
      batch_id INTEGER REFERENCES artikel_voorraad(id),
      aankoopprijs_eur REAL,
      locatie TEXT,
      gekocht_op TEXT,
      actief INTEGER NOT NULL DEFAULT 1,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_artikel_voorraad_type ON artikel_voorraad(artikel_type_id);
  `);
}
