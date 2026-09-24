// ═══════════════════════════════════════════════════════════════════════
// Leveringen + pakbon (stap 5c) — gemount op /api
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout, getBedrijfsgegevens } from '../domein/hulp.js';
import { logGebeurtenis } from '../domein/historiek.js';
import { leesDossier } from '../domein/dossiers.js';
import { maakLevering, verwijderLevering } from '../domein/leveringen.js';
import { pakbonHtml } from '../documenten/sjabloon.js';
import { htmlNaarPdf } from '../documenten/pdf.js';
import { verstuurMail, MailFout } from '../documenten/mail.js';

const r = Router();
function metFouten(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof DomeinFout || e instanceof MailFout) return res.status(e.status || 400).json({ error: e.message });
      console.error('[leveringen]', e);
      res.status(500).json({ error: e.message });
    }
  };
}
const nietGevonden = wat => Object.assign(new DomeinFout(`${wat} niet gevonden`), { status: 404 });
function levering(db, id) {
  const l = db.prepare('SELECT * FROM leveringen WHERE id = ?').get(Number(id));
  if (!l) throw nietGevonden('Levering');
  return { l, d: leesDossier(db, l.dossier_id) };
}

r.get('/leveringen', metFouten((req, res) => {
  res.json(getDb().prepare(`SELECT l.id, l.nummer, l.datum, l.dossier_id, d.nummer AS dossier_nummer, d.titel,
      CASE WHEN k.type = 'zakelijk' AND NULLIF(k.bedrijfsnaam,'') IS NOT NULL THEN k.bedrijfsnaam
        ELSE TRIM(COALESCE(k.voornaam,'') || ' ' || COALESCE(k.naam,'')) END AS klant,
      (SELECT COUNT(*) FROM levering_regels lr WHERE lr.levering_id = l.id) AS aantal_regels,
      (SELECT SUM(lr.aantal) FROM levering_regels lr WHERE lr.levering_id = l.id) AS aantal_stuks
    FROM leveringen l JOIN dossiers d ON d.id = l.dossier_id LEFT JOIN klanten k ON k.id = d.klant_id
    ORDER BY l.datum DESC, l.id DESC`).all());
}));

r.post('/dossiers/:id/leveringen', metFouten((req, res) => {
  const db = getDb();
  const d = leesDossier(db, Number(req.params.id));
  if (!d) throw nietGevonden('Dossier');
  if (!d.acties.leveren) {
    throw new DomeinFout(d.soort !== 'klant' ? 'Enkel een klantopdracht wordt geleverd.'
      : d.fase === 'geannuleerd' ? 'Dit dossier is geannuleerd.'
      : d.lever_status === 'geleverd' ? 'Alles is al geleverd.' : 'Er is niets te leveren (voeg print- of artikelregels toe).');
  }
  db.transaction(() => maakLevering(db, d, req.body))();
  res.status(201).json(leesDossier(db, d.id));
}));

r.delete('/leveringen/:id', metFouten((req, res) => {
  const db = getDb();
  const { l, d } = levering(db, req.params.id);
  db.transaction(() => verwijderLevering(db, l))();
  res.json(leesDossier(db, d.id));
}));

// Pakbon: per regel van deze levering besteld / nu / eerder / nog te leveren.
function pakbon(db, l, d) {
  const eerder = new Map();
  for (const x of d.leveringen) {
    if (x.id >= l.id) continue;
    for (const lr of x.regels) eerder.set(lr.dossier_regel_id, (eerder.get(lr.dossier_regel_id) || 0) + lr.aantal);
  }
  const hier = d.leveringen.find(x => x.id === l.id).regels;
  const besteld = new Map(d.regels.map(x => [x.id, Number(x.aantal ?? 1)]));
  const regels = hier.map(lr => {
    const e = eerder.get(lr.dossier_regel_id) || 0;
    const b = besteld.get(lr.dossier_regel_id) ?? lr.aantal;
    return { omschrijving: lr.omschrijving, besteld: b, nu: lr.aantal, eerder: e, rest: Math.max(0, Math.round((b - e - lr.aantal) * 1000) / 1000) };
  });
  return pakbonHtml({ nummer: l.nummer, datum: l.datum, opmerking: l.opmerking, regels,
    inhoud: { bedrijf: getBedrijfsgegevens(db), klant: d.klant_gegevens, dossier: { nummer: d.nummer, titel: d.titel } } });
}
r.get('/leveringen/:id/pdf', metFouten(async (req, res) => {
  const db = getDb();
  const { l, d } = levering(db, req.params.id);
  const pdf = await htmlNaarPdf(pakbon(db, l, d));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Pakbon ${l.nummer}.pdf"` });
  res.send(pdf);
}));
r.post('/leveringen/:id/mail', metFouten(async (req, res) => {
  const db = getDb();
  const { l, d } = levering(db, req.params.id);
  const pdf = await htmlNaarPdf(pakbon(db, l, d));
  await verstuurMail({ aan: req.body?.aan, onderwerp: String(req.body?.onderwerp || '').trim() || `Pakbon ${l.nummer}`, tekst: req.body?.tekst || '',
    bijlage: { naam: `Pakbon ${l.nummer}.pdf`, inhoud: pdf } });
  logGebeurtenis(db, 'dossier', d.id, 'status', `Pakbon ${l.nummer} gemaild naar ${String(req.body.aan).trim()}`);
  res.json(leesDossier(db, d.id));
}));

export default r;
