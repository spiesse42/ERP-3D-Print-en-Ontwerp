// ═══════════════════════════════════════════════════════════════════════
// DATABANK — openen + automatisch migreren
// ═══════════════════════════════════════════════════════════════════════
//
// Nieuwe aanpak (stap 1 van de herziene roadmap, 23-09-2026):
// - Eén geordende lijst migraties (db/migraties/index.js). Elke migratie heeft
//   een versienummer; de databank onthoudt zelf tot waar ze gemigreerd is via
//   `PRAGMA user_version`. Bij het opstarten wordt enkel uitgevoerd wat nog
//   ontbreekt, elke migratie in één transactie (alles of niets).
// - Geen handmatige registratie in dit bestand meer, en geen "ben ik al
//   uitgevoerd?"-detectie per migratie (PRAGMA table_info, test-updates, ...).
// - Een nieuwe migratie toevoegen = een bestand in db/migraties/ + één regel
//   in db/migraties/index.js. Een uitgevoerde migratie wordt NOOIT meer
//   aangepast; een correctie is altijd een nieuwe migratie.

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { MIGRATIES } from './migraties/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STANDAARD_PAD = path.join(__dirname, '..', 'erp.db');

let db = null;
let dbPad = null;

export function getDb() {
  if (!db) throw new Error('Databank nog niet geopend: roep eerst initDb() aan.');
  return db;
}

// Opent (of maakt) de databank en brengt ze op de laatste versie.
// `pad` is optioneel: tests geven ':memory:' of een tijdelijk bestand mee.
export function initDb(pad = process.env.DB_PATH || STANDAARD_PAD) {
  if (db) db.close();
  db = new Database(pad);
  dbPad = pad;
  if (pad !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  weigerOudeDatabank(db);
  migreer(db, MIGRATIES);
  if (process.env.NODE_ENV !== 'test') console.log(`Databank klaar (versie ${huidigeVersie(db)}): ${pad}`);
  return db;
}

// Map voor bijlagen (factuur-PDF's, foto's van bonnetjes): naast de databank,
// zodat ze mee in dezelfde (Home Assistant-)datamap en back-up zitten.
// Aanpasbaar via BIJLAGEN_PAD. Bij een databank in het geheugen (tests): tmp.
export function bijlagenMap() {
  if (process.env.BIJLAGEN_PAD) return process.env.BIJLAGEN_PAD;
  if (!dbPad || dbPad === ':memory:') return path.join(os.tmpdir(), 'erp-bijlagen-test');
  return path.join(path.dirname(path.resolve(dbPad)), 'bijlagen');
}

// Pad van de open databank (stap 8: backups), of null.
export function databankPad() { return dbPad; }

export function sluitDb() {
  if (db) { db.close(); db = null; }
}

export function huidigeVersie(d = getDb()) {
  return d.pragma('user_version', { simple: true });
}

// Voert alle migraties uit met een versie hoger dan de huidige, in volgorde.
// Geëxporteerd voor de tests.
export function migreer(d, migraties) {
  const versies = migraties.map(m => m.versie);
  const gesorteerd = [...versies].sort((a, b) => a - b);
  if (versies.some((v, i) => v !== gesorteerd[i]) || new Set(versies).size !== versies.length) {
    throw new Error('Migraties moeten oplopend en uniek genummerd zijn.');
  }
  let versie = huidigeVersie(d);
  for (const m of migraties) {
    if (m.versie <= versie) continue;
    // Een migratie die een tabel herbouwt waar andere tabellen naar verwijzen
    // (bv. artikelen in 003) zet `fkUit = true`. Volgens de werkwijze van
    // SQLite gaan de foreign keys dan tijdelijk uit (dat kan enkel BUITEN een
    // transactie), en wordt vóór het vastleggen gecontroleerd dat alle
    // verwijzingen nog kloppen. Klopt er één niet → alles teruggedraaid.
    const fkWasAan = d.pragma('foreign_keys', { simple: true }) === 1;
    if (m.fkUit) d.pragma('foreign_keys = OFF');
    try {
      d.transaction(() => {
        m.up(d);
        if (m.fkUit) {
          const fout = d.pragma('foreign_key_check');
          if (fout.length) throw new Error(`Migratie ${m.versie}: ${fout.length} verbroken verwijzing(en), bv. in tabel ${fout[0].table}.`);
        }
        d.pragma(`user_version = ${m.versie}`);
      })();
    } finally {
      if (m.fkUit && fkWasAan) d.pragma('foreign_keys = ON');
    }
    versie = m.versie;
    if (process.env.NODE_ENV !== 'test') console.log(`Migratie ${String(m.versie).padStart(3, '0')} uitgevoerd: ${m.naam}`);
  }
}

// Beveiliging voor de overstap (optie A, 23-09-2026: volledig van 0 beginnen).
// Een databank uit de vorige opbouw (v2–v7) heeft user_version 0 maar al wel
// tabellen zoals filament_rollen. Daar bovenop migreren zou half werken en
// verwarrende fouten geven, dus liever meteen een duidelijke melding.
function weigerOudeDatabank(d) {
  if (huidigeVersie(d) !== 0) return;
  const oud = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('filament_rollen','artikel_voorraad','artikel_types','facturen')`).all();
  if (oud.length) {
    throw new Error(
      'Er staat nog een databank uit de vorige opbouw (' + oud.map(t => t.name).join(', ') + '). ' +
      'Verwijder erp.db, erp.db-wal en erp.db-shm in de backend-map en start opnieuw (afspraak: volledig van 0 beginnen).'
    );
  }
}
