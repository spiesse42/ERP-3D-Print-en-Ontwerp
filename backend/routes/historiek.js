import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ENTITEITEN, bestaatRecord, leesHistoriek, logGebeurtenis } from '../domein/historiek.js';

// GET  /api/historiek/:entiteit/:id  → tijdlijn (nieuwste eerst)
// POST /api/historiek/:entiteit/:id  → notitie toevoegen { tekst }
const r = Router();

function controleer(req, res) {
  const { entiteit } = req.params;
  const id = parseInt(req.params.id, 10);
  if (!ENTITEITEN[entiteit]) { res.status(404).json({ error: 'Onbekend soort record' }); return null; }
  if (!Number.isInteger(id) || !bestaatRecord(getDb(), entiteit, id)) { res.status(404).json({ error: 'Record niet gevonden' }); return null; }
  return { entiteit, id };
}

r.get('/:entiteit/:id', (req, res) => {
  const c = controleer(req, res); if (!c) return;
  res.json(leesHistoriek(getDb(), c.entiteit, c.id));
});

r.post('/:entiteit/:id', (req, res) => {
  const c = controleer(req, res); if (!c) return;
  const tekst = String(req.body?.tekst || '').trim();
  if (!tekst) return res.status(400).json({ error: 'Een notitie mag niet leeg zijn' });
  if (tekst.length > 5000) return res.status(400).json({ error: 'Notitie is te lang (max. 5000 tekens)' });
  const id = logGebeurtenis(getDb(), c.entiteit, c.id, 'notitie', tekst);
  res.status(201).json({ id });
});

export default r;
