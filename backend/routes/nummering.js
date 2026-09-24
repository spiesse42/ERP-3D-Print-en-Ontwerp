// /api/nummering — reeksen en hun volgende nummer (stap 5a)
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { overzicht, zetVolgend } from '../domein/nummering.js';

const r = Router();
r.get('/', (req, res) => res.json(overzicht(getDb())));
r.put('/:reeks', (req, res) => {
  try { zetVolgend(getDb(), req.params.reeks, req.body?.volgend); res.json(overzicht(getDb())); }
  catch (e) { res.status(e instanceof DomeinFout ? 400 : 500).json({ error: e.message }); }
});
export default r;
