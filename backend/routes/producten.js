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
import { artikelMetProfiel, schatKost, regelsUitProfiel, stukPlaten } from '../productie/printprofiel.js';
import { berekenMetDb } from '../domein/berekening.js';
import { leesWebshop, bewaarWebshop, pushWebshop, keuzes, maakKeuzeArtikel, maakAlleKeuzeArtikels, voorraadNaarKeuze } from '../domein/webshoppush.js';

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
export function kostVanArtikel(db, a, { advies = true } = {}) {
  const { profiel } = artikelMetProfiel(db, a.id);
  const onderdelen = leesOnderdelen(db, a.id);
  const schatting = schatKost(db, profiel, onderdelen);
  // 21-10: ook de andere platen (plaat_van) tellen mee in de kost; stuks = enkel die van de laatste plaat
  const g = db.prepare(`SELECT SUM(o.productiekost_stuk * o.aantal_goed) k, SUM(COALESCE(o.arbeid_stuk, 0) * o.aantal_goed) ar,
      SUM(CASE WHEN dr.artikel_id = ? THEN o.aantal_goed ELSE 0 END) n
    FROM printopdrachten o JOIN dossier_regels dr ON dr.id = o.dossier_regel_id JOIN dossiers d ON d.id = dr.dossier_id
    WHERE (dr.artikel_id = ? OR dr.plaat_van = ?) AND d.soort = 'eigen' AND o.voltooid_op IS NOT NULL AND o.aantal_goed > 0 AND o.productiekost_stuk IS NOT NULL`).get(a.id, a.id, a.id);
  const delen = schatting.onderdelen;
  const gemeten = g?.n ? { kost: r2(g.k / g.n + delen), arbeid: r2(g.ar / g.n), stuks: g.n } : null;
  // 24-10: één kost per stuk, overal dezelfde: gemeten (gemiddelde van de
  // voorraadprints), anders geschat uit het printprofiel, anders zelf ingevuld
  // (productieprijs op het artikel). Telkens met de onderdelen erbij.
  const zelf = db.prepare('SELECT productieprijs FROM artikelen WHERE id = ?').get(a.id)?.productieprijs ?? null;
  const per_stuk = gemeten ? { bedrag: gemeten.kost, bron: 'gemeten', stuks: gemeten.stuks }
    : profiel ? { bedrag: schatting.kost, bron: 'geschat', onvolledig: schatting.onvolledig }
    : zelf != null ? { bedrag: r2(zelf + delen), bron: 'zelf ingevuld' } : null;
  return { profiel: !!profiel, onderdelen, schatting, gemeten, per_stuk, advies: advies ? adviesprijs(db, profiel, delen) : null };
}

// 09-10: adviesprijs per stuk volgens de rekenmotor (dezelfde berekening als
// een printregel in een dossier): voor 1 stuk en per stuk bij een volle plaat,
// plus de onderdelen aan inkoopprijs.
function adviesprijs(db, profiel, onderdelen = 0) {
  const platen = stukPlaten(profiel);
  if (!platen.length || platen.some(x => !x.printer_id)) return null;
  // 21-10: alle platen samen (een stuk kan uit meerdere platen bestaan)
  const voor = n => {
    const b = berekenMetDb(db, regelsUitProfiel(profiel, n).map(({ omschrijving: _o, laatste: _l, ...r }) => ({ type: 'printen', aantal: n, ...r })), { vergelijk: false });
    if (!b.volledig) return null;
    return r2(b.totaal / n + onderdelen);
  };
  try {
    const stuk = voor(1);
    const pp = platen.length === 1 && platen[0].per_plaat > 1 ? platen[0].per_plaat : null;
    return stuk == null ? null : { stuk, per_plaat: pp, plaat_stuk: pp ? voor(pp) : null };
  } catch { return null; }
}

r.get('/', metFouten((req, res) => {
  const db = getDb();
  const verkocht = db.prepare(`SELECT vr.artikel_id, SUM(vr.aantal) n FROM verkoop_regels vr JOIN verkopen v ON v.id = vr.verkoop_id
    WHERE v.geannuleerd_op IS NULL AND vr.artikel_id IS NOT NULL AND v.datum >= date('now', '-30 days') GROUP BY vr.artikel_id`).all();
  const per = new Map(verkocht.map(x => [x.artikel_id, x.n]));
  const keuzeTel = new Map(db.prepare(`SELECT webshop_slug s, COUNT(*) n FROM artikelen WHERE webshop_slug IS NOT NULL AND webshop_variant IS NOT NULL AND gearchiveerd = 0 GROUP BY webshop_slug`).all().map(x => [x.s, x.n]));
  const lijst = leesArtikelen(db, { archief: req.query.archief || '0', type: 'artikel' }).filter(a => a.zelf_geprint).map(a => {
    const k = kostVanArtikel(db, a);
    const kost = k.per_stuk?.bedrag ?? null;
    const prijsExcl = a.verkoopprijs;   // btw 0 % (vrijstelling kleine onderneming)
    return {
      id: a.id, weergave: a.weergave, categorie: a.categorie ?? null, verkoopprijs: a.verkoopprijs,
      webshop: a.webshop_slug ? { slug: a.webshop_slug, variant: a.webshop_variant, foto: a.webshop_foto } : null,
      // 23-10: hoofdartikel met eigen artikels per keuze (maat/model): het printprofiel en de voorraad zitten bij die keuzes
      keuzes: a.webshop_slug && !a.webshop_variant ? keuzeTel.get(a.webshop_slug) || 0 : 0,
      voorraad: a.voorraad, min: a.min_eff ?? a.min_voorraad ?? null, in_productie: a.in_productie ?? 0, verkocht_30d: per.get(a.id) || 0,
      profiel: k.profiel, onderdelen: k.onderdelen.length, schatting: k.schatting, gemeten: k.gemeten,
      kost, kost_bron: k.per_stuk?.bron ?? null, kost_onvolledig: !!k.per_stuk?.onvolledig, marge: kost != null && prijsExcl ? r2(prijsExcl - kost) : null, marge_pct: kost != null && prijsExcl ? Math.round((prijsExcl - kost) / prijsExcl * 100) : null,
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
// 11-10: webshopvelden beheren in het ERP en naar Sanity pushen
r.get('/webshop/keuzes', metFouten(async (req, res) => res.json(await keuzes())));
// 23-10: per webshopkeuze een eigen artikel
r.post('/webshop/keuze-artikels', metFouten((req, res) => { const db = getDb(); res.json(db.transaction(() => maakAlleKeuzeArtikels(db))()); }));
r.post('/:id/webshop/voorraad-naar-keuze', metFouten((req, res) => { const db = getDb(); res.json(db.transaction(() => voorraadNaarKeuze(db, req.params.id, req.body?.label))()); }));
r.post('/:id/webshop/keuze-artikel', metFouten((req, res) => { const db = getDb(); res.status(201).json(db.transaction(() => maakKeuzeArtikel(db, req.params.id, req.body?.label))()); }));
r.get('/:id/webshop', metFouten(async (req, res) => res.json(await leesWebshop(getDb(), req.params.id))));
r.put('/:id/webshop', metFouten((req, res) => { bewaarWebshop(getDb(), req.params.id, req.body); res.json({ ok: true }); }));
r.post('/:id/webshop/push', metFouten(async (req, res) => res.json(await pushWebshop(getDb(), req.params.id, { forceer: !!req.body?.forceer }))));
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
