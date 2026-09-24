// ═══════════════════════════════════════════════════════════════════════
// ONDERHOUD (stap 8) — backups van de databank
// ═══════════════════════════════════════════════════════════════════════
// - automatisch: bij het opstarten en daarna elke 24 u (controle elk uur, op
//   basis van de datum van de laatste automatische backup: robuust tegen
//   herstarts, zoals het oude pakket); de laatste 14 blijven bewaard
// - met de hand: Instellingen → Onderhoud → "Nu een backup maken"; de
//   laatste 20 blijven bewaard
// - map: "backups" naast de databank (in de add-on: /data/backups, dus ook
//   mee in de back-ups van Home Assistant). Bijlagen staan in /data/bijlagen.
// - terugzetten: niet met een knop in de app, wel door een bestand
//   "terugzetten.db" in de add-on-map te leggen en te herstarten (run.sh, README)
// BACKUP=uit schakelt de automatische backup uit (bv. lokaal).
import fs from 'fs';
import path from 'path';
import { getDb, databankPad, huidigeVersie } from '../db/index.js';
import { DomeinFout } from './hulp.js';

const BEWAAR = { automatisch: 14, manueel: 20 };
export const backupMap = () => {
  const p = databankPad();
  if (!p || p === ':memory:') return process.env.BACKUP_PAD || null;
  return process.env.BACKUP_PAD || path.join(path.dirname(path.resolve(p)), 'backups');
};
const NAAM = /^erp-(\d{4}-\d{2}-\d{2}_\d{6})-(automatisch|manueel)\.db$/;
// lokale tijd (in de add-on: de ingestelde tijdzone), bv. 2026-09-24_190420
const stempel = (d = new Date()) => {
  const t = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())}_${t(d.getHours())}${t(d.getMinutes())}${t(d.getSeconds())}`;
};

export function lijstBackups() {
  const map = backupMap();
  if (!map || !fs.existsSync(map)) return [];
  return fs.readdirSync(map).filter(f => NAAM.test(f)).map(f => {
    const st = fs.statSync(path.join(map, f));
    return { naam: f, soort: f.match(NAAM)[2], grootte: st.size, gemaakt_op: st.mtime.toISOString() };
  }).sort((a, b) => b.naam.localeCompare(a.naam));
}

export async function maakBackup(soort = 'manueel') {
  const map = backupMap();
  if (!map) throw new DomeinFout('Geen backupmap (databank in het geheugen)');
  fs.mkdirSync(map, { recursive: true });
  const naam = `erp-${stempel()}-${soort}.db`;
  await getDb().backup(path.join(map, naam));   // consistente kopie, ook terwijl de app draait
  // opruimen: enkel de laatste N van dit soort
  lijstBackups().filter(b => b.soort === soort).slice(BEWAAR[soort]).forEach(b => { try { fs.unlinkSync(path.join(map, b.naam)); } catch { /* al weg */ } });
  return naam;
}

export function backupBestand(naam) {
  if (!NAAM.test(naam || '')) throw Object.assign(new DomeinFout('Onbekende backup'), { status: 404 });
  const p = path.join(backupMap(), naam);
  if (!fs.existsSync(p)) throw Object.assign(new DomeinFout('Backup niet gevonden'), { status: 404 });
  return p;
}

export function info(versie) {
  return { versie, db_versie: huidigeVersie(), db_pad: databankPad(), backup_map: backupMap(), automatisch: process.env.BACKUP !== 'uit', node: process.version };
}

const uurGeleden = () => {
  const auto = lijstBackups().filter(b => b.soort === 'automatisch');
  return auto.length ? (Date.now() - Date.parse(auto[0].gemaakt_op)) / 3600e3 : Infinity;
};
let timer = null;
export function startAutoBackup() {
  if (timer || process.env.BACKUP === 'uit' || !backupMap()) return;
  const check = () => { if (uurGeleden() >= 24) maakBackup('automatisch').then(n => console.log(`[backup] ${n}`)).catch(e => console.error('[backup]', e.message)); };
  check();
  timer = setInterval(check, 3600e3);
  timer.unref?.();
}
export function stopAutoBackup() { if (timer) clearInterval(timer); timer = null; }
