import { Router } from 'express';
import multer from 'multer';
import { randomBytes } from 'crypto';
import { mkdirSync, unlinkSync, createReadStream, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db.js';

const r = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Persistente map naast de databank (zelfde principe als DB_PATH in db.js —
// overleeft dus, net als erp.db zelf, een addon-herbouw zolang de map
// buiten de image blijft staan / gemount is).
const FACTUREN_MAP = process.env.FACTUREN_MAP || path.join(__dirname, '..', 'facturen_bestanden');
mkdirSync(FACTUREN_MAP, { recursive: true });

// Gemini API-key: NIET via de instellingen-tabel (zie het beveiligingsprincipe
// bovenaan routes/instellingen.js — geheimen horen in de addon-configuratie,
// niet in de SQLite-databank) maar via een environment variable, exact
// hetzelfde patroon als het oude pakket voor de HA-token. Instelbaar model
// via GEMINI_MODEL, met een redelijke default — makkelijk te wijzigen zonder
// codewijziging als er ooit een nieuwer/beter model verschijnt.
//
// 2026-09-23: 'gemini-2.0-flash' bleek intussen door Google uitgefaseerd
// (404 "This model ... is no longer available", live bevestigd op dell-test)
// — vervangen door 'gemini-3.6-flash', exact het model dat Gemini's eigen
// foutmelding als vervanger aanraadde.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function geminiApiKey() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return key || null;
}

// ── Multer: PDF + foto's (bonnetjes), in het geheugen (niet meteen naar
// schijf — pas bij POST /opslaan, na bevestiging door de gebruiker). ────────
const TOEGESTANE_MIMETYPES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB, ruim genoeg voor een foto/PDF
  fileFilter: (req, file, cb) => {
    if (TOEGESTANE_MIMETYPES[file.mimetype]) return cb(null, true);
    cb(new Error('Alleen PDF-bestanden of foto\'s (jpg/png/webp/heic) worden ondersteund.'));
  },
});

function multerErrorHandler(err, req, res, next) {
  if (err) return res.status(400).json({ error: err.message || 'Bestand kon niet verwerkt worden' });
  next();
}

// ── Analyseren (Gemini) — niets wordt hier bewaard, enkel de herkende
// gegevens teruggeven zodat de gebruiker ze kan nakijken/corrigeren. ────────
const GEMINI_PROMPT = `Je analyseert een aankoopfactuur of kassabonnetje voor een 3D-printbedrijf (aankoop van filament en/of losse onderdelen zoals schroeven, magneten, ringen).

Herken:
- leverancier (bedrijfsnaam van de verkoper)
- factuurnummer (factuur- of ticketnummer, indien aanwezig)
- datum (formaat JJJJ-MM-DD indien mogelijk)
- totaal_bedrag (het totale, te betalen bedrag in euro, incl. BTW)
- regels: elke afzonderlijke aankoopregel op het document, geclassificeerd als:
  - "filament": een rol 3D-printfilament — geef ook merk, materiaal (bv. PLA, PETG, ABS) en kleur indien herkenbaar
  - "onderdeel": een ander fysiek onderdeel of stuk (bv. schroeven, ringen, magneten, elektronica) — geef ook een korte naam
  Voor elke regel ook: aantal (stuks of rollen) en prijs_per_stuk (prijs per eenheid in euro, zoals op het document staat).

Laat een veld leeg/weg als het niet duidelijk herkenbaar is — gok niet.`;

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    leverancier: { type: 'STRING' },
    factuurnummer: { type: 'STRING' },
    datum: { type: 'STRING' },
    totaal_bedrag: { type: 'NUMBER' },
    regels: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          categorie: { type: 'STRING', enum: ['filament', 'onderdeel'] },
          naam: { type: 'STRING' },
          merk: { type: 'STRING' },
          materiaal: { type: 'STRING' },
          kleur: { type: 'STRING' },
          aantal: { type: 'NUMBER' },
          prijs_per_stuk: { type: 'NUMBER' },
        },
        required: ['categorie', 'aantal'],
      },
    },
  },
  required: ['regels'],
};

r.post('/analyseer', upload.single('bestand'), multerErrorHandler, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  const apiKey = geminiApiKey();
  if (!apiKey) {
    return res.status(400).json({ error: 'Gemini API-key is niet ingesteld — stel GEMINI_API_KEY in via de add-on configuratie.' });
  }

  try {
    const body = {
      contents: [{
        parts: [
          { text: GEMINI_PROMPT },
          { inline_data: { mime_type: req.file.mimetype, data: req.file.buffer.toString('base64') } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    if (!geminiRes.ok) {
      const foutTekst = await geminiRes.text().catch(() => '');
      return res.status(502).json({ error: `Gemini gaf een fout terug (${geminiRes.status}): ${foutTekst.slice(0, 300)}` });
    }

    const data = await geminiRes.json();
    const tekst = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!tekst) return res.status(502).json({ error: 'Gemini gaf geen bruikbaar antwoord terug' });

    let geparsed;
    try {
      geparsed = JSON.parse(tekst);
    } catch {
      return res.status(502).json({ error: 'Gemini-antwoord kon niet als JSON gelezen worden' });
    }

    res.json({
      leverancier: geparsed.leverancier || null,
      factuurnummer: geparsed.factuurnummer || null,
      datum: geparsed.datum || null,
      totaal_bedrag: Number.isFinite(geparsed.totaal_bedrag) ? geparsed.totaal_bedrag : null,
      regels: Array.isArray(geparsed.regels) ? geparsed.regels : [],
    });
  } catch (e) {
    res.status(500).json({ error: `Analyseren mislukt: ${e.message}` });
  }
});

// ── Opslaan — bestand blijvend wegschrijven + factuur-rij aanmaken. ─────────
function valideerOpslaanBody(body) {
  if (!['factuur', 'bonnetje'].includes(body.type)) return 'Type moet \'factuur\' of \'bonnetje\' zijn';
  let totaalBedrag = null;
  if (body.totaal_bedrag !== undefined && body.totaal_bedrag !== null && body.totaal_bedrag !== '') {
    totaalBedrag = parseFloat(body.totaal_bedrag);
    if (!Number.isFinite(totaalBedrag) || totaalBedrag < 0) return 'Totaalbedrag moet een geldig, niet-negatief getal zijn (of leeg)';
  }
  return { totaalBedrag };
}

r.post('/opslaan', upload.single('bestand'), multerErrorHandler, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
  const v = valideerOpslaanBody(req.body);
  if (typeof v === 'string') return res.status(400).json({ error: v });

  const ext = TOEGESTANE_MIMETYPES[req.file.mimetype] || '';
  const bestandspad = `${Date.now()}_${randomBytes(4).toString('hex')}${ext}`;
  const volledigPad = path.join(FACTUREN_MAP, bestandspad);

  try {
    writeFileSync(volledigPad, req.file.buffer);
  } catch (e) {
    return res.status(500).json({ error: `Bestand kon niet weggeschreven worden: ${e.message}` });
  }

  const { leverancier, factuurnummer, datum, type } = req.body;
  try {
    const result = getDb().prepare(`
      INSERT INTO facturen (leverancier,factuurnummer,datum,type,bestandsnaam,bestandspad,mimetype,totaal_bedrag)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(leverancier || null, factuurnummer || null, datum || null, type, req.file.originalname, bestandspad, req.file.mimetype, v.totaalBedrag);
    res.status(201).json({ factuur_id: result.lastInsertRowid });
  } catch (e) {
    try { unlinkSync(volledigPad); } catch {}
    res.status(500).json({ error: e.message });
  }
});

// ── Lijst — met per factuur een telling van gekoppelde voorraad. ───────────
r.get('/', (req, res) => {
  const rows = getDb().prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM filament_rollen WHERE factuur_id = f.id) AS aantal_rollen,
      (SELECT COUNT(*) FROM artikel_voorraad WHERE factuur_id = f.id) AS aantal_voorraad
    FROM facturen f
    ORDER BY f.aangemaakt_op DESC
  `).all();
  res.json(rows);
});

// ── Bestand terug opvragen/downloaden. ──────────────────────────────────────
r.get('/:id/bestand', (req, res) => {
  const rij = getDb().prepare('SELECT * FROM facturen WHERE id = ?').get(req.params.id);
  if (!rij) return res.status(404).json({ error: 'Niet gevonden' });
  const volledigPad = path.join(FACTUREN_MAP, rij.bestandspad);
  if (!existsSync(volledigPad)) return res.status(404).json({ error: 'Bestand niet (meer) aanwezig op schijf' });
  res.setHeader('Content-Type', rij.mimetype);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rij.bestandsnaam)}"`);
  createReadStream(volledigPad).pipe(res);
});

// ── Verwijderen — enkel het bewijsstuk + koppeling, de voorraad/rollen
// zelf blijven bestaan (factuur_id valt terug op NULL via ON DELETE SET NULL).
r.delete('/:id', (req, res) => {
  const db = getDb();
  const rij = db.prepare('SELECT * FROM facturen WHERE id = ?').get(req.params.id);
  if (!rij) return res.status(404).json({ error: 'Niet gevonden' });
  try {
    db.prepare('DELETE FROM facturen WHERE id = ?').run(req.params.id);
    const volledigPad = path.join(FACTUREN_MAP, rij.bestandspad);
    if (existsSync(volledigPad)) unlinkSync(volledigPad);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default r;
