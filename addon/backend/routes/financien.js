// ═══════════════════════════════════════════════════════════════════════
// /api/financien — overzicht, opvolging, marges, statistieken (stap 7)
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb, bijlagenMap } from '../db/index.js';
import { VELDEN, leesBestand, stelKolommenVoor, interpreteer, vergelijk, pasToe } from '../domein/accountable.js';
import { DomeinFout } from '../domein/hulp.js';
import { jaarOverzicht, opvolging, marges } from '../domein/financien.js';
import { statistieken } from '../domein/statistieken.js';
import { leesDossiers } from '../domein/dossiers.js';

const r = Router();
function metFouten(fn) {
  return (req, res) => {
    try { fn(req, res); } catch (e) {
      if (e instanceof DomeinFout) return res.status(e.status || 400).json({ error: e.message });
      console.error('[financien]', e);
      res.status(500).json({ error: e.message });
    }
  };
}
const jaarVan = req => {
  const j = req.query.jaar ? Number(req.query.jaar) : new Date().getFullYear();
  if (!Number.isInteger(j) || j < 2000 || j > 2100) throw new DomeinFout('Ongeldig jaar');
  return j;
};

r.get('/overzicht', metFouten((req, res) => res.json(jaarOverzicht(getDb(), jaarVan(req)))));
r.get('/opvolging', metFouten((req, res) => { const db = getDb(); res.json(opvolging(db, () => leesDossiers(db, { archief: 'alle' }))); }));
r.get('/marges', metFouten((req, res) => res.json(marges(getDb(), jaarVan(req)))));
r.get('/statistieken', metFouten((req, res) => res.json(statistieken(getDb(), jaarVan(req)))));

// CSV (puntkomma, komma als decimaalteken → opent meteen goed in Excel NL/BE)
const csvWaarde = v => (v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`);
function stuurCsv(res, naam, koppen, rijen) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${naam}"`);
  res.send('﻿' + [koppen.map(([, l]) => csvWaarde(l)).join(';'), ...rijen.map(x => koppen.map(([k]) => csvWaarde(x[k])).join(';'))].join('\r\n'));
}
r.get('/csv/overzicht', metFouten((req, res) => {
  const o = jaarOverzicht(getDb(), jaarVan(req));
  stuurCsv(res, `financien-${o.jaar}.csv`, [['maand', 'Maand'], ['omzet', 'Omzet (afgerekend)'], ['facturen', 'Facturen'], ['bonnetjes', 'Bonnetjes'],
    ['ontvangen', 'Ontvangen'], ['aankopen', 'Aankopen'], ['saldo', 'Saldo']], o.maanden);
}));
r.get('/csv/marges', metFouten((req, res) => {
  const m = marges(getDb(), jaarVan(req));
  stuurCsv(res, `marges-${m.jaar}.csv`, [['nummer', 'Dossier'], ['titel', 'Titel'], ['klant', 'Klant'], ['afgerekend_op', 'Afgerekend'],
    ['afgerekend_soort', 'Soort'], ['afgerekend_bedrag', 'Bedrag'], ['kost', 'Kost'], ['arbeid', 'Arbeid'], ['marge', 'Marge'],
    ['marge_met_arbeid', 'Marge na arbeid'], ['marge_pct', 'Marge %']], m.rijen);
}));

// ── Accountable-export inlezen (betaald-status) ─────────────────────────
// POST /accountable                 bestand (.xlsx of .csv) → bladen, kolommen, voorstel
// POST /accountable/:token/vergelijk { blad, kolommen } → wat er zou veranderen
// POST /accountable/:token/toepassen { blad, kolommen, dossier_ids } → betaald zetten
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const tmp = () => path.join(bijlagenMap(), 'tmp');
const geldig = t => /^[0-9a-f-]{36}$/.test(t || '');
function metAsync(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof DomeinFout) return res.status(e.status || 400).json({ error: e.message });
      console.error('[financien]', e);
      res.status(500).json({ error: e.message });
    }
  };
}
async function bladenVan(token) {
  if (!geldig(token)) throw Object.assign(new DomeinFout('Onbekend bestand'), { status: 404 });
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(tmp(), `${token}.acc.json`), 'utf8')); }
  catch { throw Object.assign(new DomeinFout('Het bestand is niet (meer) beschikbaar. Lees het opnieuw in.'), { status: 404 }); }
  return { meta, bladen: await leesBestand(fs.readFileSync(path.join(tmp(), `${token}.acc`)), meta.bestandsnaam) };
}
function blad(bladen, i) {
  const b = bladen[Number(i) || 0];
  if (!b) throw new DomeinFout('Onbekend werkblad');
  return b;
}
const kolommenVan = k => Object.fromEntries(Object.entries(k || {}).filter(([v, i]) => VELDEN[v] && i !== '' && i != null && Number.isInteger(Number(i))).map(([v, i]) => [v, Number(i)]));

r.post('/accountable', (req, res) => upload.single('bestand')(req, res, async fout => {
  try {
    if (fout) throw new DomeinFout(fout.code === 'LIMIT_FILE_SIZE' ? 'Bestand is groter dan 20 MB' : fout.message);
    if (!req.file) throw new DomeinFout('Kies de Excel-export (.xlsx) of een CSV-bestand');
    const bestandsnaam = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200);
    if (!/\.(xlsx|csv)$/i.test(bestandsnaam)) throw new DomeinFout('Enkel .xlsx (Excel) of .csv');
    const bladen = await leesBestand(req.file.buffer, bestandsnaam);
    if (!bladen.length) throw new DomeinFout('Geen tabel met kopteksten gevonden in dit bestand');
    const token = crypto.randomUUID();
    fs.mkdirSync(tmp(), { recursive: true });
    fs.writeFileSync(path.join(tmp(), `${token}.acc`), req.file.buffer);
    fs.writeFileSync(path.join(tmp(), `${token}.acc.json`), JSON.stringify({ bestandsnaam }));
    res.json({ token, bestandsnaam, velden: VELDEN,
      bladen: bladen.map((b, i) => ({ index: i, naam: b.naam, koppen: b.koppen, aantal: b.rijen.length, voorbeeld: b.rijen.slice(0, 8), voorstel: stelKolommenVoor(b.koppen) })) });
  } catch (e) {
    if (e instanceof DomeinFout) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
}));
r.post('/accountable/:token/vergelijk', metAsync(async (req, res) => {
  const { bladen } = await bladenVan(req.params.token);
  res.json(vergelijk(getDb(), interpreteer(blad(bladen, req.body?.blad), kolommenVan(req.body?.kolommen))));
}));
r.post('/accountable/:token/toepassen', metAsync(async (req, res) => {
  const { meta, bladen } = await bladenVan(req.params.token);
  const db = getDb();
  const v = vergelijk(db, interpreteer(blad(bladen, req.body?.blad), kolommenVan(req.body?.kolommen)));
  const ids = Array.isArray(req.body?.dossier_ids) ? req.body.dossier_ids : [];
  const n = db.transaction(() => pasToe(db, v, ids, meta.bestandsnaam))();
  for (const f of [`${req.params.token}.acc`, `${req.params.token}.acc.json`]) { try { fs.unlinkSync(path.join(tmp(), f)); } catch { /* al weg */ } }
  res.json({ betaald: n });
}));

export default r;
