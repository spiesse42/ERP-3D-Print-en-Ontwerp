// /api/controles — overzicht van ontbrekende gegevens (stap 4b)
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ontbrekendeGegevens } from '../domein/controles.js';

const r = Router();
r.get('/', (req, res) => {
  try { res.json(ontbrekendeGegevens(getDb())); } catch (e) { res.status(500).json({ error: e.message }); }
});
export default r;
