// ═══════════════════════════════════════════════════════════════════════
// /api/verkopen — tegel "Verkoop" (26-09): losse verkoop met bonnetje en
// het overzicht van alle bonnetjes (ook die van dossiers).
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout, isFkFout } from '../domein/hulp.js';
import { logGebeurtenis } from '../domein/historiek.js';
import { leesVerkoop, leesDatum, voorstelNummer, maakVerkoop, leesVerkoopRij, verkoopInhoud, overzicht, annuleerVerkoop, kandidaten } from '../domein/verkopen.js';
import { htmlNaarPdf, vindBrowser } from '../documenten/pdf.js';
import { MailFout, mailIngesteld, geldigAdres } from '../documenten/mail.js';
import { accountableAdres, afzender, DREMPEL_BONNETJE, bonnetjeHtml, bonnetjeBestand, stuurBonnetje } from '../documenten/bonnetje.js';

const r = Router();
function metFouten(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof DomeinFout || e instanceof MailFout) return res.status(e.status || 400).json({ error: e.message });
      if (isFkFout(e)) return res.status(400).json({ error: 'Onbekende klant of artikel' });
      console.error('[verkopen]', e);
      res.status(500).json({ error: e.message });
    }
  };
}
function verkoop(db, id) {
  const v = leesVerkoopRij(db, id);
  if (!v) throw Object.assign(new DomeinFout('Verkoop niet gevonden'), { status: 404 });
  return v;
}
async function stuurPdf(res, html, naam) {
  const pdf = await htmlNaarPdf(html);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${naam}"` });
  res.send(pdf);
}
async function mail(db, v, body) {
  const uit = await stuurBonnetje({ nummer: v.nummer, titel: v.omschrijving, bedrag: v.totaal, context: 'losse verkoop',
    html: bonnetjeHtml({ inhoud: verkoopInhoud(db, v), nummer: v.nummer, datum: v.datum }), ...body, al_bij_accountable: !!v.gemaild_op });
  db.transaction(() => {
    if (uit.accountable) db.prepare('UPDATE verkopen SET gemaild_op = ? WHERE id = ?').run(new Date().toISOString(), v.id);
    if (uit.klantAdres) db.prepare('UPDATE verkopen SET klant_mail = ? WHERE id = ?').run(uit.klantAdres, v.id);
    logGebeurtenis(db, 'verkoop', v.id, 'status', uit.tekst);
  })();
}
const mailBody = b => ({ naar_klant: !!b?.naar_klant, aan: b?.aan, onderwerp: b?.onderwerp, tekst: b?.tekst });

// Alle bonnetjes (losse verkopen + dossiers) en facturen van dossiers.
r.get('/', metFouten((req, res) => res.json(overzicht(getDb()))));

// Venster "Nieuwe verkoop": wat het nummer wordt + of mailen kan.
r.get('/voorstel', metFouten((req, res) => {
  const datum = leesDatum(req.query.datum);
  res.json({ nummer: voorstelNummer(getDb(), datum), datum, accountable: accountableAdres(), afzender: afzender(),
    mail_ingesteld: mailIngesteld(), pdf_mogelijk: !!vindBrowser(), drempel: DREMPEL_BONNETJE });
}));
// Wat je kunt koppelen: af te rekenen klantdossiers en voltooide losse
// printopdrachten (met voorstelprijs van de rekenmotor).
r.get('/kandidaten', metFouten((req, res) => res.json(kandidaten(getDb()))));
// Voorbeeld-PDF van wat er in het venster staat (niets bewaard).
r.post('/voorbeeld', metFouten(async (req, res) => {
  const db = getDb();
  const v = leesVerkoop(db, req.body);
  const klant = v.klant_id ? db.prepare('SELECT * FROM klanten WHERE id = ?').get(v.klant_id) : null;
  const nummer = voorstelNummer(db, v.datum);
  const inhoud = verkoopInhoud(db, { ...v, klant_gegevens: klant });
  await stuurPdf(res, bonnetjeHtml({ inhoud, nummer, datum: v.datum, concept: true }), bonnetjeBestand(nummer, ' - voorbeeld'));
}));

// Verkopen = bonnetje maken + voorraad uitboeken + mailen. Alles wat het
// mailen kan tegenhouden wordt EERST gecontroleerd (geen nummer verbruikt).
r.post('/', metFouten(async (req, res) => {
  const db = getDb();
  const v = leesVerkoop(db, req.body);
  const b = mailBody(req.body);
  if (b.naar_klant && !geldigAdres(b.aan)) throw new DomeinFout('Vul een geldig e-mailadres van de klant in (of vink "ook naar de klant" uit).');
  if (!mailIngesteld()) throw new DomeinFout('Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie). Een bonnetje moet naar Accountable gemaild worden.');
  if (!vindBrowser()) throw new DomeinFout('Geen Chrome, Edge of Chromium gevonden om de PDF te maken.');
  const id = db.transaction(() => maakVerkoop(db, v))();
  let mail_fout = null;
  try { await mail(db, verkoop(db, id), { ...b, naar_accountable: true }); }
  catch (e) {
    mail_fout = e.message;
    console.error('[verkopen]', e);
    logGebeurtenis(db, 'verkoop', id, 'status', `Mailen mislukt: ${e.message}. Het bonnetje is NOG NIET naar Accountable gestuurd.`);
  }
  res.status(201).json({ ...verkoop(db, id), mail_fout });
}));

r.get('/:id', metFouten((req, res) => res.json(verkoop(getDb(), req.params.id))));
r.get('/:id/pdf', metFouten(async (req, res) => {
  const db = getDb();
  const v = verkoop(db, req.params.id);
  await stuurPdf(res, bonnetjeHtml({ inhoud: verkoopInhoud(db, v), nummer: v.nummer, datum: v.datum }), bonnetjeBestand(v.nummer));
}));
// Opnieuw mailen: naar de klant (altijd) en/of Accountable (enkel als dat nog niet gebeurde).
r.post('/:id/mail', metFouten(async (req, res) => {
  const db = getDb();
  const v = verkoop(db, req.params.id);
  if (v.geannuleerd_op) throw new DomeinFout('Deze verkoop is ongedaan gemaakt.');
  await mail(db, v, { ...mailBody(req.body), naar_accountable: !!req.body?.naar_accountable });
  res.json(verkoop(db, v.id));
}));
// Klant achteraf aanvullen (opvolging); de rest van een verkoop ligt vast.
r.put('/:id', metFouten((req, res) => {
  const db = getDb();
  const v = verkoop(db, req.params.id);
  let klant = null;
  if (req.body?.klant_id !== undefined && req.body?.klant_id !== null && req.body?.klant_id !== '') {
    klant = Number(req.body.klant_id);
    if (!Number.isInteger(klant) || !db.prepare('SELECT 1 FROM klanten WHERE id = ?').get(klant)) throw new DomeinFout('Onbekende klant');
  }
  if (klant !== v.klant_id && v.regels.some(x => x.soort === 'dossier')) throw new DomeinFout('De klant volgt het dossier op dit bonnetje en kan hier niet gewijzigd worden.');
  if (klant !== v.klant_id) db.transaction(() => {
    db.prepare('UPDATE verkopen SET klant_id = ? WHERE id = ?').run(klant, v.id);
    logGebeurtenis(db, 'verkoop', v.id, 'gewijzigd', `Klant ${klant ? 'gekoppeld' : 'weggehaald'}`);
  })();
  res.json(verkoop(db, v.id));
}));
r.post('/:id/annuleer', metFouten((req, res) => {
  const db = getDb();
  const v = verkoop(db, req.params.id);
  db.transaction(() => annuleerVerkoop(db, v))();
  res.json(verkoop(db, v.id));
}));

export default r;
