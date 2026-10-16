// ═══════════════════════════════════════════════════════════════════════
// Webshopproduct beheren vanuit het ERP en naar Sanity pushen (11-10)
// ═══════════════════════════════════════════════════════════════════════
// Beslist met David (11-10):
// - het ERP is de baas over de velden hieronder (VELDEN); wat het ERP niet
//   beheert (maatvarianten, video, vormvoorbeelden, letterformulier, eigen
//   bestel-link) blijft in Sanity onaangeroerd
// - naam = artikelnaam, prijs = verkoopprijs van het artikel
// - een nieuw product wordt meteen gepubliceerd, maar standaard "verborgen"
// - is het product in Sanity gewijzigd sinds de laatste push → waarschuwen
//   (409); "toch pushen" overschrijft
// - foto's: enkel als er in het ERP foto's gekozen zijn; anders blijven de
//   foto's in Sanity staan
// - de slug van een bestaand product verandert nooit
// - een artikel met een maatvariant (webshop_variant) kan (nog) niet gepusht
//   worden: varianten blijven voorlopig in Sanity
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { bijlagenMap } from '../db/index.js';
import { DomeinFout } from './hulp.js';
import { logGebeurtenis } from './historiek.js';
import { sanityQuery, sanityMutate, sanityAfbeelding } from '../integraties/sanity.js';

const BOOL = ['priceFrom', 'imageIsRender', 'customOrder', 'featured', 'hidden', 'comingSoon', 'colorChoice'];
const STANDAARD = { description: '', priceFrom: false, emoji: '✨', category_id: null, createdAt: null, image_bijlage_id: null, photo_bijlage_ids: [],
  imageIsRender: false, customOrder: false, featured: false, featuredOrder: null, hidden: true, comingSoon: false,
  colorChoice: false, colorChoiceCount: null, colorChoiceLabel: '', allowedColors: [], weightGrams: null };
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
const getalOfNull = (v, wat) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new DomeinFout(`${wat} moet een getal vanaf 0 zijn`);
  return n;
};

// 16-10: Layer & Leaf — standaard in de beschrijving (staat er al
// "Standaardkleur" in, dan niet nog eens)
export const LAYER_LEAF_SJABLOON = 'Standaardkleur: \nAfmetingen:\n• Breedte: \n• Hoogte: \n\nDesign by Layer & Leaf';
export function isLayerLeaf(db, categorieId) {
  for (let c = categorieId ? db.prepare('SELECT naam, ouder_id FROM categorieen WHERE id = ?').get(categorieId) : null, n = 0; c && n < 10; n++) {
    if (/layer\s*(&|and|en)\s*leaf/i.test(c.naam)) return true;
    c = c.ouder_id ? db.prepare('SELECT naam, ouder_id FROM categorieen WHERE id = ?').get(c.ouder_id) : null;
  }
  return false;
}
export function metSjabloon(beschrijving) {
  const t = String(beschrijving || '').trim();
  if (/standaardkleur/i.test(t)) return t;
  return t ? `${t}\n\n${LAYER_LEAF_SJABLOON}` : LAYER_LEAF_SJABLOON;
}

// Nog niet ingevuld in het sjabloon (bv. "Breedte:" zonder maat) → melding
export function leegInSjabloon(t) {
  const leeg = ['Standaardkleur', 'Breedte', 'Hoogte'].filter(w => new RegExp(`${w}:[ \\t]*(\\n|$)`, 'i').test(String(t || '')));
  return leeg.length ? `Nog in te vullen in de beschrijving: ${leeg.join(', ').toLowerCase()}.` : null;
}

function artikel(db, id) {
  const a = db.prepare(`SELECT id, naam, type, verkoopprijs, categorie_id, wordt_verkocht, printprofiel, webshop_slug, webshop_variant, webshop_data,
    webshop_sanity_id, webshop_sanity_rev, webshop_gepusht_op FROM artikelen WHERE id = ?`).get(Number(id));
  if (!a) throw Object.assign(new DomeinFout('Artikel niet gevonden'), { status: 404 });
  return a;
}
const fotosVan = (db, id) => db.prepare(`SELECT id, bestandsnaam, mimetype FROM bijlagen WHERE entiteit = 'artikel' AND entiteit_id = ? AND mimetype LIKE 'image/%' ORDER BY id`).all(id);
function gewichtUitProfiel(a) {
  try { const p = JSON.parse(a.printprofiel || 'null'); const g = (p?.materialen || []).reduce((t, m) => t + (Number(m.gram) || 0), 0); return g > 0 ? Math.round(g * 10) / 10 : null; }
  catch { return null; }
}

// Formulierinvoer → opgeslagen vorm (enkel bekende velden, gecontroleerd)
export function leesInvoer(db, artikelId, b) {
  const fotos = new Set(fotosVan(db, artikelId).map(f => f.id));
  const idLijst = (l, wat) => (Array.isArray(l) ? l : []).map(Number).filter(x => { if (!fotos.has(x)) throw new DomeinFout(`${wat}: onbekende foto`); return true; });
  const d = { ...STANDAARD };
  d.description = String(b?.description ?? '').replace(/\r\n/g, '\n').trim();
  d.emoji = String(b?.emoji ?? '').trim() || STANDAARD.emoji;
  d.category_id = String(b?.category_id ?? '').trim() || null;
  d.createdAt = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.createdAt || '')) ? b.createdAt : null;
  d.image_bijlage_id = b?.image_bijlage_id ? idLijst([b.image_bijlage_id], 'Hoofdfoto')[0] : null;
  d.photo_bijlage_ids = idLijst(b?.photo_bijlage_ids, "Extra foto's").filter(x => x !== d.image_bijlage_id);
  for (const k of BOOL) d[k] = !!b?.[k];
  d.featuredOrder = getalOfNull(b?.featuredOrder, 'Volgorde in de banner');
  d.colorChoiceCount = getalOfNull(b?.colorChoiceCount, 'Aantal kleurkeuzes');
  d.colorChoiceLabel = String(b?.colorChoiceLabel ?? '').trim();
  d.allowedColors = (Array.isArray(b?.allowedColors) ? b.allowedColors : []).map(String).filter(Boolean);
  d.weightGrams = getalOfNull(b?.weightGrams, 'Gewicht');
  return d;
}

// Opgeslagen webshopgegevens; nog niets bewaard maar wel gekoppeld → eenmalig
// uit Sanity ophalen (zonder foto's: die blijven in Sanity tot je er kiest).
export async function leesWebshop(db, artikelId, { fetchFn = fetch } = {}) {
  const a = artikel(db, artikelId);
  let data = a.webshop_data ? { ...STANDAARD, ...JSON.parse(a.webshop_data) } : null;
  let bron = data ? 'erp' : 'nieuw';
  let sanityFoto = false;
  if (!data && a.webshop_slug) {
    try {
      const p = await sanityQuery(`*[_type == "product" && slug.current == $s && !(_id in path("drafts.**"))][0]{
        description, priceFrom, emoji, "category_id": category._ref, createdAt, imageIsRender, customOrder, featured, featuredOrder, hidden, comingSoon,
        colorChoice, colorChoiceCount, colorChoiceLabel, "allowedColors": allowedColors[]._ref, weightGrams, "foto": defined(image) }`, { s: a.webshop_slug }, { fetchFn, metToken: false });
      if (p) {
        data = { ...STANDAARD };
        for (const k of Object.keys(STANDAARD)) if (p[k] !== undefined && p[k] !== null) data[k] = p[k];
        for (const k of BOOL) data[k] = !!p[k];
        data.allowedColors = p.allowedColors || [];
        sanityFoto = !!p.foto;
        bron = 'sanity';
      }
    } catch { /* niet bereikbaar: leeg formulier */ }
  }
  if (!data) data = { ...STANDAARD, createdAt: vandaag(), weightGrams: gewichtUitProfiel(a) };
  if (isLayerLeaf(db, a.categorie_id)) data = { ...data, description: metSjabloon(data.description) };
  return { data, bron, sanity_foto: sanityFoto, fotos: fotosVan(db, a.id), slug: a.webshop_slug, variant: a.webshop_variant,
    gepusht_op: a.webshop_gepusht_op, naam: a.naam, prijs: a.verkoopprijs, gewicht_profiel: gewichtUitProfiel(a) };
}

export function bewaarWebshop(db, artikelId, body) {
  const a = artikel(db, artikelId);
  const oud = a.webshop_data ? JSON.parse(a.webshop_data) : {};
  const d = { ...leesInvoer(db, a.id, body), assets: oud.assets || {} };
  db.prepare('UPDATE artikelen SET webshop_data = ? WHERE id = ?').run(JSON.stringify(d), a.id);
  return d;
}

export const slugVan = naam => String(naam).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'product';

async function asset(db, d, bijlageId, fetchFn) {
  if (d.assets[bijlageId]) return d.assets[bijlageId];
  const b = db.prepare('SELECT * FROM bijlagen WHERE id = ?').get(bijlageId);
  if (!b) throw new DomeinFout('Een gekozen foto bestaat niet meer');
  const buf = fs.readFileSync(path.join(bijlagenMap(), b.pad));
  d.assets[bijlageId] = await sanityAfbeelding(buf, b.mimetype, b.bestandsnaam, { fetchFn });
  return d.assets[bijlageId];
}
const beeld = id => ({ _type: 'image', asset: { _type: 'reference', _ref: id } });

export async function pushWebshop(db, artikelId, { forceer = false, fetchFn = fetch } = {}) {
  const a = artikel(db, artikelId);
  if (a.webshop_variant) throw new DomeinFout(`Dit artikel is een maatvariant ("${a.webshop_variant}") van een webshopproduct: varianten beheer je voorlopig in Sanity.`);
  if (!a.webshop_data) throw new DomeinFout('Vul eerst de webshopgegevens in en bewaar ze (tabblad Webshop).');
  const d = { assets: {}, ...STANDAARD, ...JSON.parse(a.webshop_data) };
  const fout = [];
  if (a.verkoopprijs == null) fout.push('een verkoopprijs');
  if (!d.description) fout.push('een beschrijving');
  if (!d.category_id) fout.push('een categorie');
  if (fout.length) throw new DomeinFout(`Voor de webshop ontbreekt nog: ${fout.join(', ')}.`);

  // bestaand product zoeken (eigen id, anders via de slug)
  let doc = null;
  if (a.webshop_sanity_id || a.webshop_slug) {
    doc = await sanityQuery(a.webshop_sanity_id ? '*[_id == $id][0]{_id, _updatedAt, "slug": slug.current}' : '*[_type == "product" && slug.current == $s && !(_id in path("drafts.**"))][0]{_id, _updatedAt, "slug": slug.current}',
      a.webshop_sanity_id ? { id: a.webshop_sanity_id } : { s: a.webshop_slug }, { fetchFn });
  }
  if (doc && a.webshop_sanity_rev && doc._updatedAt !== a.webshop_sanity_rev && !forceer) {
    throw Object.assign(new DomeinFout('Dit product is in Sanity gewijzigd sinds de laatste push vanuit het ERP. Toch pushen overschrijft die wijzigingen (enkel de velden die het ERP beheert).'), { status: 409 });
  }

  // foto's (enkel als er in het ERP gekozen zijn)
  const velden = {
    name: a.naam, price: a.verkoopprijs, description: d.description, emoji: d.emoji,
    category: { _type: 'reference', _ref: d.category_id }, createdAt: d.createdAt || vandaag(),
    ...Object.fromEntries(BOOL.map(k => [k, !!d[k]])),
    allowedColors: d.allowedColors.map(id => ({ _type: 'reference', _ref: id, _key: crypto.createHash('md5').update(id).digest('hex').slice(0, 12) })),
  };
  const weg = [];
  const zetOfWeg = (k, v) => { if (v === null || v === undefined || v === '') weg.push(k); else velden[k] = v; };
  zetOfWeg('featuredOrder', d.featuredOrder);
  zetOfWeg('colorChoiceCount', d.colorChoiceCount);
  zetOfWeg('colorChoiceLabel', d.colorChoiceLabel);
  zetOfWeg('weightGrams', d.weightGrams ?? gewichtUitProfiel(a));
  if (d.image_bijlage_id) {
    velden.image = beeld(await asset(db, d, d.image_bijlage_id, fetchFn));
    velden.photos = [];
    for (const f of d.photo_bijlage_ids) velden.photos.push({ ...beeld(await asset(db, d, f, fetchFn)), _key: `f${f}` });
  }

  let id, slug, nieuw = false;
  if (doc) {
    id = doc._id; slug = doc.slug;
    await sanityMutate([{ patch: { id, set: velden, ...(weg.length ? { unset: weg } : {}) } }], { fetchFn });
  } else {
    nieuw = true;
    const basis = slugVan(a.naam);
    slug = basis;
    for (let i = 2; await sanityQuery('count(*[_type == "product" && slug.current == $s])', { s: slug }, { fetchFn }) > 0; i++) slug = `${basis}-${i}`;
    id = crypto.randomUUID();
    await sanityMutate([{ create: { _id: id, _type: 'product', ...velden, slug: { _type: 'slug', current: slug } } }], { fetchFn });
  }
  const na = await sanityQuery('*[_id == $id][0]{_updatedAt}', { id }, { fetchFn });
  const concept = await sanityQuery('count(*[_id == $id])', { id: `drafts.${id}` }, { fetchFn });
  db.transaction(() => {
    db.prepare(`UPDATE artikelen SET webshop_data = ?, webshop_sanity_id = ?, webshop_sanity_rev = ?, webshop_gepusht_op = datetime('now'),
      webshop_slug = COALESCE(webshop_slug, ?), wordt_verkocht = 1 WHERE id = ?`).run(JSON.stringify(d), id, na?._updatedAt ?? null, slug, a.id);
    logGebeurtenis(db, 'artikel', a.id, 'gewijzigd', `${nieuw ? 'Aangemaakt in' : 'Bijgewerkt in'} de webshop (${slug})${d.hidden ? ', verborgen' : ''}`);
  })();
  return { ok: true, nieuw, slug, verborgen: !!d.hidden,
    waarschuwing: [concept > 0 ? 'In Sanity staat nog een niet-gepubliceerd concept van dit product: open het in Sanity en kies "Discard changes", anders zie je daar de oude versie.' : null,
      leegInSjabloon(d.description)].filter(Boolean).join(' ') || null };
}

// Keuzelijsten voor het formulier (publiek leesbaar)
export async function keuzes({ fetchFn = fetch } = {}) {
  const r = await sanityQuery(`{ "categorieen": *[_type == "category" && !(_id in path("drafts.**"))] | order(coalesce(parent->sortOrder, sortOrder) asc, defined(parent) asc, sortOrder asc, name asc){ _id, "name": select(defined(parent) => parent->name + " › " + name, name) },
    "kleuren": *[_type == "color" && !(_id in path("drafts.**"))] | order(label asc){ _id, label, hex } }`, {}, { fetchFn, metToken: false });
  return { categorieen: r?.categorieen || [], kleuren: r?.kleuren || [], token: !!process.env.SANITY_TOKEN };
}
