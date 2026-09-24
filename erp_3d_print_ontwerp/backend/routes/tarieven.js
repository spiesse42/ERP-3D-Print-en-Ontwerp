import { Router } from 'express';
import { getDb } from '../db/index.js';

const r = Router();

r.get('/', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM tarieven ORDER BY sleutel').all());
});

// Meerdere tarieven in één keer (formulier met Opslaan/Verwerpen):
// body = { sleutel: waarde, ... }. Alles of niets.
r.put('/', (req, res) => {
  const db = getDb();
  const invoer = req.body && typeof req.body === 'object' ? Object.entries(req.body) : [];
  if (!invoer.length) return res.status(400).json({ error: 'Geen tarieven meegegeven' });
  const bestaand = new Set(db.prepare('SELECT sleutel FROM tarieven').all().map(t => t.sleutel));
  const rijen = [];
  for (const [sleutel, w] of invoer) {
    if (!bestaand.has(sleutel)) return res.status(404).json({ error: `Onbekend tarief: ${sleutel}` });
    const waarde = typeof w === 'number' ? w : parseFloat(String(w).replace(',', '.'));
    if (!Number.isFinite(waarde) || waarde < 0) return res.status(400).json({ error: `Ongeldige waarde voor ${sleutel}` });
    rijen.push([waarde, sleutel]);
  }
  const upd = db.prepare('UPDATE tarieven SET waarde = ? WHERE sleutel = ?');
  db.transaction(() => rijen.forEach(r => upd.run(...r)))();
  res.json({ ok: true, gewijzigd: rijen.length });
});

r.put('/:sleutel', (req, res) => {
  try {
    const db = getDb();
    const waarde = parseFloat(req.body.waarde);
    if (!Number.isFinite(waarde)) return res.status(400).json({ error: 'Waarde moet een getal zijn' });
    const info = db.prepare('UPDATE tarieven SET waarde = ? WHERE sleutel = ?').run(waarde, req.params.sleutel);
    if (info.changes === 0) return res.status(404).json({ error: 'Tarief niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default r;
