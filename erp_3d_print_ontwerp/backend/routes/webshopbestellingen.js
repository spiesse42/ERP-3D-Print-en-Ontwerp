// /api/webshopbestellingen — betaalde bestellingen uit de webshop (07-10)
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { bewaarBestellingen, leesBestellingen, zetAfgehandeld } from '../domein/webshopbestellingen.js';
import { maakDossierUitBestelling } from '../domein/webshopdossier.js';
import { sanityQuery } from '../integraties/sanity.js';
import { haalBetaaldeBestellingen, supabaseIngesteld, SupabaseFout } from '../integraties/supabase.js';

const r = Router();
const metFouten = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e instanceof DomeinFout) return res.status(e.status || 400).json({ error: e.message });
    if (e instanceof SupabaseFout) return res.status(502).json({ error: e.message });
    console.error('[webshopbestellingen]', e); res.status(500).json({ error: e.message });
  }
};

// 11-10: kleuren uit de webshop (Sanity) → filament bij de gekozen kleur;
// 10 min in het geheugen; niet bereikbaar = geen filament, geen fout
let kleurCache = { t: 0, map: null };
async function kleuren() {
  if (kleurCache.map && Date.now() - kleurCache.t < 10 * 60000) return kleurCache.map;
  try {
    const lijst = await sanityQuery('*[_type == "color" && !(_id in path("drafts.**"))]{ label, "slug": slug.current, hex, filamentName }', {}, { metToken: false }) || [];
    const map = new Map();
    for (const c of lijst) for (const k of [c.label, c.slug]) if (k) map.set(String(k).trim().toLowerCase(), c);
    kleurCache = { t: Date.now(), map };
  } catch { /* webshop niet bereikbaar */ }
  return kleurCache.map;
}
r.get('/', metFouten(async (req, res) => res.json({ ingesteld: supabaseIngesteld(),
  bestellingen: leesBestellingen(getDb(), { alles: req.query.alles === '1', kleuren: await kleuren() }) })));
r.post('/ophalen', metFouten(async (req, res) => {
  const orders = await haalBetaaldeBestellingen();
  const db = getDb();
  res.json({ nieuw: db.transaction(() => bewaarBestellingen(db, orders))() });
}));
// 25-10: klant + klantdossier met de printregels; body { items: [index…] } (leeg = standaardkeuze)
r.post('/:id/dossier', metFouten(async (req, res) => {
  const k = await kleuren();
  res.status(201).json(maakDossierUitBestelling(getDb(), req.params.id, { items: req.body?.items ?? null, kleuren: k }));
}));
r.post('/:id/afgehandeld', metFouten((req, res) => { zetAfgehandeld(getDb(), req.params.id, req.body?.aan !== false); res.json({ ok: true }); }));

export default r;
