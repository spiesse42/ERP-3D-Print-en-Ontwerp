// ═══════════════════════════════════════════════════════════════════════
// LEVERINGEN + PAKBON (stap 5c)
// ═══════════════════════════════════════════════════════════════════════
// Leverbaar zijn printregels en artikelregels (geen diensten zoals
// verzending, geen ontwerp/aanpassing/extra). Besteld = het aantal op de
// regel; geleverd = som van de leveringen. Een artikel met voorraad (geen
// dienst) boekt bij levering FIFO uit.
import { DomeinFout } from './hulp.js';
import { volgendNummer } from './nummering.js';
import { boekUit, voorraadVan } from './voorraad.js';
import { logGebeurtenis } from './historiek.js';

const r3 = x => Math.round(x * 1000) / 1000;
const STANDAARD = { printen: 'Printwerk' };

function geleverdPerRegel(db, dossierId) {
  return new Map(db.prepare(`SELECT lr.dossier_regel_id id, SUM(lr.aantal) n FROM levering_regels lr
    JOIN leveringen l ON l.id = lr.levering_id WHERE l.dossier_id = ? GROUP BY lr.dossier_regel_id`).all(dossierId).map(x => [x.id, x.n]));
}

// Welke regels geleverd worden, met besteld / geleverd / nog te leveren.
export function leverbaar(db, dossierId, regels) {
  const geleverd = geleverdPerRegel(db, dossierId);
  const art = db.prepare('SELECT id, type, naam FROM artikelen WHERE id = ?');
  return regels.flatMap(r => {
    let artikel = null;
    if (r.type === 'artikel') {
      artikel = r.artikel_id ? art.get(r.artikel_id) : null;
      if (!artikel || artikel.type === 'dienst') return [];
    } else if (r.type !== 'printen') return [];
    const besteld = Number(r.aantal ?? 1);
    const g = geleverd.get(r.id) || 0;
    return [{
      regel_id: r.id, type: r.type, omschrijving: r.omschrijving || artikel?.naam || STANDAARD[r.type],
      besteld, geleverd: r3(g), rest: r3(Math.max(0, besteld - g)),
      boekt_voorraad: !!artikel, artikel_id: artikel?.id ?? null, voorraad: artikel ? voorraadVan(db, artikel.id) : null,
    }];
  });
}

// 'geen' | 'deels' | 'geleverd' — of null als er niets te leveren valt.
export function leverStatus(lijst) {
  if (!lijst.length) return null;
  if (lijst.every(x => x.rest <= 0)) return 'geleverd';
  return lijst.some(x => x.geleverd > 0) ? 'deels' : 'geen';
}

// Snelle versie voor lijsten (zonder omschrijvingen/voorraad).
export function leverStatusVan(db, dossierId) {
  const regels = db.prepare(`SELECT r.id, r.type, r.aantal, a.type AS artikel_type FROM dossier_regels r
    LEFT JOIN artikelen a ON a.id = r.artikel_id WHERE r.dossier_id = ?`).all(dossierId)
    .filter(r => r.type === 'printen' || (r.type === 'artikel' && r.artikel_type && r.artikel_type !== 'dienst'));
  const g = geleverdPerRegel(db, dossierId);
  return leverStatus(regels.map(r => { const n = g.get(r.id) || 0; return { geleverd: n, rest: Number(r.aantal ?? 1) - n }; }));
}

export function leveringenVan(db, dossierId) {
  const lijst = db.prepare('SELECT * FROM leveringen WHERE dossier_id = ? ORDER BY datum, id').all(dossierId);
  const regels = db.prepare('SELECT dossier_regel_id, aantal, omschrijving FROM levering_regels WHERE levering_id = ? ORDER BY id');
  const laatste = lijst.reduce((m, l) => Math.max(m, l.id), 0);
  return lijst.map(l => ({ ...l, regels: regels.all(l.id), laatste: l.id === laatste }));
}

// Geleverde regels mogen niet weg, niet van soort/artikel veranderen en niet
// onder het geleverde aantal zakken (gebruikt door bewaarRegels).
export function controleerGeleverd(db, dossierId, nieuweRegels) {
  const geleverd = geleverdPerRegel(db, dossierId);
  if (!geleverd.size) return;
  const oud = new Map(db.prepare(`SELECT r.id, r.type, r.artikel_id, r.omschrijving, a.naam AS artikel_naam FROM dossier_regels r
    LEFT JOIN artikelen a ON a.id = r.artikel_id WHERE r.dossier_id = ?`).all(dossierId).map(r => [r.id, r]));
  for (const [id, n] of geleverd) {
    const o = oud.get(id);
    const naam = `"${o?.omschrijving || o?.artikel_naam || STANDAARD[o?.type] || 'regel'}"`;
    const nieuw = nieuweRegels.find(r => r.id === id);
    if (!nieuw) throw new DomeinFout(`Regel ${naam} is al (deels) geleverd en kan niet weg. Maak eerst de levering ongedaan.`);
    if (nieuw.type !== o.type || (o.type === 'artikel' && nieuw.artikel_id !== o.artikel_id)) throw new DomeinFout(`Regel ${naam} is al (deels) geleverd: het soort of artikel kan niet meer wijzigen.`);
    if (Number(nieuw.aantal ?? 1) < n - 1e-9) throw new DomeinFout(`Regel ${naam}: er zijn al ${String(r3(n)).replace('.', ',')} stuks geleverd, het aantal kan niet lager.`);
  }
}

const datumOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
const dmj = d => d.split('-').reverse().join('-');

export function maakLevering(db, dossier, body) {
  const datum = body?.datum;
  if (!datumOk(datum)) throw new DomeinFout('Vul een geldige leverdatum in');
  const lijst = leverbaar(db, dossier.id, dossier.regels);
  const perRegel = new Map(lijst.map(x => [x.regel_id, x]));
  const invoer = (Array.isArray(body?.regels) ? body.regels : []).map(x => {
    const t = String(x.aantal ?? '').trim();
    const n = typeof x.aantal === 'number' ? x.aantal : t === '' ? 0 : parseFloat(t.replace(',', '.'));
    return { regel_id: Number(x.regel_id), aantal: Number.isFinite(n) ? r3(n) : NaN };
  });
  const regels = [];
  for (const x of invoer) {
    const l = perRegel.get(x.regel_id);
    if (!l) throw new DomeinFout('Deze regel kan niet geleverd worden');
    if (!Number.isFinite(x.aantal) || x.aantal < 0) throw new DomeinFout(`${l.omschrijving}: aantal moet een getal groter dan 0 zijn`);
    if (x.aantal === 0) continue;
    if (x.aantal > l.rest + 1e-9) throw new DomeinFout(`${l.omschrijving}: nog ${String(l.rest).replace('.', ',')} te leveren, niet ${String(x.aantal).replace('.', ',')}`);
    regels.push({ ...l, aantal: x.aantal });
  }
  if (!regels.length) throw new DomeinFout('Vul bij minstens één regel een aantal in');
  const nummer = volgendNummer(db, 'PB');
  const opm = String(body?.opmerking ?? '').trim() || null;
  const id = Number(db.prepare('INSERT INTO leveringen (dossier_id, nummer, datum, opmerking) VALUES (?,?,?,?)').run(dossier.id, nummer, datum, opm).lastInsertRowid);
  const ins = db.prepare('INSERT INTO levering_regels (levering_id, dossier_regel_id, aantal, omschrijving) VALUES (?,?,?,?)');
  for (const r of regels) {
    const lrId = Number(ins.run(id, r.regel_id, r.aantal, r.omschrijving).lastInsertRowid);
    if (r.boekt_voorraad) {
      try {
        boekUit(db, { artikelId: r.artikel_id, aantal: r.aantal, reden: 'levering', bronType: 'levering_regel', bronId: lrId, notitie: `Levering ${nummer} (dossier ${dossier.nummer})` });
      } catch (e) {
        if (e instanceof DomeinFout) throw new DomeinFout(`${r.omschrijving}: ${e.message}. Boek eerst de voorraad in (Voorraad → artikel) of lever minder.`);
        throw e;
      }
    }
  }
  logGebeurtenis(db, 'dossier', dossier.id, 'status', `Geleverd (pakbon ${nummer}, ${dmj(datum)}): ${regels.map(r => `${String(r.aantal).replace('.', ',')} × ${r.omschrijving}`).join(', ')}`);
  return id;
}

// Enkel de laatste levering van een dossier; voorraad terug op dezelfde partijen.
export function verwijderLevering(db, levering) {
  const laatste = db.prepare('SELECT MAX(id) m FROM leveringen WHERE dossier_id = ?').get(levering.dossier_id).m;
  if (levering.id !== laatste) throw new DomeinFout('Enkel de laatste levering kan ongedaan gemaakt worden.');
  const lr = db.prepare('SELECT id FROM levering_regels WHERE levering_id = ?').all(levering.id).map(x => x.id);
  if (lr.length) {
    const muts = db.prepare(`SELECT * FROM voorraad_mutaties WHERE bron_type = 'levering_regel' AND bron_id IN (${lr.map(() => '?').join(',')}) AND aantal < 0`).all(...lr);
    const terug = db.prepare('UPDATE voorraad_partijen SET aantal_resterend = aantal_resterend + ? WHERE id = ?');
    const mut = db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden, bron_type, bron_id, notitie) VALUES (?,?,?,?,?,?,?)`);
    for (const m of muts) {
      if (m.partij_id) terug.run(-m.aantal, m.partij_id);
      mut.run(m.artikel_id, m.partij_id, -m.aantal, 'correctie', 'levering_regel', m.bron_id, `Levering ${levering.nummer} ongedaan gemaakt`);
    }
  }
  db.prepare('DELETE FROM leveringen WHERE id = ?').run(levering.id);
  logGebeurtenis(db, 'dossier', levering.dossier_id, 'status', `Levering ${levering.nummer} ongedaan gemaakt${lr.length ? ' (voorraad teruggeboekt waar van toepassing)' : ''}`);
}
