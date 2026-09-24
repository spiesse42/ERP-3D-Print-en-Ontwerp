// ═══════════════════════════════════════════════════════════════════════
// ARTIKELEN — catalogus (type + vinkjes + categorie, migratie 003)
// ═══════════════════════════════════════════════════════════════════════
// Hier staan de regels en het "leesmodel" (naam, voorraad, minimum, ...)
// op één plaats. Routes, "te bestellen" en later de rekenmotor en de OCR
// gebruiken dezelfde functies.

import { DomeinFout, optioneelGetal, rond } from './hulp.js';
import { logGebeurtenis } from './historiek.js';

export const TYPES = ['filament', 'artikel', 'dienst'];

// ── Leesmodel ─────────────────────────────────────────────────────────────
// Eén query voor lijst, formulier, "te bestellen" en telling:
// - voorraad  = som van de resterende aantallen in de partijen
// - waarde    = resterend × prijs per eenheid (enkel partijen met een prijs)
// - besteld   = nog niet ontvangen aantallen op bestelde, niet-geannuleerde aankopen
// - in_productie = stuks in open printopdrachten van een dossier "Eigen
//   product" met dit artikel als eindproduct (stap 6c); telt mee zoals besteld
// - min_eff / max_eff = eigen waarde van het artikel, anders (filament) die van de prijsgroep
const SELECT = `
  SELECT a.*,
    m.naam AS merk, mat.naam AS materiaal, k.naam AS kleur, k.hex AS kleur_hex,
    ft.verkoopprijs_per_kg, ft.rolgewicht_g, ft.min_rollen, ft.max_rollen,
    COALESCE(v.voorraad, 0) AS voorraad, v.waarde, v.met_prijs, v.partijen,
    COALESCE(b.besteld, 0) AS besteld, COALESCE(pr.in_productie, 0) AS in_productie,
    COALESCE(a.min_voorraad, CASE WHEN a.type = 'filament' THEN ft.min_rollen END) AS min_eff,
    COALESCE(a.max_voorraad, CASE WHEN a.type = 'filament' THEN ft.max_rollen END) AS max_eff
  FROM artikelen a
  LEFT JOIN filament_types ft ON ft.id = a.filament_type_id
  LEFT JOIN filament_merken m ON m.id = ft.merk_id
  LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id
  LEFT JOIN filament_kleuren k ON k.id = a.kleur_id
  LEFT JOIN (
    SELECT artikel_id, SUM(aantal_resterend) AS voorraad,
           SUM(CASE WHEN prijs_per_eenheid IS NOT NULL THEN aantal_resterend * prijs_per_eenheid END) AS waarde,
           SUM(CASE WHEN prijs_per_eenheid IS NOT NULL THEN aantal_resterend END) AS met_prijs,
           SUM(aantal_resterend > 0) AS partijen
    FROM voorraad_partijen GROUP BY artikel_id
  ) v ON v.artikel_id = a.id
  LEFT JOIN (
    SELECT r.artikel_id, SUM(MAX(r.aantal - COALESCE(o.ontvangen, 0), 0)) AS besteld
    FROM aankoop_regels r
    JOIN aankopen ak ON ak.id = r.aankoop_id AND ak.besteld_op IS NOT NULL AND ak.geannuleerd_op IS NULL
    LEFT JOIN (SELECT aankoop_regel_id, SUM(aantal_ontvangen) AS ontvangen FROM voorraad_partijen GROUP BY aankoop_regel_id) o
      ON o.aankoop_regel_id = r.id
    WHERE r.artikel_id IS NOT NULL
    GROUP BY r.artikel_id
  ) b ON b.artikel_id = a.id
  LEFT JOIN (
    SELECT dr.artikel_id, SUM(po.aantal) AS in_productie
    FROM printopdrachten po JOIN dossier_regels dr ON dr.id = po.dossier_regel_id AND dr.type = 'printen'
    JOIN dossiers d ON d.id = dr.dossier_id AND d.soort = 'eigen'
    WHERE po.voltooid_op IS NULL AND po.geannuleerd_op IS NULL AND dr.artikel_id IS NOT NULL
    GROUP BY dr.artikel_id
  ) pr ON pr.artikel_id = a.id`;

export function categoriePaden(db) {
  const rijen = db.prepare('SELECT id, naam, ouder_id FROM categorieen').all();
  const perId = new Map(rijen.map(c => [c.id, c]));
  const pad = new Map();
  const bouw = (c, diepte = 0) => {
    if (pad.has(c.id)) return pad.get(c.id);
    const ouder = c.ouder_id && diepte < 20 ? perId.get(c.ouder_id) : null;
    const p = ouder ? `${bouw(ouder, diepte + 1)} / ${c.naam}` : c.naam;
    pad.set(c.id, p);
    return p;
  };
  rijen.forEach(c => bouw(c));
  return pad;
}

export function weergaveNaam(a) {
  if (a.type === 'filament') return `${a.merk ?? '?'} ${a.materiaal ?? '?'} · ${a.kleur ?? '?'}`;
  return a.naam;
}

function verrijk(a, paden) {
  const voorraad = rond(a.voorraad);
  const gemPrijs = a.met_prijs ? rond(a.waarde / a.met_prijs) : null;
  let status = 'geen';
  if (a.type === 'dienst') status = null;
  else if (a.min_eff != null) status = voorraad + a.besteld + a.in_productie < a.min_eff - 1e-9 ? 'bestellen' : voorraad < a.min_eff - 1e-9 ? (a.besteld > 0 || !a.in_productie ? 'besteld' : 'in_productie') : 'ok';
  return {
    ...a,
    weergave: weergaveNaam(a),
    categorie: a.categorie_id ? paden.get(a.categorie_id) ?? null : null,
    voorraad,
    besteld: rond(a.besteld),
    in_productie: rond(a.in_productie),
    waarde: a.waarde != null ? rond(a.waarde) : null,
    gem_prijs: gemPrijs,
    kost_per_kg: a.type === 'filament' && gemPrijs != null && a.rolgewicht_g ? rond(gemPrijs / a.rolgewicht_g * 1000) : null,
    partijen: a.partijen || 0,
    status,
  };
}

// opties: { archief: '0' | '1' | 'alle', type, id }
export function leesArtikelen(db, { archief = '0', type = null, id = null } = {}) {
  const waar = [];
  const par = [];
  if (id != null) { waar.push('a.id = ?'); par.push(id); }
  else if (archief === '1') waar.push('a.gearchiveerd = 1');
  else if (archief !== 'alle') waar.push('a.gearchiveerd = 0');
  if (type) { waar.push('a.type = ?'); par.push(type); }
  const rijen = db.prepare(`${SELECT} ${waar.length ? 'WHERE ' + waar.join(' AND ') : ''}`).all(...par);
  const paden = categoriePaden(db);
  return rijen.map(r => verrijk(r, paden))
    .sort((x, y) => x.weergave.localeCompare(y.weergave, 'nl', { sensitivity: 'base' }));
}

export function leesArtikel(db, id) {
  const a = leesArtikelen(db, { id })[0];
  if (!a) return null;
  a.leveranciers = db.prepare(`SELECT al.*, l.naam AS leverancier FROM artikel_leveranciers al
    JOIN leveranciers l ON l.id = al.leverancier_id WHERE al.artikel_id = ? ORDER BY al.voorkeur DESC, al.id`).all(id);
  // Zolang er geen bewegingen of aankopen zijn, mag het type nog veranderen.
  a.in_gebruik = db.prepare(`SELECT (SELECT COUNT(*) FROM voorraad_mutaties WHERE artikel_id = ?)
    + (SELECT COUNT(*) FROM aankoop_regels WHERE artikel_id = ?) n`).get(id, id).n > 0;
  a.mutaties = db.prepare('SELECT COUNT(*) n FROM voorraad_mutaties WHERE artikel_id = ?').get(id).n;
  return a;
}

// ── Invoer uit het formulier valideren ───────────────────────────────────
// Regels (bevestigd 24-09):
// - filament: prijsgroep + kleur, altijd "wordt gekocht", eenheid rollen,
//   prijzen komen uit de prijsgroep (dus hier leeg)
// - artikel: naam; gekocht en/of zelf geprint
// - dienst: naam; gekocht en/of verkocht; geen voorraad (geen min/max)
// - verkocht → verkoopprijs verplicht (behalve filament)
// - velden die bij de vinkjes niet horen, worden gewist, zodat een oude
//   waarde nooit onzichtbaar blijft hangen (zelfde afspraak als UX #28)
function tekst(w) {
  return w === undefined || w === null || String(w).trim() === '' ? null : String(w).trim();
}
function geheel(w) {
  if (w === undefined || w === null || w === '') return null;
  const n = Number(w);
  return Number.isInteger(n) ? n : NaN;
}
function getal(w, label, { verplicht = false } = {}) {
  const n = optioneelGetal(w);
  if (n === null) { if (verplicht) throw new DomeinFout(`${label} is verplicht`); return null; }
  if (Number.isNaN(n) || n < 0) throw new DomeinFout(`${label} moet een getal ≥ 0 zijn`);
  return n;
}

export function leesArtikelInvoer(body) {
  const type = body?.type;
  if (!TYPES.includes(type)) throw new DomeinFout('Type moet filament, artikel of dienst zijn');
  const a = {
    type,
    wordt_gekocht: body.wordt_gekocht ? 1 : 0,
    wordt_verkocht: body.wordt_verkocht ? 1 : 0,
    zelf_geprint: body.zelf_geprint ? 1 : 0,
    categorie_id: geheel(body.categorie_id),
    naam: tekst(body.naam),
    filament_type_id: null,
    kleur_id: null,
    eenheid: tekst(body.eenheid) || 'stuks',
    verkoopprijs: null, inkoopprijs: null, marge_pct: null, productieprijs: null,
    vaste_prijs: body.vaste_prijs ? 1 : 0,
    min_voorraad: null, max_voorraad: null,
    locatie: tekst(body.locatie),
    notities: tekst(body.notities),
  };
  if (Number.isNaN(a.categorie_id)) throw new DomeinFout('Ongeldige categorie');

  if (type === 'filament') {
    a.filament_type_id = geheel(body.filament_type_id);
    a.kleur_id = geheel(body.kleur_id);
    if (!a.filament_type_id) throw new DomeinFout('Kies een prijsgroep (merk + type)');
    if (!a.kleur_id) throw new DomeinFout('Kies een kleur');
    a.naam = null; a.eenheid = 'rollen';
    a.wordt_gekocht = 1; a.wordt_verkocht = 0; a.zelf_geprint = 0; a.vaste_prijs = 0;
  } else {
    if (!a.naam) throw new DomeinFout('Naam is verplicht');
    if (type === 'artikel' && !a.wordt_gekocht && !a.zelf_geprint) throw new DomeinFout('Een artikel wordt gekocht of zelf geprint (of allebei)');
    if (type === 'dienst') {
      a.zelf_geprint = 0;
      if (!a.wordt_gekocht && !a.wordt_verkocht) throw new DomeinFout('Een dienst wordt gekocht of verkocht (of allebei)');
    }
    if (a.wordt_verkocht) a.verkoopprijs = getal(body.verkoopprijs, 'Verkoopprijs', { verplicht: true });
    if (a.wordt_gekocht) {
      a.inkoopprijs = getal(body.inkoopprijs, 'Inkoopprijs');
      a.marge_pct = a.wordt_verkocht ? getal(body.marge_pct, 'Marge') : null;
    }
    if (a.zelf_geprint) a.productieprijs = getal(body.productieprijs, 'Productieprijs');
    if (!a.wordt_verkocht) a.vaste_prijs = 0;
  }
  if (type !== 'dienst') {
    a.min_voorraad = getal(body.min_voorraad, 'Minimum');
    a.max_voorraad = getal(body.max_voorraad, 'Maximum');
    if (a.min_voorraad != null && a.max_voorraad != null && a.max_voorraad < a.min_voorraad) {
      throw new DomeinFout('Het maximum mag niet kleiner zijn dan het minimum');
    }
  }
  return a;
}

// Leveranciersregels uit het formulier (tabblad "Inkoop").
export function leesLeveranciersInvoer(lijst) {
  if (lijst === undefined) return undefined;
  if (!Array.isArray(lijst)) throw new DomeinFout('Leveranciers moeten een lijst zijn');
  let voorkeurGezien = false;
  return lijst.map((r, i) => {
    const leverancier_id = geheel(r?.leverancier_id);
    if (!leverancier_id) throw new DomeinFout(`Leveranciersregel ${i + 1}: kies een leverancier`);
    const lev = {
      leverancier_id,
      productcode: tekst(r.productcode),
      omschrijving: tekst(r.omschrijving),
      laatste_prijs: getal(r.laatste_prijs, `Leveranciersregel ${i + 1}: prijs`),
      levertijd_dagen: geheel(r.levertijd_dagen),
      voorkeur: r.voorkeur && !voorkeurGezien ? 1 : 0,
    };
    if (Number.isNaN(lev.levertijd_dagen) || lev.levertijd_dagen < 0) throw new DomeinFout(`Leveranciersregel ${i + 1}: levertijd moet een geheel aantal dagen zijn`);
    if (lev.voorkeur) voorkeurGezien = true;
    return lev;
  });
}

// Artikel aanmaken uit gevalideerde invoer (leesArtikelInvoer). Eén plaats,
// gebruikt door het artikelformulier en door de factuurherkenning (3c).
export const KOLOMMEN = ['type', 'wordt_gekocht', 'wordt_verkocht', 'zelf_geprint', 'categorie_id', 'naam', 'filament_type_id',
  'kleur_id', 'eenheid', 'verkoopprijs', 'inkoopprijs', 'marge_pct', 'productieprijs', 'vaste_prijs',
  'min_voorraad', 'max_voorraad', 'locatie', 'notities'];
export function maakArtikel(db, a, tekst = null) {
  const id = db.prepare(`INSERT INTO artikelen (${KOLOMMEN.join(',')}) VALUES (${KOLOMMEN.map(() => '?').join(',')})`)
    .run(...KOLOMMEN.map(k => a[k])).lastInsertRowid;
  logGebeurtenis(db, 'artikel', id, 'aangemaakt', tekst);
  return Number(id);
}
