// ═══════════════════════════════════════════════════════════════════════
// /api/inkoop — aankopen (stap 3b)
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb, bijlagenMap } from '../db/index.js';
import { DomeinFout, isFkFout } from '../domein/hulp.js';
import { wisHistoriek } from '../domein/historiek.js';
import { laatstePrijs } from '../domein/voorraad.js';
import {
  leesAankoop, leesAankopen, leesKop, leesRegelInvoer, maakAankoop, bewaarAankoop,
  bestel, annuleer, heropen, ontvang, bestellingenMaken,
} from '../domein/aankopen.js';

const r = Router();

function metFouten(fn) {
  return (req, res) => {
    try { fn(req, res); } catch (e) {
      if (e instanceof DomeinFout) return res.status(400).json({ error: e.message });
      if (isFkFout(e)) return res.status(400).json({ error: 'Onbekende leverancier, artikel, type of kleur' });
      res.status(500).json({ error: e.message });
    }
  };
}
const idVan = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new DomeinFout('Ongeldig id');
  return id;
};
const regelsUit = body => {
  if (body?.regels === undefined) return [];
  if (!Array.isArray(body.regels)) throw new DomeinFout('Regels moeten een lijst zijn');
  return body.regels.map(leesRegelInvoer);
};

// ?leverancier_id=… of ?artikel_id=… (aankopen met dat artikel)
r.get('/aankopen', metFouten((req, res) => {
  res.json(leesAankopen(getDb(), {
    leverancierId: req.query.leverancier_id ? Number(req.query.leverancier_id) : null,
    artikelId: req.query.artikel_id ? Number(req.query.artikel_id) : null,
  }));
}));

r.get('/aankopen/:id', metFouten((req, res) => {
  const a = leesAankoop(getDb(), idVan(req));
  if (!a) return res.status(404).json({ error: 'Aankoop niet gevonden' });
  res.json(a);
}));

r.post('/aankopen', metFouten((req, res) => {
  const db = getDb();
  const kop = leesKop(req.body);
  const regels = regelsUit(req.body);
  const uit = db.transaction(() => maakAankoop(db, kop, regels))();
  res.status(201).json(uit);
}));

r.put('/aankopen/:id', metFouten((req, res) => {
  const db = getDb();
  const id = idVan(req);
  const kop = leesKop(req.body);
  const regels = regelsUit(req.body);
  res.json(db.transaction(() => bewaarAankoop(db, id, kop, regels))());
}));

// Acties: bestellen, annuleren, heropenen, ontvangen — elk in één transactie.
r.post('/aankopen/:id/bestellen', metFouten((req, res) => {
  const db = getDb(); const id = idVan(req);
  db.transaction(() => bestel(db, id))();
  res.json(leesAankoop(db, id));
}));
r.post('/aankopen/:id/annuleren', metFouten((req, res) => {
  const db = getDb(); const id = idVan(req);
  db.transaction(() => annuleer(db, id))();
  res.json(leesAankoop(db, id));
}));
r.post('/aankopen/:id/heropenen', metFouten((req, res) => {
  const db = getDb(); const id = idVan(req);
  db.transaction(() => heropen(db, id))();
  res.json(leesAankoop(db, id));
}));
// POST { lijnen: [{ regel_id, aantal, merk_id?, nieuwe_prijs_per_kg? }], datum?, locatie? }
r.post('/aankopen/:id/ontvangen', metFouten((req, res) => {
  const db = getDb(); const id = idVan(req);
  const datum = req.body?.datum || null;
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new DomeinFout('Datum moet de vorm JJJJ-MM-DD hebben');
  const locatie = String(req.body?.locatie || '').trim() || null;
  res.json(db.transaction(() => ontvang(db, id, req.body?.lijnen, { datum, locatie }))());
}));

// Enkel een concept zonder ontvangst kan echt weg (anders: annuleren).
r.delete('/aankopen/:id', metFouten((req, res) => {
  const db = getDb(); const id = idVan(req);
  const a = leesAankoop(db, id);
  if (!a) return res.status(404).json({ error: 'Aankoop niet gevonden' });
  if (a.status !== 'concept') throw new DomeinFout('Enkel een concept kan verwijderd worden. Annuleer een bestelde aankoop.');
  const bestanden = db.prepare(`SELECT pad FROM bijlagen WHERE entiteit = 'aankoop' AND entiteit_id = ?`).all(id);
  db.transaction(() => {
    db.prepare('DELETE FROM aankopen WHERE id = ?').run(id);
    db.prepare(`DELETE FROM bijlagen WHERE entiteit = 'aankoop' AND entiteit_id = ?`).run(id);
    wisHistoriek(db, 'aankoop', id);
  })();
  for (const b of bestanden) { try { fs.unlinkSync(path.join(bijlagenMap(), b.pad)); } catch { /* al weg */ } }
  res.json({ ok: true });
}));

// Prijsvoorstel per artikel bij een leverancier (laatste prijs, anders de
// inkoopprijs van het artikel), voor het invullen van nieuwe regels.
r.get('/prijzen', metFouten((req, res) => {
  const lev = req.query.leverancier_id ? Number(req.query.leverancier_id) : null;
  const rijen = getDb().prepare(`SELECT a.id, a.inkoopprijs,
      (SELECT al.laatste_prijs FROM artikel_leveranciers al WHERE al.artikel_id = a.id AND al.leverancier_id = ? ORDER BY al.voorkeur DESC, al.id LIMIT 1) AS laatste_prijs,
      (SELECT al.productcode FROM artikel_leveranciers al WHERE al.artikel_id = a.id AND al.leverancier_id = ? ORDER BY al.voorkeur DESC, al.id LIMIT 1) AS productcode
    FROM artikelen a`).all(lev, lev);
  const db = getDb();
  res.json(Object.fromEntries(rijen.map(x => [x.id, { prijs: x.laatste_prijs ?? x.inkoopprijs ?? laatstePrijs(db, x.id), productcode: x.productcode }])));
}));

// POST { regels: [{ artikel_id, aantal }] } → één concept per voorkeursleverancier
r.post('/bestelling-maken', metFouten((req, res) => {
  const db = getDb();
  res.status(201).json(db.transaction(() => bestellingenMaken(db, req.body?.regels))());
}));

export default r;
