// v2 — Filament/Voorraad (Fase 1, eerste stuk, los van Printers/Jobs/Bestellingen).
//
// Herzien t.o.v. de eerste versie: geen vrije tekst meer voor merk/materiaal/
// kleur, maar drie eigen catalogi (filament_merken, filament_materialen,
// filament_kleuren) die je zelf kan aanvullen — dit voedt de 3 keuzelijsten
// bij het toevoegen van een rol in Voorraad. filament_types is de koppeling
// merk+materiaal met de verkoopprijs/kg voor de kostenberekening (i.p.v. een
// inkoopprijs+marge — zie sessie-overleg: inkoopprijs varieert toch al per
// bestelling/rol via filament_rollen.aankoopprijs_eur, dus een vaste
// verkoopprijs/kg per merk+type is eerlijker en consistenter met hoe de
// andere tarieven al werken). Beheer van filament_types gebeurt in
// Instellingen → Materiaal, niet in Voorraad zelf.
//
// Rollen-gebaseerd vanaf het begin: elke actieve rol is 1 fysiek object. Geen
// gewicht per rol (zie db_migration_v3.js: gewicht_gram_start/huidig zijn
// later alweer geschrapt) — voorraad wordt puur op rol-niveau bijgehouden
// (aanwezig/niet, via `actief`), het gewicht dat de rekenmotor gebruikt is een
// losse waarde bij de offerte/werkbon-prijsberekening, geen koppeling met de
// fysieke rollen hier. De BESTEL-drempel (min_rollen) telt in aantal rollen
// i.p.v. gram, conform de eerder bevestigde "te bestellen"-logica — gegroepeerd
// op filament_type_id + kleur_id i.p.v. kleur-tekst.
//
// Vervangt de eerste v2-versie volledig (niet als v3 bovenop) — die versie is
// nooit met echte data op het toestel gebruikt/getest, dus een schone vervanging
// is hier eenvoudiger dan een ALTER TABLE-migratie.
export function migrateDbV2(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS filament_merken (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naam TEXT NOT NULL UNIQUE,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS filament_materialen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naam TEXT NOT NULL UNIQUE,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS filament_kleuren (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naam TEXT NOT NULL UNIQUE,
      hex TEXT NOT NULL,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS filament_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merk_id INTEGER NOT NULL REFERENCES filament_merken(id),
      materiaal_id INTEGER NOT NULL REFERENCES filament_materialen(id),
      verkoopprijs_per_kg REAL NOT NULL,
      dichtheid_g_per_cm3 REAL,
      min_rollen INTEGER,
      leverancier TEXT,
      notities TEXT,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(merk_id, materiaal_id)
    );

    CREATE TABLE IF NOT EXISTS filament_rollen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filament_type_id INTEGER NOT NULL REFERENCES filament_types(id),
      kleur_id INTEGER NOT NULL REFERENCES filament_kleuren(id),
      aankoopprijs_eur REAL,
      locatie TEXT,
      gekocht_op TEXT,
      actief INTEGER NOT NULL DEFAULT 1,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_filament_rollen_type  ON filament_rollen(filament_type_id);
    CREATE INDEX IF NOT EXISTS idx_filament_rollen_kleur ON filament_rollen(kleur_id);
  `);

  // Seed-data — enkel bij een lege catalogus (zelfde patroon als de
  // tarieven-seed in db.js: niet opnieuw invoegen als er al rijen zijn).
  const merkenCount = db.prepare('SELECT COUNT(*) as c FROM filament_merken').get().c;
  if (merkenCount === 0) {
    const ins = db.prepare('INSERT INTO filament_merken (naam) VALUES (?)');
    ['Bambu Lab', 'AnyCubic', 'CaiLab', 'eSUN', 'Sunlu', 'PolyMaker', 'Azurefilm', 'Spectrum']
      .forEach(naam => ins.run(naam));
  }

  const materialenCount = db.prepare('SELECT COUNT(*) as c FROM filament_materialen').get().c;
  if (materialenCount === 0) {
    const ins = db.prepare('INSERT INTO filament_materialen (naam) VALUES (?)');
    ['PLA', 'PLA+', 'PLA Pro', 'PLA Matte', 'PLA Matte HS', 'PLA Silk', 'PETG', 'PETG Matte']
      .forEach(naam => ins.run(naam));
  }

  const kleurenCount = db.prepare('SELECT COUNT(*) as c FROM filament_kleuren').get().c;
  if (kleurenCount === 0) {
    const ins = db.prepare('INSERT INTO filament_kleuren (naam, hex) VALUES (?,?)');
    [
      ['Zwart', '#1a1a1a'], ['Wit', '#f5f5f0'], ['Grijs', '#808080'],
      ['Rood', '#d32f2f'], ['Oranje', '#f57c00'], ['Geel', '#fdd835'],
      ['Groen', '#43a047'], ['Blauw', '#1e88e5'], ['Paars', '#8e24aa'],
      ['Roze', '#ec407a'], ['Bruin', '#6d4c41'], ['Naturel', '#e8dcc0'],
      ['Transparant', '#e0e0e0'], ['Goud', '#d4af37'], ['Zilver', '#bcc6cc'],
      ['Koper', '#b87333'],
    ].forEach(([naam, hex]) => ins.run(naam, hex));
  }
}
