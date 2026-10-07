// /api/webshopbestellingen — betaalde bestellingen uit de webshop (07-10)
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { bewaarBestellingen, leesBestellingen, zetAfgehandeld } from '../domein/webshopbestellingen.js';
import { haalBetaaldeBestellingen, supabaseIngesteld, SupabaseFout } from '../integraties/supabase.js';

const r = Router();
const metFouten = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof DomeinFout) return res.status(e.status || 400).json({ error: e.message });
    if (e instanceof SupabaseFout) return res.status(502).json({ error: e.message });
    console.error('[webshopbestellingen]', e); res.status(500).json({ error: e.message });
  }
};

r.get('/', metFouten((req, res) => res.json({ ingesteld: supabaseIngesteld(), bestellingen: leesBestellingen(getDb(), { alles: req.query.alles === '1' }) })));
r.post('/ophalen', metFouten(async (req, res) => {
  const orders = await haalBetaaldeBestellingen();
  const db = getDb();
  res.json({ nieuw: db.transaction(() => bewaarBestellingen(db, orders))() });
}));
r.post('/:id/afgehandeld', metFouten((req, res) => { zetAfgehandeld(getDb(), req.params.id, req.body?.aan !== false); res.json({ ok: true }); }));

export default r;
