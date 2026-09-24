// /api/bijlagen — bestanden bij een record (factuur-PDF, foto van een
// bonnetje, …). Opgeslagen in de map naast de databank (db/index.js →
// bijlagenMap), met een eigen naam; de oorspronkelijke naam staat in de databank.
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb, bijlagenMap } from '../db/index.js';
import { ENTITEITEN, bestaatRecord, logGebeurtenis } from '../domein/historiek.js';

const r = Router();
const TOEGELATEN = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, TOEGELATEN.includes(file.mimetype)),
});

function controleer(req, res) {
  const { entiteit } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!ENTITEITEN[entiteit]) { res.status(404).json({ error: 'Onbekend soort record' }); return null; }
  if (!Number.isInteger(id) || !bestaatRecord(getDb(), entiteit, id)) { res.status(404).json({ error: 'Record niet gevonden' }); return null; }
  return { entiteit, id };
}

r.get('/bestand/:bijlageId', (req, res) => {
  const b = getDb().prepare('SELECT * FROM bijlagen WHERE id = ?').get(req.params.bijlageId);
  if (!b) return res.status(404).json({ error: 'Bijlage niet gevonden' });
  const pad = path.join(bijlagenMap(), b.pad);
  if (!fs.existsSync(pad)) return res.status(404).json({ error: 'Bestand ontbreekt op schijf' });
  res.type(b.mimetype || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(b.bestandsnaam)}`);
  res.sendFile(pad);
});

r.delete('/bestand/:bijlageId', (req, res) => {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bijlagen WHERE id = ?').get(req.params.bijlageId);
  if (!b) return res.status(404).json({ error: 'Bijlage niet gevonden' });
  db.transaction(() => {
    db.prepare('DELETE FROM bijlagen WHERE id = ?').run(b.id);
    if (ENTITEITEN[b.entiteit]) logGebeurtenis(db, b.entiteit, b.entiteit_id, 'gewijzigd', `Bijlage verwijderd: ${b.bestandsnaam}`);
  })();
  try { fs.unlinkSync(path.join(bijlagenMap(), b.pad)); } catch { /* al weg */ }
  res.json({ ok: true });
});

r.get('/:entiteit/:id', (req, res) => {
  const c = controleer(req, res); if (!c) return;
  res.json(getDb().prepare('SELECT id, bestandsnaam, mimetype, grootte, aangemaakt_op FROM bijlagen WHERE entiteit = ? AND entiteit_id = ? ORDER BY id').all(c.entiteit, c.id));
});

r.post('/:entiteit/:id', (req, res) => {
  upload.single('bestand')(req, res, (fout) => {
    if (fout) return res.status(400).json({ error: fout.code === 'LIMIT_FILE_SIZE' ? 'Bestand is groter dan 20 MB' : fout.message });
    const c = controleer(req, res); if (!c) return;
    if (!req.file) return res.status(400).json({ error: 'Kies een PDF of een foto (jpg, png, webp, heic)' });
    const map = bijlagenMap();
    fs.mkdirSync(map, { recursive: true });
    const ext = (path.extname(req.file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
    const naam = `${c.entiteit}-${c.id}-${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(map, naam), req.file.buffer);
    const db = getDb();
    const oorspronkelijk = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
    const id = db.transaction(() => {
      const n = db.prepare('INSERT INTO bijlagen (entiteit, entiteit_id, bestandsnaam, pad, mimetype, grootte) VALUES (?,?,?,?,?,?)')
        .run(c.entiteit, c.id, oorspronkelijk, naam, req.file.mimetype, req.file.size).lastInsertRowid;
      logGebeurtenis(db, c.entiteit, c.id, 'gewijzigd', `Bijlage toegevoegd: ${oorspronkelijk}`);
      return n;
    })();
    res.status(201).json({ id, bestandsnaam: oorspronkelijk });
  });
});

export default r;
