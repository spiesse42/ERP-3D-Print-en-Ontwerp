// /api/printers — printers beheren (stap 4): naam, machinetarief (verplicht om
// te kunnen rekenen, geen terugval), gemiddeld verbruik, actief.
// Home Assistant-koppeling en live-monitoring volgen in stap 6.
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { isUniekFout, isFkFout, optioneelGetal } from '../domein/hulp.js';
import { logGebeurtenis, beschrijfWijzigingen, wisHistoriek } from '../domein/historiek.js';
import { KOPPELINGEN, metDomein } from '../productie/adapters.js';

const r = Router();
const LABELS = { naam: 'Naam', machine_per_uur: 'Machinetarief (€/u)', verbruik_watt: 'Gemiddeld verbruik (W)', notities: 'Notities',
  koppeling: 'Koppeling', ha_prefix: 'Begin entiteitsnamen', watt_entity: 'Wattmeter', kwh_entity: 'kWh-meter', camera_entity: 'Camera',
  pauze_entity: 'Pauzeknop', hervat_entity: 'Hervatknop', annuleer_entity: 'Annuleerknop' };
// Koppeling met Home Assistant (stap 6a). Knoppen en camera hebben een
// eigen domein (button., camera.) en moeten dus volledig ingevuld worden.
const VELDEN = ['naam', 'machine_per_uur', 'verbruik_watt', 'notities', 'koppeling', 'ha_prefix', 'watt_entity', 'kwh_entity', 'camera_entity', 'pauze_entity', 'hervat_entity', 'annuleer_entity'];
const KOPPEL_VELDEN = ['ha_prefix', 'watt_entity', 'kwh_entity', 'camera_entity', 'pauze_entity', 'hervat_entity', 'annuleer_entity'];
const VOLLEDIG = { camera_entity: 'camera.', pauze_entity: 'button.', hervat_entity: 'button.', annuleer_entity: 'button.' };

function lees(body) {
  const naam = String(body?.naam || '').trim();
  if (!naam) return { fout: 'Naam is verplicht' };
  const machine = optioneelGetal(body?.machine_per_uur);
  const watt = optioneelGetal(body?.verbruik_watt);
  if (Number.isNaN(machine) || (machine !== null && machine < 0)) return { fout: 'Machinetarief moet een getal ≥ 0 zijn' };
  if (Number.isNaN(watt) || (watt !== null && watt < 0)) return { fout: 'Verbruik moet een getal ≥ 0 zijn (watt)' };
  const notities = String(body?.notities || '').trim() || null;
  const koppeling = body?.koppeling || 'manueel';
  if (!KOPPELINGEN[koppeling]) return { fout: 'Onbekende koppeling' };
  const k = {};
  for (const v of KOPPEL_VELDEN) {
    const t = String(body?.[v] ?? '').trim();
    if (t && !/^[a-z0-9_.]+$/.test(t)) return { fout: `${LABELS[v]}: enkel kleine letters, cijfers, _ en . (bv. ${VOLLEDIG[v] || 'sensor.'}mijn_printer)` };
    if (t && VOLLEDIG[v] && !/^[a-z_]+\./.test(t)) return { fout: `${LABELS[v]} moet een volledige entiteit zijn, met domein (bv. ${VOLLEDIG[v]}${t})` };
    k[v] = t ? (['watt_entity', 'kwh_entity', 'ha_prefix'].includes(v) ? metDomein(t) : t) : null;
  }
  if (koppeling !== 'manueel' && !k.ha_prefix) return { fout: 'Vul het begin van de entiteitsnamen in (bv. sensor.a1mini_0309_)' };
  return { p: { naam, machine_per_uur: machine, verbruik_watt: watt, notities, koppeling, ...k } };
}

r.get('/', (req, res) => {
  const waar = req.query.actief === '1' ? 'WHERE actief = 1' : '';
  res.json(getDb().prepare(`SELECT * FROM printers ${waar} ORDER BY actief DESC, naam COLLATE NOCASE`).all());
});

r.post('/', (req, res) => {
  const { p, fout } = lees(req.body);
  if (fout) return res.status(400).json({ error: fout });
  const db = getDb();
  try {
    const id = db.transaction(() => {
      const n = db.prepare(`INSERT INTO printers (${VELDEN.join(',')}) VALUES (${VELDEN.map(() => '?').join(',')})`).run(...VELDEN.map(v => p[v])).lastInsertRowid;
      logGebeurtenis(db, 'printer', n, 'aangemaakt', null);
      return n;
    })();
    res.status(201).json({ id });
  } catch (e) {
    if (isUniekFout(e)) return res.status(400).json({ error: `Er bestaat al een printer "${p.naam}"` });
    res.status(500).json({ error: e.message });
  }
});

r.put('/:id', (req, res) => {
  const { p, fout } = lees(req.body);
  if (fout) return res.status(400).json({ error: fout });
  const db = getDb();
  const oud = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
  if (!oud) return res.status(404).json({ error: 'Printer niet gevonden' });
  try {
    db.transaction(() => {
      db.prepare(`UPDATE printers SET ${VELDEN.map(v => `${v}=?`).join(', ')} WHERE id=?`).run(...VELDEN.map(v => p[v]), oud.id);
      const t = beschrijfWijzigingen(oud, p, LABELS);
      if (t) logGebeurtenis(db, 'printer', oud.id, 'gewijzigd', t);
    })();
    res.json({ ok: true });
  } catch (e) {
    if (isUniekFout(e)) return res.status(400).json({ error: `Er bestaat al een printer "${p.naam}"` });
    res.status(500).json({ error: e.message });
  }
});

// Deactiveren i.p.v. verwijderen: een oude printer verdwijnt uit de
// keuzelijsten, maar blijft bestaan voor oude offertes en werkbonnen.
r.patch('/:id/actief', (req, res) => {
  const db = getDb();
  const aan = req.body?.actief ? 1 : 0;
  const oud = db.prepare('SELECT actief FROM printers WHERE id = ?').get(req.params.id);
  if (!oud) return res.status(404).json({ error: 'Printer niet gevonden' });
  if (oud.actief !== aan) {
    db.transaction(() => {
      db.prepare('UPDATE printers SET actief = ? WHERE id = ?').run(aan, req.params.id);
      logGebeurtenis(db, 'printer', Number(req.params.id), aan ? 'hersteld' : 'gearchiveerd', aan ? 'Terug actief' : 'Gedeactiveerd');
    })();
  }
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const n = db.transaction(() => {
      const c = db.prepare('DELETE FROM printers WHERE id = ?').run(req.params.id).changes;
      if (c) wisHistoriek(db, 'printer', Number(req.params.id));
      return c;
    })();
    if (!n) return res.status(404).json({ error: 'Printer niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isFkFout(e)) return res.status(400).json({ error: 'Deze printer wordt nog gebruikt. Deactiveer hem in plaats van te verwijderen.' });
    res.status(500).json({ error: e.message });
  }
});

export default r;
