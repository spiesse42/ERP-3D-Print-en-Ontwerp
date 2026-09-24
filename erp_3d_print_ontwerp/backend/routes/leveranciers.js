// /api/leveranciers — volledig beheer (stap 3b): lijst, formulier,
// archiveren, verwijderen zolang er niets naar verwijst, historiek.
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { isFkFout, isUniekFout } from '../domein/hulp.js';
import { logGebeurtenis, beschrijfWijzigingen, wisHistoriek } from '../domein/historiek.js';

const r = Router();
const VELDEN = ['naam', 'email', 'telefoon', 'website', 'btw_nummer', 'klantnummer', 'notities'];
const LABELS = { naam: 'Naam', email: 'E-mail', telefoon: 'Telefoon', website: 'Website', btw_nummer: 'Btw-nummer', klantnummer: 'Ons klantnummer', notities: 'Notities' };

function lees(body) {
  const l = {};
  for (const v of VELDEN) { const w = body?.[v]; l[v] = w == null || String(w).trim() === '' ? null : String(w).trim(); }
  if (!l.naam) return { fout: 'Naam is verplicht' };
  if (l.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) return { fout: 'Dit e-mailadres lijkt niet geldig' };
  return { l };
}

const TELLERS = `
  (SELECT COUNT(*) FROM aankopen a WHERE a.leverancier_id = l.id) AS aankopen,
  (SELECT COUNT(DISTINCT al.artikel_id) FROM artikel_leveranciers al WHERE al.leverancier_id = l.id) AS artikelen`;

// ?archief=1 → enkel gearchiveerde, ?archief=alle → alles, standaard actief.
r.get('/', (req, res) => {
  const a = req.query.archief;
  const waar = a === 'alle' ? '' : a === '1' ? 'WHERE l.gearchiveerd = 1' : 'WHERE l.gearchiveerd = 0';
  res.json(getDb().prepare(`SELECT l.*, ${TELLERS} FROM leveranciers l ${waar} ORDER BY l.naam COLLATE NOCASE`).all());
});

r.get('/:id', (req, res) => {
  const db = getDb();
  const l = db.prepare(`SELECT l.*, ${TELLERS} FROM leveranciers l WHERE l.id = ?`).get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Leverancier niet gevonden' });
  l.artikellijst = db.prepare(`SELECT al.*, a.type, a.naam, a.gearchiveerd, m.naam merk, mat.naam materiaal, k.naam kleur, k.hex kleur_hex
    FROM artikel_leveranciers al JOIN artikelen a ON a.id = al.artikel_id
    LEFT JOIN filament_types ft ON ft.id = a.filament_type_id
    LEFT JOIN filament_merken m ON m.id = ft.merk_id
    LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id
    LEFT JOIN filament_kleuren k ON k.id = a.kleur_id
    WHERE al.leverancier_id = ?`).all(l.id)
    .map(x => ({ ...x, weergave: x.type === 'filament' ? `${x.merk} ${x.materiaal} · ${x.kleur}` : x.naam }))
    .sort((x, y) => x.weergave.localeCompare(y.weergave, 'nl'));
  res.json(l);
});

r.post('/', (req, res) => {
  const { l, fout } = lees(req.body);
  if (fout) return res.status(400).json({ error: fout });
  const db = getDb();
  try {
    const id = db.transaction(() => {
      const n = db.prepare(`INSERT INTO leveranciers (${VELDEN.join(',')}) VALUES (${VELDEN.map(() => '?').join(',')})`).run(...VELDEN.map(v => l[v])).lastInsertRowid;
      logGebeurtenis(db, 'leverancier', n, 'aangemaakt', null);
      return n;
    })();
    res.status(201).json({ id, naam: l.naam });
  } catch (e) {
    if (isUniekFout(e)) return res.status(400).json({ error: `Leverancier "${l.naam}" bestaat al` });
    res.status(500).json({ error: e.message });
  }
});

r.put('/:id', (req, res) => {
  const { l, fout } = lees(req.body);
  if (fout) return res.status(400).json({ error: fout });
  const db = getDb();
  const oud = db.prepare('SELECT * FROM leveranciers WHERE id = ?').get(req.params.id);
  if (!oud) return res.status(404).json({ error: 'Leverancier niet gevonden' });
  try {
    db.transaction(() => {
      db.prepare(`UPDATE leveranciers SET ${VELDEN.map(v => `${v}=?`).join(',')} WHERE id=?`).run(...VELDEN.map(v => l[v]), oud.id);
      const t = beschrijfWijzigingen(oud, l, LABELS);
      if (t) logGebeurtenis(db, 'leverancier', oud.id, 'gewijzigd', t);
    })();
    res.json({ ok: true });
  } catch (e) {
    if (isUniekFout(e)) return res.status(400).json({ error: `Leverancier "${l.naam}" bestaat al` });
    res.status(500).json({ error: e.message });
  }
});

r.patch('/:id/archief', (req, res) => {
  const db = getDb();
  const aan = req.body?.gearchiveerd ? 1 : 0;
  const oud = db.prepare('SELECT gearchiveerd FROM leveranciers WHERE id = ?').get(req.params.id);
  if (!oud) return res.status(404).json({ error: 'Leverancier niet gevonden' });
  if (oud.gearchiveerd !== aan) {
    db.transaction(() => {
      db.prepare('UPDATE leveranciers SET gearchiveerd = ? WHERE id = ?').run(aan, req.params.id);
      logGebeurtenis(db, 'leverancier', Number(req.params.id), aan ? 'gearchiveerd' : 'hersteld', null);
    })();
  }
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const n = db.transaction(() => {
      const c = db.prepare('DELETE FROM leveranciers WHERE id = ?').run(req.params.id).changes;
      if (c) wisHistoriek(db, 'leverancier', Number(req.params.id));
      return c;
    })();
    if (!n) return res.status(404).json({ error: 'Leverancier niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isFkFout(e)) return res.status(400).json({ error: 'Deze leverancier heeft aankopen of gekoppelde artikelen. Archiveer in plaats van te verwijderen.' });
    res.status(500).json({ error: e.message });
  }
});

export default r;
