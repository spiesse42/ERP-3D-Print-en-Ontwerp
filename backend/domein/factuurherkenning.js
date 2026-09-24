// ═══════════════════════════════════════════════════════════════════════
// FACTUURHERKENNING — wat Gemini las koppelen aan wat het ERP kent (stap 3c)
// ═══════════════════════════════════════════════════════════════════════
// 1. koppel(): uitgelezen factuur → voorstel voor het nakijkscherm
//    - leverancier: op btw-nummer, anders op naam
//    - per regel, in volgorde van zekerheid:
//        a. leverancier + productcode   (onthouden in artikel_leveranciers) → "herkend"
//        b. leverancier + omschrijving  (idem)                              → "herkend"
//        c. filament: merk + type + kleur bestaat als artikel               → "voorstel"
//        d. artikel met dezelfde naam                                      → "voorstel"
//        e. anders een nieuw artikel/filament met het voorstel van Gemini  → "nieuw"
//        kost (verzending, …)                                              → "kost"
// 2. bevestig(): alles in één transactie — leverancier, nieuwe artikelen,
//    aankoop (bron OCR), bijlage, productcodes onthouden, en (standaard)
//    meteen ontvangen in voorraad.

import { DomeinFout, optioneelGetal, rond } from './hulp.js';
import { leesArtikelInvoer, maakArtikel, weergaveNaam } from './artikelen.js';
import { maakAankoop, bestel, ontvang, leesAankoop } from './aankopen.js';
import { logGebeurtenis } from './historiek.js';

const norm = s => String(s ?? '').trim().toLowerCase();
const btwNorm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const tekst = w => (w === undefined || w === null || String(w).trim() === '' ? null : String(w).trim());

export function catalogusVoorInstructie(db) {
  const namen = t => db.prepare(`SELECT naam FROM ${t} ORDER BY naam COLLATE NOCASE`).all().map(r => r.naam);
  return {
    merken: namen('filament_merken'), materialen: namen('filament_materialen'), kleuren: namen('filament_kleuren'),
    categorieen: db.prepare('SELECT naam FROM categorieen WHERE ouder_id IS NULL ORDER BY naam').all().map(r => r.naam),
  };
}

function zoekLeverancier(db, l) {
  if (!l) return null;
  const btw = btwNorm(l.btw_nummer);
  if (btw) {
    const alle = db.prepare('SELECT id, naam, btw_nummer FROM leveranciers WHERE btw_nummer IS NOT NULL').all();
    const hit = alle.find(x => btwNorm(x.btw_nummer) === btw);
    if (hit) return hit;
  }
  const naam = norm(l.naam);
  if (!naam) return null;
  const alle = db.prepare('SELECT id, naam, btw_nummer FROM leveranciers').all();
  return alle.find(x => norm(x.naam) === naam)
    || alle.find(x => norm(x.naam).length >= 3 && (naam.includes(norm(x.naam)) || norm(x.naam).includes(naam)))
    || null;
}

const zoekOpNaam = (db, tabel, naam) => (tekst(naam) ? db.prepare(`SELECT id, naam FROM ${tabel} WHERE naam = ? COLLATE NOCASE`).get(tekst(naam)) ?? null : null);

function artikelInfo(db, id) {
  const a = db.prepare(`SELECT a.id, a.type, a.naam, a.eenheid, m.naam merk, mat.naam materiaal, k.naam kleur, k.hex kleur_hex FROM artikelen a
    LEFT JOIN filament_types ft ON ft.id = a.filament_type_id LEFT JOIN filament_merken m ON m.id = ft.merk_id
    LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id LEFT JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.id = ?`).get(id);
  return a ? { ...a, weergave: weergaveNaam(a) } : null;
}

export function koppel(db, g) {
  const lev = zoekLeverancier(db, g?.leverancier);
  const regels = (Array.isArray(g?.regels) ? g.regels : []).map((r, i) => {
    const aantal = Number(r.aantal) > 0 ? rond(Number(r.aantal)) : 1;
    const prijs = Number.isFinite(Number(r.prijs_per_eenheid)) && r.prijs_per_eenheid !== null ? rond(Number(r.prijs_per_eenheid))
      : Number.isFinite(Number(r.regeltotaal)) && r.regeltotaal !== null ? rond(Number(r.regeltotaal) / aantal) : null;
    const basis = { nr: i + 1, omschrijving: tekst(r.omschrijving) || '', productcode: tekst(r.productcode), aantal, prijs_per_eenheid: prijs };
    if (r.soort === 'kost') return { ...basis, status: 'kost', soort: 'kost' };

    // a/b: wat het ERP onthouden heeft bij deze leverancier
    if (lev) {
      const viaCode = basis.productcode && db.prepare('SELECT artikel_id FROM artikel_leveranciers WHERE leverancier_id = ? AND productcode = ? COLLATE NOCASE').get(lev.id, basis.productcode);
      const viaOms = !viaCode && basis.omschrijving && db.prepare('SELECT artikel_id FROM artikel_leveranciers WHERE leverancier_id = ? AND omschrijving = ? COLLATE NOCASE').get(lev.id, basis.omschrijving);
      const hit = viaCode || viaOms;
      if (hit) return { ...basis, status: 'herkend', soort: 'artikel', artikel_id: hit.artikel_id, artikel: artikelInfo(db, hit.artikel_id), via: viaCode ? 'productcode' : 'omschrijving' };
    }
    if (r.soort === 'filament') {
      const merk = zoekOpNaam(db, 'filament_merken', r.merk);
      const mat = zoekOpNaam(db, 'filament_materialen', r.materiaal);
      const kleur = zoekOpNaam(db, 'filament_kleuren', r.kleur);
      const pg = merk && mat ? db.prepare('SELECT id, verkoopprijs_per_kg FROM filament_types WHERE merk_id = ? AND materiaal_id = ?').get(merk.id, mat.id) : null;
      const art = pg && kleur ? db.prepare(`SELECT id FROM artikelen WHERE type = 'filament' AND filament_type_id = ? AND kleur_id = ?`).get(pg.id, kleur.id) : null;
      if (art) return { ...basis, status: 'voorstel', soort: 'artikel', artikel_id: art.id, artikel: artikelInfo(db, art.id) };
      return {
        ...basis, status: 'nieuw', soort: 'nieuw_filament',
        filament: {
          merk_id: merk?.id ?? null, merk_naam: merk?.naam ?? tekst(r.merk),
          materiaal_id: mat?.id ?? null, materiaal_naam: mat?.naam ?? tekst(r.materiaal),
          kleur_id: kleur?.id ?? null, kleur_naam: kleur?.naam ?? tekst(r.kleur), kleur_hex: /^#[0-9a-f]{6}$/i.test(r.kleur_hex || '') ? r.kleur_hex : '#888888',
          prijsgroep_bestaat: !!pg, verkoopprijs_per_kg: null,
        },
      };
    }
    const naam = tekst(r.naam_voorstel) || basis.omschrijving.slice(0, 80);
    const bestaand = zoekOpNaam(db, 'artikelen', naam);
    if (bestaand) return { ...basis, status: 'voorstel', soort: 'artikel', artikel_id: bestaand.id, artikel: artikelInfo(db, bestaand.id) };
    const cat = tekst(r.categorie_voorstel) ? db.prepare('SELECT id FROM categorieen WHERE naam = ? COLLATE NOCASE ORDER BY ouder_id IS NOT NULL').get(tekst(r.categorie_voorstel)) : null;
    return { ...basis, status: 'nieuw', soort: 'nieuw_artikel', nieuw_artikel: { type: 'artikel', naam, categorie_id: cat?.id ?? null } };
  });

  const som = rond(regels.reduce((s, r) => s + (r.prijs_per_eenheid ?? 0) * r.aantal, 0));
  const totaal = Number.isFinite(Number(g?.totaal_incl_btw)) && g?.totaal_incl_btw !== null ? rond(Number(g.totaal_incl_btw)) : null;
  const factuurnummer = tekst(g?.factuurnummer);
  const dubbel = lev && factuurnummer
    ? db.prepare('SELECT id, nummer FROM aankopen WHERE leverancier_id = ? AND extern_factuurnummer = ? COLLATE NOCASE').get(lev.id, factuurnummer) ?? null
    : null;
  return {
    leverancier: lev ? { id: lev.id, naam: lev.naam } : { id: null, naam: tekst(g?.leverancier?.naam), btw_nummer: tekst(g?.leverancier?.btw_nummer), website: tekst(g?.leverancier?.website) },
    factuurnummer,
    datum: /^\d{4}-\d{2}-\d{2}$/.test(g?.datum || '') ? g.datum : null,
    totaal_factuur: totaal,
    som_regels: som,
    klopt: totaal === null ? null : Math.abs(totaal - som) <= 0.02,
    dubbel,
    regels,
  };
}

// ── Bevestigen ────────────────────────────────────────────────────────────
function getal(w, label, { verplicht = false, positief = false } = {}) {
  const n = optioneelGetal(w);
  if (n === null) { if (verplicht) throw new DomeinFout(`${label} is verplicht`); return null; }
  if (Number.isNaN(n) || n < 0 || (positief && n === 0)) throw new DomeinFout(`${label} moet een getal ${positief ? '> 0' : '≥ 0'} zijn`);
  return rond(n);
}

function zoekOfMaak(db, tabel, id, naam, label, extra = null) {
  if (id) return Number(id);
  const n = tekst(naam);
  if (!n) throw new DomeinFout(`Kies of vul ${label} in`);
  const bestaand = db.prepare(`SELECT id FROM ${tabel} WHERE naam = ? COLLATE NOCASE`).get(n);
  if (bestaand) return bestaand.id;
  if (tabel === 'filament_kleuren') {
    const hex = /^#[0-9a-f]{6}$/i.test(extra || '') ? extra : '#888888';
    return Number(db.prepare('INSERT INTO filament_kleuren (naam, hex) VALUES (?,?)').run(n, hex).lastInsertRowid);
  }
  return Number(db.prepare(`INSERT INTO ${tabel} (naam) VALUES (?)`).run(n).lastInsertRowid);
}

function artikelVoorRegel(db, r, i) {
  const n = `Regel ${i + 1}`;
  if (r.soort === 'artikel') {
    const id = Number(r.artikel_id);
    if (!Number.isInteger(id) || !db.prepare('SELECT 1 FROM artikelen WHERE id = ?').get(id)) throw new DomeinFout(`${n}: kies een artikel`);
    return id;
  }
  if (r.soort === 'nieuw_artikel') {
    const a = r.nieuw_artikel || {};
    const invoer = leesArtikelInvoer({ type: a.type === 'dienst' ? 'dienst' : 'artikel', naam: a.naam, categorie_id: a.categorie_id, wordt_gekocht: true,
      inkoopprijs: r.prijs_per_eenheid });
    const bestaand = db.prepare(`SELECT id FROM artikelen WHERE naam = ? COLLATE NOCASE AND type <> 'filament'`).get(invoer.naam);
    if (bestaand) return bestaand.id;   // twee regels met hetzelfde nieuwe artikel
    return maakArtikel(db, invoer, 'Aangemaakt via factuur inlezen');
  }
  if (r.soort === 'nieuw_filament') {
    const f = r.filament || {};
    const merk = zoekOfMaak(db, 'filament_merken', f.merk_id, f.merk_naam, `bij ${n.toLowerCase()} het merk`);
    const mat = zoekOfMaak(db, 'filament_materialen', f.materiaal_id, f.materiaal_naam, `bij ${n.toLowerCase()} het type`);
    const kleur = zoekOfMaak(db, 'filament_kleuren', f.kleur_id, f.kleur_naam, `bij ${n.toLowerCase()} de kleur`, f.kleur_hex);
    let pg = db.prepare('SELECT id FROM filament_types WHERE merk_id = ? AND materiaal_id = ?').get(merk, mat)?.id;
    if (!pg) {
      const prijs = getal(f.verkoopprijs_per_kg, `${n}: verkoopprijs per kg (nieuwe prijsgroep)`, { verplicht: true });
      pg = Number(db.prepare('INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg) VALUES (?,?,?)').run(merk, mat, prijs).lastInsertRowid);
    }
    const bestaand = db.prepare(`SELECT id FROM artikelen WHERE type = 'filament' AND filament_type_id = ? AND kleur_id = ?`).get(pg, kleur);
    if (bestaand) return bestaand.id;
    const cat = db.prepare(`SELECT id FROM categorieen WHERE ouder_id IS NULL AND naam = 'Filament' COLLATE NOCASE`).get()?.id ?? null;
    return maakArtikel(db, leesArtikelInvoer({ type: 'filament', filament_type_id: pg, kleur_id: kleur, categorie_id: cat }), 'Aangemaakt via factuur inlezen');
  }
  throw new DomeinFout(`${n}: onbekend soort regel`);
}

// Productcode/omschrijving van de leverancier onthouden bij het gekozen artikel.
// Wees een code eerder naar een ander artikel (jij koos nu anders), dan
// verhuist ze naar dit artikel: jouw keuze gaat voor.
function onthoud(db, artikelId, leverancierId, code, oms) {
  if (code) {
    const bestaand = db.prepare('SELECT id, artikel_id FROM artikel_leveranciers WHERE leverancier_id = ? AND productcode = ? COLLATE NOCASE').get(leverancierId, code);
    if (bestaand) {
      if (bestaand.artikel_id !== artikelId) db.prepare('UPDATE artikel_leveranciers SET artikel_id = ?, omschrijving = COALESCE(?, omschrijving) WHERE id = ?').run(artikelId, oms, bestaand.id);
      return;
    }
  }
  const rij = db.prepare('SELECT id, productcode, omschrijving FROM artikel_leveranciers WHERE artikel_id = ? AND leverancier_id = ? ORDER BY voorkeur DESC, id LIMIT 1').get(artikelId, leverancierId);
  if (rij && (!rij.productcode || !code || rij.productcode.toLowerCase() === code.toLowerCase())) {
    db.prepare('UPDATE artikel_leveranciers SET productcode = COALESCE(productcode, ?), omschrijving = COALESCE(omschrijving, ?) WHERE id = ?').run(code, oms, rij.id);
    return;
  }
  const eerste = !db.prepare('SELECT 1 FROM artikel_leveranciers WHERE artikel_id = ?').get(artikelId);
  db.prepare('INSERT INTO artikel_leveranciers (artikel_id, leverancier_id, productcode, omschrijving, voorkeur) VALUES (?,?,?,?,?)').run(artikelId, leverancierId, code, oms, eerste ? 1 : 0);
}

// invoer: { leverancier: {id} | {naam, btw_nummer, website}, factuurnummer, datum, meteen_ontvangen, locatie,
//           toch_dubbel, regels: [{ soort, artikel_id | nieuw_artikel | filament | omschrijving, aantal, prijs_per_eenheid, productcode, omschrijving }] }
// Geeft { id, nummer } van de aankoop terug. De oproeper koppelt de bijlage.
export function bevestig(db, invoer, bron = 'ocr') {
  const l = invoer?.leverancier || {};
  let levId = l.id ? Number(l.id) : null;
  if (levId && !db.prepare('SELECT 1 FROM leveranciers WHERE id = ?').get(levId)) throw new DomeinFout('Onbekende leverancier');
  if (!levId) {
    const naam = tekst(l.naam);
    if (!naam) throw new DomeinFout('Kies of vul een leverancier in');
    const bestaand = db.prepare('SELECT id FROM leveranciers WHERE naam = ? COLLATE NOCASE').get(naam);
    levId = bestaand?.id ?? Number(db.prepare('INSERT INTO leveranciers (naam, btw_nummer, website) VALUES (?,?,?)').run(naam, tekst(l.btw_nummer), tekst(l.website)).lastInsertRowid);
    if (!bestaand) logGebeurtenis(db, 'leverancier', levId, 'aangemaakt', 'Aangemaakt via factuur inlezen');
  }
  const factuurnummer = tekst(invoer.factuurnummer);
  if (factuurnummer && !invoer.toch_dubbel) {
    const d = db.prepare('SELECT nummer FROM aankopen WHERE leverancier_id = ? AND extern_factuurnummer = ? COLLATE NOCASE').get(levId, factuurnummer);
    if (d) throw new DomeinFout(`Factuur ${factuurnummer} van deze leverancier werd al ingelezen (${d.nummer})`);
  }
  const datum = tekst(invoer.datum);
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new DomeinFout('Datum moet de vorm JJJJ-MM-DD hebben');
  const lijst = Array.isArray(invoer.regels) ? invoer.regels : [];
  if (!lijst.length) throw new DomeinFout('Er zijn geen regels om in te lezen');

  const regels = lijst.map((r, i) => {
    const aantal = getal(r.aantal, `Regel ${i + 1}: aantal`, { verplicht: true, positief: true });
    const prijs = getal(r.prijs_per_eenheid, `Regel ${i + 1}: prijs`);
    if (r.soort === 'kost') {
      const oms = tekst(r.omschrijving);
      if (!oms) throw new DomeinFout(`Regel ${i + 1}: vul een omschrijving in`);
      return { artikel_id: null, plaatshouder_materiaal_id: null, plaatshouder_kleur_id: null, omschrijving: oms, aantal, prijs_per_eenheid: prijs };
    }
    const artikelId = artikelVoorRegel(db, { ...r, prijs_per_eenheid: prijs }, i);
    onthoud(db, artikelId, levId, tekst(r.productcode), tekst(r.omschrijving));
    return { artikel_id: artikelId, plaatshouder_materiaal_id: null, plaatshouder_kleur_id: null, omschrijving: tekst(r.omschrijving), aantal, prijs_per_eenheid: prijs };
  });

  const ak = maakAankoop(db, { leverancier_id: levId, datum, extern_factuurnummer: factuurnummer, notities: null }, regels, bron);
  if (invoer.meteen_ontvangen) {
    const open = leesAankoop(db, ak.id).regels.filter(r => r.openstaand > 0);
    if (open.length) ontvang(db, ak.id, open.map(r => ({ regel_id: r.id, aantal: r.openstaand })), { datum, locatie: tekst(invoer.locatie) });
    else bestel(db, ak.id);
  } else bestel(db, ak.id);
  return ak;
}
