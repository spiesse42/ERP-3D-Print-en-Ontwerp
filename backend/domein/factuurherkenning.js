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
// 25-09: ook een BESTELBON (bestelbevestiging van een webshop): aankoop
//    "besteld" met het bestelnummer, prijzen volgen met de factuur. Een
//    factuur met hetzelfde bestelnummer wordt aan die aankoop GEKOPPELD:
//    prijzen per regel (ook van wat al ontvangen is), factuurnummer, bijlage.
// 2. bevestig(): alles in één transactie — leverancier, nieuwe artikelen,
//    aankoop (bron OCR), bijlage, productcodes onthouden, en (standaard)
//    meteen ontvangen in voorraad.

import { DomeinFout, optioneelGetal, rond } from './hulp.js';
import { leesArtikelInvoer, maakArtikel, weergaveNaam } from './artikelen.js';
import { maakAankoop, bestel, ontvang, leesAankoop, werkPrijzenBij } from './aankopen.js';
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

// ── Aanvullen uit de omschrijving (25-09) ────────────────────────────────
// Gemini laat bij lange lijsten van gelijkaardige regels (bestelmail Joybuy)
// soms merk/type/kleur leeg. Dan halen we ze uit de omschrijving zelf:
// - type (materiaal) en merk: een naam uit de catalogus die in de tekst staat
//   ("PLA-Basic" → PLA, "JOYBUYxANYCUBIC" → AnyCubic), langste eerst
// - kleur: het stuk na de laatste " - " zonder gewicht ("Zwart 1 kg" → Zwart),
//   vergeleken zonder spaties ("Textuur grijs" = "Textuurgrijs"); anders een
//   kleur uit de catalogus die als los woord in de tekst staat
// - wat dan nog ontbreekt: van een vorige regel met hetzelfde product
const woorden = s => ` ${String(s ?? '').toLowerCase().replace(/[-_/,()]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
const compact = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9+]/g, '');
const zonderGewicht = s => String(s ?? '').replace(/\b\d+([.,]\d+)?\s*(kg|g|gr|mm)\b/gi, ' ').replace(/\s+/g, ' ').trim();
const langsteEerst = rijen => [...rijen].sort((a, b) => b.naam.length - a.naam.length);
const productDeel = oms => { const s = String(oms ?? ''); const i = Math.max(s.lastIndexOf(' - '), s.lastIndexOf(' – ')); return i > 0 ? s.slice(0, i) : null; };
const kleurDeel = oms => { const s = String(oms ?? ''); const i = Math.max(s.lastIndexOf(' - '), s.lastIndexOf(' – ')); return i > 0 ? zonderGewicht(s.slice(i + 3)) : null; };

// zelfde naam, ook met andere spaties/streepjes ("Textuur grijs" = "Textuurgrijs", "BambuLab" = "Bambu Lab")
function zoekCompact(db, tabel, naam) {
  const exact = zoekOpNaam(db, tabel, naam);
  if (exact || !tekst(naam)) return exact;
  const c = compact(naam);
  return c ? db.prepare(`SELECT id, naam FROM ${tabel}`).all().find(x => compact(x.naam) === c) ?? null : null;
}

export function vulAanUitOmschrijving(db, regels) {
  const cat = {
    merken: langsteEerst(db.prepare('SELECT naam FROM filament_merken').all()),
    materialen: langsteEerst(db.prepare('SELECT naam FROM filament_materialen').all()),
    kleuren: langsteEerst(db.prepare('SELECT naam FROM filament_kleuren').all()),
  };
  const gezien = [];   // kleuren die Gemini op dit document al gaf (bv. "Textuurgrijs")
  const uit = regels.map(r0 => {
    const r = { ...r0 };
    const oms = r.omschrijving || '';
    const w = woorden(oms);
    const alsWoord = naam => w.includes(woorden(naam));
    // "artikel" dat duidelijk een filamentrol is
    if (r.soort === 'artikel' && /filament/i.test(oms) && cat.materialen.some(m => alsWoord(m.naam))) r.soort = 'filament';
    if (r.soort !== 'filament') return r;
    const aangevuld = [];
    if (!tekst(r.materiaal)) {
      const m = cat.materialen.find(x => alsWoord(x.naam));
      if (m) { r.materiaal = m.naam; aangevuld.push('type'); }
    }
    if (!tekst(r.merk)) {
      const c = compact(oms);
      const m = cat.merken.find(x => compact(x.naam).length >= 3 && c.includes(compact(x.naam)));
      if (m) { r.merk = m.naam; aangevuld.push('merk'); }
    }
    if (!tekst(r.kleur)) {
      const deel = kleurDeel(oms);
      const k = deel && (cat.kleuren.find(x => compact(x.naam) === compact(deel)) || gezien.find(x => compact(x.naam) === compact(deel)));
      const losWoord = !deel ? cat.kleuren.find(x => alsWoord(x.naam)) : null;
      const naam = k?.naam || losWoord?.naam || (deel && deel.length <= 30 ? deel.charAt(0).toUpperCase() + deel.slice(1) : null);
      if (naam) { r.kleur = naam; aangevuld.push('kleur'); }
    }
    if (tekst(r.kleur)) gezien.push({ naam: tekst(r.kleur) });
    if (aangevuld.length) r._aangevuld = aangevuld;
    return r;
  });
  // doorgeven van een vorige regel met hetzelfde product (alles vóór " - kleur")
  uit.forEach((r, i) => {
    if (r.soort !== 'filament' || (tekst(r.merk) && tekst(r.materiaal))) return;
    const p = compact(productDeel(r.omschrijving));
    if (!p) return;
    const bron = uit.slice(0, i).reverse().find(x => x.soort === 'filament' && compact(productDeel(x.omschrijving)) === p && tekst(x.merk) && tekst(x.materiaal));
    if (!bron) return;
    const aangevuld = new Set(r._aangevuld || []);
    if (!tekst(r.merk)) { r.merk = bron.merk; aangevuld.add('merk'); }
    if (!tekst(r.materiaal)) { r.materiaal = bron.materiaal; aangevuld.add('type'); }
    r._aangevuld = [...aangevuld];
  });
  return uit;
}

export function koppel(db, g) {
  const lev = zoekLeverancier(db, g?.leverancier);
  const regels = vulAanUitOmschrijving(db, Array.isArray(g?.regels) ? g.regels : []).map((r, i) => {
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
      const merk = zoekCompact(db, 'filament_merken', r.merk);
      const mat = zoekCompact(db, 'filament_materialen', r.materiaal);
      const kleur = zoekCompact(db, 'filament_kleuren', r.kleur);
      const pg = merk && mat ? db.prepare('SELECT id, verkoopprijs_per_kg FROM filament_types WHERE merk_id = ? AND materiaal_id = ?').get(merk.id, mat.id) : null;
      const art = pg && kleur ? db.prepare(`SELECT id FROM artikelen WHERE type = 'filament' AND filament_type_id = ? AND kleur_id = ?`).get(pg.id, kleur.id) : null;
      const aangevuld = r._aangevuld?.length ? { aangevuld: r._aangevuld } : {};
      if (art) return { ...basis, ...aangevuld, status: 'voorstel', soort: 'artikel', artikel_id: art.id, artikel: artikelInfo(db, art.id) };
      return {
        ...basis, ...aangevuld, status: 'nieuw', soort: 'nieuw_filament',
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
  const bestelnummer = tekst(g?.bestelnummer);
  const documentsoort = ['factuur', 'bonnetje', 'bestelbon'].includes(g?.documentsoort) ? g.documentsoort
    : !factuurnummer && bestelnummer ? 'bestelbon' : 'factuur';
  const bestelling = zoekBestelling(db, lev, bestelnummer);
  // factuur bij een bestelling: regels koppelen aan de regels van die aankoop
  if (bestelling && documentsoort !== 'bestelbon') {
    const vrij = [...bestelling.regels];
    for (const r of regels) {
      const i = vrij.findIndex(a => (r.artikel_id && a.artikel_id === r.artikel_id) || (r.soort === 'kost' && a.soort === 'kost' && norm(a.omschrijving) === norm(r.omschrijving)));
      if (i >= 0) { r.aankoop_regel_id = vrij[i].id; vrij.splice(i, 1); }
    }
  }
  // factuur van een bestelling met een andere naam (bv. "Jingdong Retail" i.p.v. "Joybuy"): leverancier van de bestelling
  const levVoorstel = lev ? { id: lev.id, naam: lev.naam }
    : bestelling?.leverancier_id && documentsoort !== 'bestelbon' ? { id: bestelling.leverancier_id, naam: bestelling.leverancier }
    : { id: null, naam: tekst(g?.leverancier?.naam), btw_nummer: tekst(g?.leverancier?.btw_nummer), website: tekst(g?.leverancier?.website) };
  const dubbel = levVoorstel.id && factuurnummer
    ? db.prepare('SELECT id, nummer FROM aankopen WHERE leverancier_id = ? AND extern_factuurnummer = ? COLLATE NOCASE').get(levVoorstel.id, factuurnummer) ?? null
    : null;
  return {
    leverancier: levVoorstel,
    factuurnummer,
    datum: /^\d{4}-\d{2}-\d{2}$/.test(g?.datum || '') ? g.datum : null,
    totaal_factuur: totaal,
    som_regels: som,
    klopt: totaal === null ? null : Math.abs(totaal - som) <= 0.02,
    dubbel: documentsoort === 'bestelbon' ? (bestelling ? { id: bestelling.id, nummer: bestelling.nummer } : null) : dubbel,
    documentsoort, bestelnummer,
    // factuur bij een openstaande bestelling (nog zonder factuurnummer)
    bestelling: documentsoort !== 'bestelbon' && bestelling && !bestelling.extern_factuurnummer ? bestelling : null,
    regels,
  };
}

const bestelNorm = s => String(s ?? '').replace(/[\s#-]/g, '').toLowerCase();
// Aankoop met hetzelfde bestelnummer (en, als gekend, dezelfde leverancier).
function zoekBestelling(db, lev, bestelnummer) {
  const b = bestelNorm(bestelnummer);
  if (!b) return null;
  const hit = db.prepare(`SELECT id, extern_bestelnummer, leverancier_id FROM aankopen WHERE extern_bestelnummer IS NOT NULL AND geannuleerd_op IS NULL ORDER BY id DESC`).all()
    .find(a => bestelNorm(a.extern_bestelnummer) === b && (!lev || !a.leverancier_id || a.leverancier_id === lev.id));
  if (!hit) return null;
  const a = leesAankoop(db, hit.id);
  return { id: a.id, nummer: a.nummer, datum: a.datum, status: a.status, leverancier: a.leverancier, leverancier_id: a.leverancier_id, extern_bestelnummer: a.extern_bestelnummer,
    extern_factuurnummer: a.extern_factuurnummer,
    regels: a.regels.map(r => ({ id: r.id, soort: r.soort, artikel_id: r.artikel_id, weergave: r.weergave, omschrijving: r.omschrijving, aantal: r.aantal, ontvangen: r.ontvangen, prijs_per_eenheid: r.prijs_per_eenheid })) };
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
  const bestaand = zoekCompact(db, tabel, n);
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
  const bestelbon = invoer.documentsoort === 'bestelbon';
  const factuurnummer = bestelbon ? null : tekst(invoer.factuurnummer);
  const bestelnummer = tekst(invoer.bestelnummer);
  if (bestelbon && bestelnummer && !invoer.toch_dubbel) {
    const d = db.prepare('SELECT nummer, extern_bestelnummer FROM aankopen WHERE leverancier_id = ? AND extern_bestelnummer IS NOT NULL').all(levId)
      .find(a => bestelNorm(a.extern_bestelnummer) === bestelNorm(bestelnummer));
    if (d) throw new DomeinFout(`Bestelling ${bestelnummer} van deze leverancier werd al ingelezen (${d.nummer})`);
  }
  if (factuurnummer && !invoer.toch_dubbel) {
    const d = db.prepare('SELECT nummer FROM aankopen WHERE leverancier_id = ? AND extern_factuurnummer = ? COLLATE NOCASE').get(levId, factuurnummer);
    if (d) throw new DomeinFout(`Factuur ${factuurnummer} van deze leverancier werd al ingelezen (${d.nummer})`);
  }
  const datum = tekst(invoer.datum);
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new DomeinFout('Datum moet de vorm JJJJ-MM-DD hebben');
  const lijst = Array.isArray(invoer.regels) ? invoer.regels : [];
  if (!lijst.length) throw new DomeinFout('Er zijn geen regels om in te lezen');

  // factuur koppelen aan een bestaande bestelling (25-09)
  const koppelId = !bestelbon && invoer.aankoop_id ? Number(invoer.aankoop_id) : null;
  const regels = lijst.map((r, i) => {
    const aantal = getal(r.aantal, `Regel ${i + 1}: aantal`, { verplicht: true, positief: true });
    const prijs = getal(r.prijs_per_eenheid, `Regel ${i + 1}: prijs`);
    if (r.soort === 'kost') {
      const oms = tekst(r.omschrijving);
      if (!oms) throw new DomeinFout(`Regel ${i + 1}: vul een omschrijving in`);
      return { artikel_id: null, plaatshouder_materiaal_id: null, plaatshouder_kleur_id: null, omschrijving: oms, aantal, prijs_per_eenheid: prijs,
        aankoop_regel_id: koppelId && r.aankoop_regel_id ? Number(r.aankoop_regel_id) : null };
    }
    const artikelId = artikelVoorRegel(db, { ...r, prijs_per_eenheid: prijs }, i);
    onthoud(db, artikelId, levId, tekst(r.productcode), tekst(r.omschrijving));
    return { artikel_id: artikelId, plaatshouder_materiaal_id: null, plaatshouder_kleur_id: null, omschrijving: tekst(r.omschrijving), aantal, prijs_per_eenheid: prijs,
      aankoop_regel_id: koppelId && r.aankoop_regel_id ? Number(r.aankoop_regel_id) : null };
  });

  if (koppelId) return koppelFactuur(db, koppelId, { levId, factuurnummer, bestelnummer, regels, invoer, datum, bron });

  const ak = maakAankoop(db, { leverancier_id: levId, datum, extern_factuurnummer: factuurnummer, extern_bestelnummer: bestelnummer, notities: null },
    regels.map(({ aankoop_regel_id: _a, ...r }) => r), bron);
  if (bestelbon) {
    bestel(db, ak.id);
    if (datum) db.prepare('UPDATE aankopen SET besteld_op = ? WHERE id = ?').run(datum, ak.id);   // besteldatum van de webshop
    return ak;
  }
  if (invoer.meteen_ontvangen) {
    const open = leesAankoop(db, ak.id).regels.filter(r => r.openstaand > 0);
    if (open.length) ontvang(db, ak.id, open.map(r => ({ regel_id: r.id, aantal: r.openstaand })), { datum, locatie: tekst(invoer.locatie) });
    else bestel(db, ak.id);
  } else bestel(db, ak.id);
  return ak;
}

// Factuur koppelen aan een bestelling (25-09):
// - gekoppelde regels: prijs (en aantal) van de factuur; wat al ontvangen is,
//   krijgt die prijs ook in voorraad (productiekost klopt dan)
// - regels die enkel op de factuur staan (bv. verzending): toegevoegd
// - factuurnummer, leverancier, bestelnummer aangevuld; eventueel meteen ontvangen
function koppelFactuur(db, aankoopId, { levId, factuurnummer, bestelnummer, regels, invoer, datum }) {
  const a = leesAankoop(db, aankoopId);
  if (!a) throw new DomeinFout('Aankoop niet gevonden');
  if (a.status === 'geannuleerd') throw new DomeinFout(`Aankoop ${a.nummer} is geannuleerd`);
  if (a.extern_factuurnummer && a.extern_factuurnummer.toLowerCase() !== (factuurnummer || '').toLowerCase()) {
    throw new DomeinFout(`Aankoop ${a.nummer} heeft al een factuur (${a.extern_factuurnummer})`);
  }
  if (a.leverancier_id && a.leverancier_id !== levId) throw new DomeinFout(`Aankoop ${a.nummer} is van een andere leverancier (${a.leverancier})`);
  const perId = new Map(a.regels.map(r => [r.id, r]));
  const gebruikt = new Set();
  const updPrijs = db.prepare('UPDATE aankoop_regels SET prijs_per_eenheid = ?, aantal = ? WHERE id = ?');
  const updPartij = db.prepare('UPDATE voorraad_partijen SET prijs_per_eenheid = ? WHERE aankoop_regel_id = ?');
  const ins = db.prepare(`INSERT INTO aankoop_regels (aankoop_id, volgorde, artikel_id, plaatshouder_materiaal_id, plaatshouder_kleur_id, omschrijving, aantal, prijs_per_eenheid)
    VALUES (?,?,?,?,?,?,?,?)`);
  let bijgewerkt = 0, toegevoegd = 0, volgorde = a.regels.length;
  for (const [i, r] of regels.entries()) {
    if (r.aankoop_regel_id) {
      const o = perId.get(r.aankoop_regel_id);
      if (!o) throw new DomeinFout(`Regel ${i + 1} hoort niet bij aankoop ${a.nummer}`);
      if (gebruikt.has(o.id)) throw new DomeinFout(`Regel ${i + 1}: ${o.weergave} is al aan een andere factuurregel gekoppeld`);
      gebruikt.add(o.id);
      if (r.aantal < o.ontvangen - 1e-9) throw new DomeinFout(`Regel ${i + 1}: er is al ${String(o.ontvangen).replace('.', ',')} ontvangen van ${o.weergave}; het aantal kan niet lager`);
      updPrijs.run(r.prijs_per_eenheid, r.aantal, o.id);
      if (o.ontvangen > 0 && r.prijs_per_eenheid != null) {
        updPartij.run(r.prijs_per_eenheid, o.id);
        if (o.artikel_id) werkPrijzenBij(db, o.artikel_id, levId, r.prijs_per_eenheid);
      }
      bijgewerkt += 1;
    } else {
      ins.run(aankoopId, volgorde++, r.artikel_id, null, null, r.omschrijving, r.aantal, r.prijs_per_eenheid);
      toegevoegd += 1;
    }
  }
  db.prepare(`UPDATE aankopen SET extern_factuurnummer = COALESCE(?, extern_factuurnummer), extern_bestelnummer = COALESCE(extern_bestelnummer, ?),
    leverancier_id = COALESCE(leverancier_id, ?) WHERE id = ?`).run(factuurnummer, bestelnummer, levId, aankoopId);
  const nietOpFactuur = a.regels.filter(r => !gebruikt.has(r.id)).map(r => r.weergave);
  logGebeurtenis(db, 'aankoop', aankoopId, 'gewijzigd', `Factuur ${factuurnummer || ''} gekoppeld: ${bijgewerkt} regel${bijgewerkt === 1 ? '' : 's'} bijgewerkt (prijs${a.regels.some(r => r.ontvangen > 0) ? ', ook in voorraad' : ''})`
    + `${toegevoegd ? `, ${toegevoegd} toegevoegd` : ''}${nietOpFactuur.length ? `; niet op de factuur: ${nietOpFactuur.join(', ')}` : ''}`);
  if (invoer.meteen_ontvangen) {
    const open = leesAankoop(db, aankoopId).regels.filter(r => r.openstaand > 0);
    if (open.length) ontvang(db, aankoopId, open.map(r => ({ regel_id: r.id, aantal: r.openstaand })), { datum, locatie: tekst(invoer.locatie) });
  } else if (!a.besteld_op) bestel(db, aankoopId);
  return { id: a.id, nummer: a.nummer, gekoppeld: true, bijgewerkt, toegevoegd, niet_op_factuur: nietOpFactuur };
}
