// ═══════════════════════════════════════════════════════════════════════
// /api/producten — vaste producten (06-10): overzicht met kost en marge,
// webshopproducten ophalen/overnemen, onderdelen per stuk
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { leesArtikelen } from '../domein/artikelen.js';
import { leesOnderdelen, bewaarOnderdelen } from '../domein/onderdelen.js';
import { webshopRijen, vergelijk, neemOver, ontkoppel } from '../domein/webshop.js';
import { haalProducten, WebshopFout } from '../integraties/sanity.js';
import { artikelMetProfiel, schatKost } from '../productie/printprofiel.js';

const r = Router();
function metFouten(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof DomeinFout) return res.status(e.status || 400).json({ error: e.message });
      if (e instanceof WebshopFout) return res.status(502).json({ error: e.message });
      console.error('[producten]', e);
      res.status(500).json({ error: e.message });
    }
  };
}

const r2 = v => (v == null ? null : Math.round(v * 100) / 100);

// Kost per stuk van één artikel: geschat (profiel + onderdelen) en gemeten
export function kostVanArtikel(db, a) {
  const { profiel } = artikelMetProfiel(db, a.id);
  const onderdelen = leesOnderdelen(db, a.id);
  const schatting = schatKost(db, profiel, onderdelen);
  const g = db.prepare(`SELECT SUM(o.productiekost_stuk * o.aantal_goed) k, SUM(COALESCE(o.arbeid_stuk, 0) * o.aantal_goed) ar, SUM(o.aantal_goed) n
    FROM printopdrachten o JOIN dossier_regels dr ON dr.id = o.dossier_regel_id JOIN dossiers d ON d.id = dr.dossier_id
    WHERE dr.artikel_id = ? AND d.soort = 'eigen' AND o.voltooid_op IS NOT NULL AND o.aantal_goed > 0 AND o.productiekost_stuk IS NOT NULL`).get(a.id);
  const delen = schatting.onderdelen;
  const gemeten = g?.n ? { kost: r2(g.k / g.n + delen), arbeid: r2(g.ar / g.n), stuks: g.n } : null;
  return { profiel: !!profiel, onderdelen, schatting, gemeten };
}

r.get('/', metFouten((req, res) => {
  const db = getDb();
  const verkocht = db.prepare(`SELECT vr.artikel_id, SUM(vr.aantal) n FROM verkoop_regels vr JOIN verkopen v ON v.id = vr.verkoop_id
    WHERE v.geannuleerd_op IS NULL AND vr.artikel_id IS NOT NULL AND v.datum >= date('now', '-30 days') GROUP BY vr.artikel_id`).all();
  const per = new Map(verkocht.map(x => [x.artikel_id, x.n]));
  const lijst = leesArtikelen(db, { archief: req.query.archief || '0', type: 'artikel' }).filter(a => a.zelf_geprint).map(a => {
    const k = kostVanArtikel(db, a);
    const kost = k.gemeten?.kost ?? (k.schatting.onvolledig && !k.profiel ? null : k.schatting.kost);
    const prijsExcl = a.verkoopprijs;   // btw 0 % (vrijstelling kleine onderneming)
    return {
      id: a.id, weergave: a.weergave, categorie: a.categorie ?? null, verkoopprijs: a.verkoopprijs,
      webshop: a.webshop_slug ? { slug: a.webshop_slug, variant: a.webshop_variant, foto: a.webshop_foto } : null,
      voorraad: a.voorraad, min: a.min_eff ?? a.min_voorraad ?? null, in_productie: a.in_productie ?? 0, verkocht_30d: per.get(a.id) || 0,
      profiel: k.profiel, onderdelen: k.onderdelen.length, schatting: k.schatting, gemeten: k.gemeten,
      kost, marge: kost != null && prijsExcl ? r2(prijsExcl - kost) : null, marge_pct: kost != null && prijsExcl ? Math.round((prijsExcl - kost) / prijsExcl * 100) : null,
    };
  });
  res.json(lijst);
}));

// ── webshop (Sanity): ophalen = vergelijken, overnemen = aanmaken/bijwerken
r.get('/webshop', metFouten(async (req, res) => res.json(vergelijk(getDb(), webshopRijen(await haalProducten())))));
r.post('/webshop/overnemen', metFouten(async (req, res) => {
  const rijen = webshopRijen(await haalProducten());
  const db = getDb();
  res.json(db.transaction(() => neemOver(db, rijen, req.body?.sleutels))());
}));
r.post('/:id/ontkoppel', metFouten((req, res) => { ontkoppel(getDb(), req.params.id); res.json({ ok: true }); }));

// ── onderdelen per stuk + kost
r.get('/:id/onderdelen', metFouten((req, res) => res.json(leesOnderdelen(getDb(), req.params.id))));
r.put('/:id/onderdelen', metFouten((req, res) => {
  const db = getDb();
  res.json(db.transaction(() => bewaarOnderdelen(db, req.params.id, req.body?.onderdelen))());
}));
r.get('/:id/kost', metFouten((req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT id FROM artikelen WHERE id = ?').get(Number(req.params.id));
  if (!a) throw Object.assign(new DomeinFout('Artikel niet gevonden'), { status: 404 });
  res.json(kostVanArtikel(db, a));
}));

export default r;
