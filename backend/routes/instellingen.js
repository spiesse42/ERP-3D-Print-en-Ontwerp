import { Router } from 'express';
import { GEMINI_MODEL, reserveModellen } from '../integraties/gemini.js';
import { getDb } from '../db/index.js';
import { mailIngesteld } from '../documenten/mail.js';
import { vindBrowser } from '../documenten/pdf.js';
import { haIngesteld } from '../integraties/homeassistant.js';

const r = Router();

// Alleen niet-gevoelige, door de applicatie gekende instellingen mogen via
// deze API gelezen/gewijzigd worden. Geheimen (HA-token, SMTP-wachtwoord, ...)
// horen in de beveiligde addon-configuratie, niet in de SQLite-databank —
// zelfde patroon als het oude pakket. Lijst groeit per fase (Fase 1 voegt
// bv. ha_url/backup-sleutels toe).
const INSTELLING_SLEUTELS = new Set([
  'bedrijf_naam', 'bedrijf_btw', 'bedrijf_adres', 'bedrijf_email', 'bedrijf_iban',
  'offerte_geldig_dagen',   // stap 5b: standaard geldigheid van een offerte
  'bedrijf_startdatum', 'drempel_omzet_jaar', 'drempel_winst_jaar',   // stap 7: drempels bijberoep
]);
// Eenvoudige controle per sleutel (stap 7); leeg mag altijd.
const CONTROLE = {
  bedrijf_startdatum: w => /^\d{4}-\d{2}-\d{2}$/.test(w) && !Number.isNaN(Date.parse(w)) ? null : 'Startdatum: gebruik de vorm JJJJ-MM-DD',
  drempel_omzet_jaar: w => (Number.isFinite(parseFloat(w.replace(',', '.'))) && parseFloat(w.replace(',', '.')) > 0 ? null : 'Drempel btw-vrijstelling moet een bedrag zijn'),
  drempel_winst_jaar: w => (Number.isFinite(parseFloat(w.replace(',', '.'))) && parseFloat(w.replace(',', '.')) > 0 ? null : 'Drempel sociale bijdragen moet een bedrag zijn'),
  offerte_geldig_dagen: w => (/^\d+$/.test(w) && Number(w) > 0 ? null : 'Offerte geldig: een aantal dagen'),
};

r.get('/', (req, res) => {
  try {
    const rows = getDb().prepare('SELECT sleutel, waarde, label FROM instellingen ORDER BY sleutel').all()
      .filter(row => INSTELLING_SLEUTELS.has(row.sleutel));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Meerdere instellingen in één keer: body = { sleutel: waarde, ... }.
r.put('/', (req, res) => {
  const invoer = req.body && typeof req.body === 'object' ? Object.entries(req.body) : [];
  if (!invoer.length) return res.status(400).json({ error: 'Geen instellingen meegegeven' });
  for (const [sleutel] of invoer) {
    if (!INSTELLING_SLEUTELS.has(sleutel)) return res.status(403).json({ error: `Deze instelling kan niet via de app gewijzigd worden: ${sleutel}` });
  }
  for (const [sleutel, w] of invoer) {
    const t = w == null ? '' : String(w).trim();
    const fout = t && CONTROLE[sleutel] ? CONTROLE[sleutel](t) : null;
    if (fout) return res.status(400).json({ error: fout });
  }
  const db = getDb();
  const zet = db.prepare(`INSERT INTO instellingen (sleutel, waarde) VALUES (?, ?)
    ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde`);
  db.transaction(() => invoer.forEach(([s, w]) => zet.run(s, w == null ? '' : String(w))))();
  res.json({ ok: true });
});

// Status van de koppelingen, zonder ooit een geheim terug te geven: enkel
// of het ingesteld is (via de add-on-configuratie / omgevingsvariabelen).
r.get('/integraties', (req, res) => {
  res.json({
    home_assistant: haIngesteld(),   // adres + token (add-on of HA_URL/HA_TOKEN)
    gemini: !!process.env.GEMINI_API_KEY,
    // modelnamen zijn geen geheim: zo zie je of GEMINI_MODEL(_RESERVE) goed staat
    gemini_model: GEMINI_MODEL(),
    gemini_reserve: reserveModellen(),
    // stap 5b: mailen (SMTP_USER/SMTP_PASS) en PDF (Chrome/Edge/Chromium gevonden?)
    mail: mailIngesteld(),
    pdf: !!vindBrowser(),
  });
});

r.put('/:sleutel', (req, res) => {
  try {
    if (!INSTELLING_SLEUTELS.has(req.params.sleutel)) {
      return res.status(403).json({ error: 'Deze instelling kan niet via de app gewijzigd worden.' });
    }
    const { waarde } = req.body;
    if (waarde === undefined) return res.status(400).json({ error: 'waarde is verplicht' });
    const db = getDb();
    const rij = db.prepare('SELECT 1 FROM instellingen WHERE sleutel = ?').get(req.params.sleutel);
    if (rij) {
      db.prepare('UPDATE instellingen SET waarde = ? WHERE sleutel = ?').run(String(waarde), req.params.sleutel);
    } else {
      db.prepare('INSERT INTO instellingen (sleutel, waarde) VALUES (?,?)').run(req.params.sleutel, String(waarde));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default r;
