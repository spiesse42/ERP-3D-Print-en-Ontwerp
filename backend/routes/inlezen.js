// ═══════════════════════════════════════════════════════════════════════
// /api/inkoop/inlezen — factuur of bonnetje inlezen met Gemini (stap 3c)
// ═══════════════════════════════════════════════════════════════════════
// POST /                 bestand (PDF/foto) → Gemini leest → voorstel (niets bewaard,
//                        stap 7: of een UBL-XML (Peppol / Accountable-export) → zonder Gemini
//                        behalve het bestand tijdelijk, voor het voorbeeld en de bijlage)
// GET  /:token/bestand   het tijdelijke bestand (voorbeeld naast het nakijkscherm)
// POST /:token/bevestig  nagekeken gegevens → aankoop + bijlage, in één keer
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb, bijlagenMap } from '../db/index.js';
import { DomeinFout, isFkFout } from '../domein/hulp.js';
import { logGebeurtenis } from '../domein/historiek.js';
import { koppel, bevestig, catalogusVoorInstructie } from '../domein/factuurherkenning.js';
import { leesFactuurMetGemini, maakInstructie, GEMINI_MODEL } from '../integraties/gemini.js';
import { isUbl, leesUbl } from '../integraties/ubl.js';

const r = Router();
const TYPES = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
const XML = f => /xml/i.test(f.mimetype) || /\.xml$/i.test(f.originalname || '');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 }, fileFilter: (req, f, cb) => cb(null, !!TYPES[f.mimetype] || XML(f)) });
const tmpMap = () => path.join(bijlagenMap(), 'tmp');
const geldigToken = t => /^[0-9a-f-]{36}$/.test(t || '');

function leesMeta(token) {
  if (!geldigToken(token)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(tmpMap(), `${token}.json`), 'utf8')); } catch { return null; }
}
// Tijdelijke bestanden ouder dan een dag opruimen (niet bevestigd).
function ruimOp() {
  try {
    const grens = Date.now() - 24 * 3600 * 1000;
    for (const f of fs.readdirSync(tmpMap())) {
      const p = path.join(tmpMap(), f);
      if (fs.statSync(p).mtimeMs < grens) fs.unlinkSync(p);
    }
  } catch { /* map bestaat nog niet */ }
}

r.post('/', (req, res) => {
  upload.single('bestand')(req, res, async (fout) => {
    if (fout) return res.status(400).json({ error: fout.code === 'LIMIT_FILE_SIZE' ? 'Bestand is groter dan 20 MB' : fout.message });
    if (!req.file) return res.status(400).json({ error: 'Kies een PDF, een foto (jpg, png, webp, heic) of een UBL-bestand (.xml)' });
    ruimOp();
    const db = getDb();
    const token = crypto.randomUUID();
    const bestandsnaam = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
    // UBL (stap 7): lezen zonder Gemini; de meegestuurde PDF wordt het voorbeeld en de bijlage
    if (XML(req.file)) {
      if (!isUbl(req.file.buffer)) return res.status(400).json({ error: 'Dit XML-bestand is geen UBL-factuur.' });
      let u;
      try { u = leesUbl(req.file.buffer, catalogusVoorInstructie(db)); } catch (e) { return res.status(400).json({ error: e.message }); }
      if (u.creditnota) return res.status(400).json({ error: 'Dit is een creditnota. Creditnota\'s worden niet ingelezen: pas de aankoop of de voorraad zelf aan.' });
      fs.mkdirSync(tmpMap(), { recursive: true });
      const meta = u.pdf
        ? { bestandsnaam: String(u.pdf.bestandsnaam).slice(0, 200), mimetype: 'application/pdf', ext: '.pdf', grootte: u.pdf.data.length, bron: 'ubl' }
        : { bestandsnaam, mimetype: 'application/xml', ext: '.xml', grootte: req.file.size, bron: 'ubl' };
      fs.writeFileSync(path.join(tmpMap(), `${token}${meta.ext}`), u.pdf ? u.pdf.data : req.file.buffer);
      fs.writeFileSync(path.join(tmpMap(), `${token}.json`), JSON.stringify(meta));
      try {
        return res.json({ token, bestandsnaam: meta.bestandsnaam, mimetype: meta.mimetype, model: null, bron: 'ubl', hoofdmodel: GEMINI_MODEL(), voorstel: koppel(db, u.gelezen) });
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }
    let gelezen;
    try {
      gelezen = await leesFactuurMetGemini({ buffer: req.file.buffer, mimetype: req.file.mimetype, bestandsnaam, instructie: maakInstructie(catalogusVoorInstructie(db)) });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
    fs.mkdirSync(tmpMap(), { recursive: true });
    const ext = TYPES[req.file.mimetype];
    fs.writeFileSync(path.join(tmpMap(), `${token}${ext}`), req.file.buffer);
    fs.writeFileSync(path.join(tmpMap(), `${token}.json`), JSON.stringify({ bestandsnaam, mimetype: req.file.mimetype, ext, grootte: req.file.size }));
    try {
      res.json({ token, bestandsnaam, mimetype: req.file.mimetype, model: gelezen?._model ?? null, hoofdmodel: GEMINI_MODEL(), voorstel: koppel(db, gelezen) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

r.get('/:token/bestand', (req, res) => {
  const m = leesMeta(req.params.token);
  if (!m) return res.status(404).json({ error: 'Tijdelijk bestand niet (meer) gevonden. Lees de factuur opnieuw in.' });
  res.type(m.mimetype);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(m.bestandsnaam)}`);
  res.sendFile(path.join(tmpMap(), `${req.params.token}${m.ext}`));
});

r.post('/:token/bevestig', (req, res) => {
  const m = leesMeta(req.params.token);
  if (!m) return res.status(404).json({ error: 'Tijdelijk bestand niet (meer) gevonden. Lees de factuur opnieuw in.' });
  const db = getDb();
  const bron = path.join(tmpMap(), `${req.params.token}${m.ext}`);
  const doelNaam = `aankoop-${crypto.randomUUID()}${m.ext}`;
  try {
    const ak = db.transaction(() => {
      const a = bevestig(db, req.body, m.bron === 'ubl' ? 'ubl' : 'ocr');
      db.prepare('INSERT INTO bijlagen (entiteit, entiteit_id, bestandsnaam, pad, mimetype, grootte) VALUES (?,?,?,?,?,?)')
        .run('aankoop', a.id, m.bestandsnaam, doelNaam, m.mimetype, m.grootte);
      logGebeurtenis(db, 'aankoop', a.id, 'gewijzigd', `Ingelezen uit ${m.bestandsnaam}${m.bron === 'ubl' ? ' (UBL, zonder Gemini)' : ''}`);
      fs.copyFileSync(bron, path.join(bijlagenMap(), doelNaam));   // binnen de transactie: mislukt de kopie, dan wordt niets bewaard
      return a;
    })();
    for (const f of [bron, path.join(tmpMap(), `${req.params.token}.json`)]) { try { fs.unlinkSync(f); } catch { /* al weg */ } }
    res.status(201).json(ak);
  } catch (e) {
    try { fs.unlinkSync(path.join(bijlagenMap(), doelNaam)); } catch { /* niet gekopieerd */ }
    if (e instanceof DomeinFout) return res.status(400).json({ error: e.message });
    if (isFkFout(e)) return res.status(400).json({ error: 'Onbekend artikel, merk, type, kleur of categorie' });
    res.status(500).json({ error: e.message });
  }
});

export default r;
