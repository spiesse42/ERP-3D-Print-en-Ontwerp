import { Router } from 'express';
import { getDb } from '../db/index.js';
import { logGebeurtenis, beschrijfWijzigingen, wisHistoriek } from '../domein/historiek.js';

const r = Router();

const VELDEN = ['type', 'naam', 'voornaam', 'bedrijfsnaam', 'email', 'telefoon', 'gsm',
  'straat', 'huisnummer', 'postcode', 'gemeente', 'btw_nummer', 'peppol_id', 'notities'];

// Labels voor de historiek ("Gemeente: Mol → Geel").
const LABELS = {
  type: 'Type', naam: 'Naam', voornaam: 'Voornaam', bedrijfsnaam: 'Bedrijfsnaam', email: 'E-mail',
  telefoon: 'Telefoon', gsm: 'Gsm', straat: 'Straat', huisnummer: 'Huisnummer', postcode: 'Postcode',
  gemeente: 'Gemeente', btw_nummer: 'Ondernemingsnummer', peppol_id: 'Peppol-ID', notities: 'Notities',
};

// Leest en valideert de velden uit het formulier. Lege tekst wordt NULL.
// Een particulier heeft geen bedrijfsnaam of Peppol-ID: die worden gewist
// als je het type terugzet (vroeger bleven ze onzichtbaar bewaard, UX #28).
function leesKlant(body) {
  const k = {};
  for (const v of VELDEN) {
    const w = body?.[v];
    k[v] = (w === undefined || w === null || String(w).trim() === '') ? null : String(w).trim();
  }
  k.type = k.type || 'particulier';
  if (!['particulier', 'zakelijk'].includes(k.type)) return { fout: 'Type moet particulier of zakelijk zijn' };
  if (k.type === 'particulier' && !k.naam) return { fout: 'Naam is verplicht' };
  if (k.type === 'zakelijk' && !k.naam && !k.bedrijfsnaam) return { fout: 'Bedrijfsnaam is verplicht' };
  if (k.type === 'particulier') { k.bedrijfsnaam = null; k.peppol_id = null; }
  if (k.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k.email)) return { fout: 'Dit e-mailadres lijkt niet geldig' };
  return { k };
}

// GET /api/klanten?archief=1 → enkel gearchiveerde; ?archief=alle → allemaal;
// standaard enkel actieve klanten (zoals in Odoo).
r.get('/', (req, res) => {
  const a = req.query.archief;
  const where = a === 'alle' ? '' : a === '1' ? 'WHERE gearchiveerd = 1' : 'WHERE gearchiveerd = 0';
  res.json(getDb().prepare(`SELECT * FROM klanten ${where} ORDER BY COALESCE(bedrijfsnaam, naam) COLLATE NOCASE, voornaam COLLATE NOCASE`).all());
});

r.get('/:id', (req, res) => {
  const klant = getDb().prepare(`SELECT k.*, (SELECT COUNT(*) FROM dossiers d WHERE d.klant_id = k.id) AS aantal_dossiers
    FROM klanten k WHERE k.id = ?`).get(req.params.id);
  if (!klant) return res.status(404).json({ error: 'Klant niet gevonden' });
  res.json(klant);
});

r.post('/', (req, res) => {
  const { k, fout } = leesKlant(req.body);
  if (fout) return res.status(400).json({ error: fout });
  const db = getDb();
  const maak = db.transaction(() => {
    const id = db.prepare(`INSERT INTO klanten (${VELDEN.join(',')}) VALUES (${VELDEN.map(() => '?').join(',')})`)
      .run(...VELDEN.map(v => k[v])).lastInsertRowid;
    logGebeurtenis(db, 'klant', id, 'aangemaakt', null);
    return id;
  });
  try {
    res.status(201).json({ id: maak() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.put('/:id', (req, res) => {
  const { k, fout } = leesKlant(req.body);
  if (fout) return res.status(400).json({ error: fout });
  const db = getDb();
  const oud = db.prepare('SELECT * FROM klanten WHERE id = ?').get(req.params.id);
  if (!oud) return res.status(404).json({ error: 'Klant niet gevonden' });
  const bewaar = db.transaction(() => {
    db.prepare(`UPDATE klanten SET ${VELDEN.map(v => `${v}=?`).join(',')} WHERE id=?`)
      .run(...VELDEN.map(v => k[v]), oud.id);
    const tekst = beschrijfWijzigingen(oud, k, LABELS);
    if (tekst) logGebeurtenis(db, 'klant', oud.id, 'gewijzigd', tekst);
  });
  try {
    bewaar();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Archiveren i.p.v. verwijderen (Odoo): de klant verdwijnt uit de lijsten,
// maar blijft bestaan voor alles wat er later naar verwijst (dossiers).
r.patch('/:id/archief', (req, res) => {
  const db = getDb();
  const gearchiveerd = req.body?.gearchiveerd ? 1 : 0;
  const oud = db.prepare('SELECT gearchiveerd FROM klanten WHERE id = ?').get(req.params.id);
  if (!oud) return res.status(404).json({ error: 'Klant niet gevonden' });
  if (oud.gearchiveerd === gearchiveerd) return res.json({ ok: true });
  db.transaction(() => {
    db.prepare('UPDATE klanten SET gearchiveerd = ? WHERE id = ?').run(gearchiveerd, req.params.id);
    logGebeurtenis(db, 'klant', Number(req.params.id), gearchiveerd ? 'gearchiveerd' : 'hersteld', null);
  })();
  res.json({ ok: true });
});

// Echt verwijderen blijft mogelijk (bv. een per ongeluk aangemaakte klant).
// Vanaf stap 5 weigert dit voor klanten met dossiers (foreign key).
r.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const weg = db.transaction(() => {
      const info = db.prepare('DELETE FROM klanten WHERE id = ?').run(req.params.id);
      if (info.changes) wisHistoriek(db, 'klant', Number(req.params.id));
      return info.changes;
    })();
    if (!weg) return res.status(404).json({ error: 'Klant niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('FOREIGN KEY')) {
      return res.status(400).json({ error: 'Deze klant wordt nog gebruikt. Archiveer de klant in plaats van te verwijderen.' });
    }
    res.status(500).json({ error: e.message });
  }
});

export default r;
