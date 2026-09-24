import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { migrateDbV2 } from './db_migration_v2.js';
import { migrateDbV3 } from './db_migration_v3.js';
import { migrateDbV4 } from './db_migration_v4.js';
import { migrateDbV5 } from './db_migration_v5.js';
import { migrateDbV6 } from './db_migration_v6.js';
import { migrateDbV7 } from './db_migration_v7.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'erp.db');

let db;

export function getDb() {
  if (!db) throw new Error('Database nog niet geïnitialiseerd — initDb() eerst aanroepen.');
  return db;
}

// Fase 0 — schema opnieuw ontworpen vanaf 0 (geen import uit het oude pakket).
// Vanaf hier geldt dezelfde discipline als in het oude pakket: dit db.js-bestand
// is enkel de basis-schema (v1, equivalent aan een db_migration.js v1). Elke
// latere wijziging komt in een eigen db_migration_vNN.js én wordt hier expliciet
// geregistreerd (import + aanroep) — dat laatste stap was precies waar het oude
// pakket ooit een migratie vergat te registreren (voorraad_mutaties-episode).
export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS klanten (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'particulier' CHECK (type IN ('particulier','zakelijk')),
      naam TEXT NOT NULL,
      voornaam TEXT,
      bedrijfsnaam TEXT,
      email TEXT,
      telefoon TEXT,
      gsm TEXT,
      straat TEXT,
      huisnummer TEXT,
      postcode TEXT,
      gemeente TEXT,
      btw_nummer TEXT,
      notities TEXT,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tarieven (
      sleutel TEXT PRIMARY KEY,
      waarde REAL NOT NULL,
      eenheid TEXT,
      label TEXT
    );

    -- Vrije tekst-instellingen (bedrijfsgegevens, later ook HA-url/backup/
    -- drempels in Fase 1+). Zelfde patroon als het oude pakket: een allowlist
    -- in de route bepaalt welke sleutels via de API gelezen/gewijzigd mogen
    -- worden — geheimen (tokens/wachtwoorden) horen hier nooit in.
    CREATE TABLE IF NOT EXISTS instellingen (
      sleutel TEXT PRIMARY KEY,
      waarde TEXT,
      label TEXT
    );
  `);

  // v2 — Filament/Voorraad. Eigen genummerd migratiebestand + expliciete
  // registratie hier, zoals het commentaar hierboven voorschrijft.
  migrateDbV2(db);
  // v3 — Voorraad-vereenvoudiging: gewicht_gram_start/huidig weer geschrapt
  // (zie db_migration_v3.js).
  migrateDbV3(db);
  // v4 — Artikelen (onderdelen + diensten) + batch_id voor gegroepeerde
  // voorraadweergave (zie db_migration_v4.js).
  migrateDbV4(db);
  // v5 — Eindproducten (webshop) als derde artikel-categorie, naast
  // onderdeel/dienst (zie db_migration_v5.js).
  migrateDbV5(db);
  // v6 — Inkoopprijs/marge% (onderdeel) en productieprijs (eindproduct) op
  // artikel_types (zie db_migration_v6.js).
  migrateDbV6(db);
  // v7 — Aankoopfacturen/OCR: facturen-tabel + factuur_id op filament_rollen
  // en artikel_voorraad (zie db_migration_v7.js).
  migrateDbV7(db);

  const tarievenCount = db.prepare('SELECT COUNT(*) as c FROM tarieven').get().c;
  if (tarievenCount === 0) {
    const ins = db.prepare('INSERT INTO tarieven (sleutel,waarde,eenheid,label) VALUES (?,?,?,?)');
    ins.run('kwh_prijs',          0.35, 'EUR/kWh', 'Elektriciteitsprijs');
    ins.run('machine_per_uur',    0.13, 'EUR/u',   'Machinekost (globaal, terugval)');
    ins.run('marge_grens_uur',    3.00, 'u',       'Grens klein/groot (printtijd)');
    ins.run('marge_klein_pct',   18.00, '%',       'Winstmarge — klein (korter dan grens)');
    ins.run('marge_groot_pct',   10.00, '%',       'Winstmarge — groot (langer dan grens)');
    ins.run('faalfactor_pct',    10.00, '%',       'Faalfactor (op materiaalkost)');
    ins.run('voorbereiding_min', 10.00, 'min',     'Vaste voorbereidingstijd per print');
    ins.run('nabewerking_min',    5.00, 'min',     'Vaste nabewerkingstijd per print');
    ins.run('ontwerp_tarief',    25.00, 'EUR/u',   'Ontwerp op maat (regie)');
    ins.run('nabewerking_tarief',20.00, 'EUR/u',   'Uitgebreide nabewerking (regie)');
    ins.run('arbeid_per_uur',    15.00, 'EUR/u',   'Arbeidskost (regie)');
    ins.run('bmcu_per_job',       0.10, 'EUR',     'BMCU-slijtage per multicolor job');
  }

  console.log('Database geïnitialiseerd:', DB_PATH);
}
