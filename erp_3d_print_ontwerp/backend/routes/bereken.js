// POST /api/bereken — { regels, stand? } → berekening (rekenmotor, stap 4).
// Gebruikt door de live-preview; niets wordt bewaard.
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { berekenMetDb } from '../domein/berekening.js';

const r = Router();
r.post('/', (req, res) => {
  const stand = req.body?.stand === 'werkelijk' ? 'werkelijk' : 'schatting';
  if (req.body?.regels !== undefined && !Array.isArray(req.body.regels)) return res.status(400).json({ error: 'Regels moeten een lijst zijn' });
  try { res.json(berekenMetDb(getDb(), req.body?.regels || [], { stand })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
export default r;
