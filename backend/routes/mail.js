// ═══════════════════════════════════════════════════════════════════════
// /api/mail — tegel "Mail" (30-09): de mailbox (IMAP) + versturen (SMTP)
// ═══════════════════════════════════════════════════════════════════════
// Mails blijven op de mailserver; enkel wat je bewust bij een dossier, klant,
// aankoop of leverancier bewaart (bijlage of de mail zelf als .eml) komt in
// het ERP.
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb, bijlagenMap } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { ENTITEITEN, bestaatRecord, logGebeurtenis } from '../domein/historiek.js';
import { ImapFout, imapIngesteld, imapInstellingen, eigenAdres, mappen, mapMaken, mapHernoemen, mapVerwijderen, berichten, ontleed, bronVan,
  vlaggen, verplaats, verwijder, vanOfAan, aantalOngelezen } from '../mail/imap.js';
import { mailWeergave, koppelingen, citaat } from '../mail/weergave.js';
import { verstuurVrij, bewaarConcept, MailFout, mailIngesteld } from '../documenten/mail.js';

const r = Router();
const MAX_BIJLAGEN = 25 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BIJLAGEN, files: 20 } });

function metFouten(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof DomeinFout || e instanceof MailFout) return res.status(e.status || 400).json({ error: e.message });
      if (e instanceof ImapFout) return res.status(502).json({ error: e.message });
      console.error('[mail]', e);
      res.status(500).json({ error: e.message });
    }
  };
}
const bestandsnaam = n => String(n || 'bijlage').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 180);

r.get('/status', metFouten(async (req, res) => {
  const c = imapInstellingen();
  const uit = { ingesteld: imapIngesteld(), versturen: mailIngesteld(), adres: eigenAdres() || null, server: c.host || null };
  if (uit.ingesteld && req.query.ongelezen) {
    try { uit.ongelezen = await aantalOngelezen(); } catch (e) { uit.fout = e.message; }
  }
  res.json(uit);
}));

// ── mappen ──────────────────────────────────────────────────────────────
r.get('/mappen', metFouten(async (req, res) => res.json(await mappen())));
r.post('/mappen', metFouten(async (req, res) => { await mapMaken(req.body?.pad); res.status(201).json(await mappen()); }));
r.put('/mappen', metFouten(async (req, res) => { await mapHernoemen(req.body?.van, req.body?.naar); res.json(await mappen()); }));
r.delete('/mappen', metFouten(async (req, res) => { await mapVerwijderen(req.query.pad); res.json(await mappen()); }));

// ── berichten ───────────────────────────────────────────────────────────
r.get('/berichten', metFouten(async (req, res) => {
  const pagina = Math.max(0, parseInt(req.query.pagina, 10) || 0);
  res.json(await berichten(req.query.map || 'INBOX', { pagina, zoek: req.query.zoek || '', ongelezen: req.query.ongelezen === '1' }));
}));
// Eén bericht: veilige weergave + wat het ERP erover weet + aanhaling (antwoorden)
r.get('/bericht', metFouten(async (req, res) => {
  const { mail, flags } = await ontleed(req.query.map, req.query.uid, { markeer: req.query.markeer !== '0' });
  const w = mailWeergave(mail, { map: req.query.map, uid: Number(req.query.uid), flags: new Set([...flags, '\\Seen']), afbeeldingen: req.query.afbeeldingen === '1' });
  res.json({ ...w, erp: koppelingen(getDb(), w, eigenAdres()), citaat: citaat(w) });
}));
r.get('/bijlage', metFouten(async (req, res) => {
  const { mail } = await ontleed(req.query.map, req.query.uid);
  const a = (mail.attachments || [])[Number(req.query.index)];
  if (!a) throw Object.assign(new DomeinFout('Bijlage niet gevonden'), { status: 404 });
  const naam = bestandsnaam(a.filename || `bijlage-${Number(req.query.index) + 1}`);
  // PDF en afbeeldingen mogen in de browser open; al de rest wordt gedownload
  const inline = req.query.download !== '1' && /^(application\/pdf|image\/(png|jpe?g|gif|webp))$/i.test(a.contentType || '');
  res.set({ 'Content-Type': inline ? a.contentType : 'application/octet-stream', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(naam)}`,
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox" });
  res.send(a.content);
}));
// De volledige mail als .eml (bv. om te bewaren of door te geven)
r.get('/bron', metFouten(async (req, res) => {
  const { source } = await bronVan(req.query.map, req.query.uid);
  res.set({ 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="mail-${Number(req.query.uid)}.eml"` });
  res.send(source);
}));
r.post('/vlaggen', metFouten(async (req, res) => {
  const b = req.body || {};
  await vlaggen(b.map, b.uids, { gelezen: b.gelezen, ster: b.ster });
  res.json({ ok: true });
}));
r.post('/verplaats', metFouten(async (req, res) => { await verplaats(req.body?.map, req.body?.uids, req.body?.doel); res.json({ ok: true }); }));
r.post('/verwijder', metFouten(async (req, res) => res.json(await verwijder(req.body?.map, req.body?.uids))));

// ── versturen / concept ─────────────────────────────────────────────────
// multipart: aan, cc, bcc, onderwerp, tekst, [antwoord_map, antwoord_uid,
// soort = antwoord | doorsturen], doorsturen_bijlagen (JSON-lijst van
// indexen uit het oorspronkelijke bericht), bestanden (nieuwe bijlagen).
function metUpload(fn) {
  return (req, res) => upload.array('bestanden', 20)(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Een bijlage is groter dan 25 MB' : err.message });
    return metFouten(fn)(req, res);
  });
}
async function bijlagenVanVerzoek(req) {
  const b = req.body || {};
  const eigen = (req.files || []).map(f => ({ naam: bestandsnaam(Buffer.from(f.originalname, 'latin1').toString('utf8')), type: f.mimetype, inhoud: f.buffer }));
  let origineel = null;
  if (b.antwoord_map && b.antwoord_uid) origineel = await ontleed(b.antwoord_map, b.antwoord_uid);
  let indexen = [];
  try { indexen = JSON.parse(b.doorsturen_bijlagen || '[]'); } catch { /* geen */ }
  const door = origineel && Array.isArray(indexen)
    ? indexen.map(i => origineel.mail.attachments?.[Number(i)]).filter(Boolean).map(a => ({ naam: bestandsnaam(a.filename || 'bijlage'), type: a.contentType, inhoud: a.content }))
    : [];
  const alle = [...door, ...eigen];
  if (alle.reduce((n, x) => n + (x.inhoud?.length || 0), 0) > MAX_BIJLAGEN) throw new DomeinFout('De bijlagen zijn samen groter dan 25 MB.');
  return { bijlagen: alle, origineel };
}
r.post('/versturen', metUpload(async (req, res) => {
  const b = req.body || {};
  const { bijlagen, origineel } = await bijlagenVanVerzoek(req);
  const antwoord = b.soort === 'antwoord' && origineel;
  await verstuurVrij({ aan: b.aan, cc: b.cc, bcc: b.bcc, onderwerp: b.onderwerp, tekst: b.tekst, bijlagen,
    antwoordOp: antwoord ? origineel.mail.messageId : null, references: antwoord ? [].concat(origineel.mail.references || []) : [] });
  if (antwoord) { try { await vlaggen(b.antwoord_map, [b.antwoord_uid], { beantwoord: true }); } catch { /* niet erg */ } }
  // bewust bij een klant/dossier: in de historiek
  const db = getDb();
  if (b.entiteit && ENTITEITEN[b.entiteit] && bestaatRecord(db, b.entiteit, Number(b.entiteit_id))) {
    logGebeurtenis(db, b.entiteit, Number(b.entiteit_id), 'notitie', `Mail verstuurd naar ${b.aan}: ${b.onderwerp || '(geen onderwerp)'}`);
  }
  res.json({ ok: true });
}));
r.post('/concept', metUpload(async (req, res) => {
  const b = req.body || {};
  const { bijlagen } = await bijlagenVanVerzoek(req);
  const pad = await bewaarConcept({ aan: b.aan, cc: b.cc, bcc: b.bcc, onderwerp: b.onderwerp, tekst: b.tekst, bijlagen });
  res.json({ ok: true, map: pad });
}));

// ── koppelingen met het ERP ─────────────────────────────────────────────
// Bijlagen (en/of de mail zelf als .eml) bewaren bij een dossier, klant,
// aankoop of leverancier.
r.post('/bewaar', metFouten(async (req, res) => {
  const b = req.body || {};
  const entiteit = String(b.entiteit || '');
  const id = Number(b.entiteit_id);
  if (!['dossier', 'klant', 'aankoop', 'leverancier'].includes(entiteit)) throw new DomeinFout('Kies een dossier, klant, aankoop of leverancier');
  const db = getDb();
  if (!Number.isInteger(id) || !bestaatRecord(db, entiteit, id)) throw new DomeinFout('Dat record bestaat niet (meer).');
  const { mail, source } = await ontleed(b.map, b.uid);
  const te = (Array.isArray(b.indexen) ? b.indexen : []).map(i => ({ i: Number(i), a: mail.attachments?.[Number(i)] })).filter(x => x.a);
  const stukken = te.map(({ a }) => ({ naam: bestandsnaam(a.filename || 'bijlage'), type: a.contentType || 'application/octet-stream', inhoud: a.content }));
  if (b.mail) stukken.push({ naam: bestandsnaam(`${mail.subject || 'mail'}.eml`), type: 'message/rfc822', inhoud: source });
  if (!stukken.length) throw new DomeinFout('Kies wat je wilt bewaren (een bijlage of de mail zelf).');
  const map = bijlagenMap();
  fs.mkdirSync(map, { recursive: true });
  const geschreven = [];
  try {
    db.transaction(() => {
      for (const s of stukken) {
        const ext = (path.extname(s.naam) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
        const pad = `${entiteit}-${id}-${crypto.randomUUID()}${ext}`;
        fs.writeFileSync(path.join(map, pad), s.inhoud);
        geschreven.push(pad);
        db.prepare('INSERT INTO bijlagen (entiteit, entiteit_id, bestandsnaam, pad, mimetype, grootte) VALUES (?,?,?,?,?,?)').run(entiteit, id, s.naam, pad, s.type, s.inhoud.length);
      }
      const van = mail.from?.value?.[0]?.address || 'onbekend';
      logGebeurtenis(db, entiteit, id, 'gewijzigd', `Uit de mail van ${van} ("${mail.subject || 'geen onderwerp'}") bewaard: ${stukken.map(s => s.naam).join(', ')}`);
    })();
  } catch (e) {
    for (const p of geschreven) { try { fs.unlinkSync(path.join(map, p)); } catch { /* weg */ } }
    throw e;
  }
  res.status(201).json({ bewaard: stukken.map(s => s.naam) });
}));
// Mails van of aan een klant/leverancier (tabblad op de fiche)
r.get('/adres', metFouten(async (req, res) => res.json(await vanOfAan(req.query.adres))));

export default r;
