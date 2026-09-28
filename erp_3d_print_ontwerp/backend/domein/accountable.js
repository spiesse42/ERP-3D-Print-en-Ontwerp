// ═══════════════════════════════════════════════════════════════════════
// ACCOUNTABLE-EXPORT INLEZEN (stap 7) — betaald-status terugkoppelen
// ═══════════════════════════════════════════════════════════════════════
// Domeinmodel: "de Excel-export van Accountable kan in het ERP ingelezen
// worden om facturen/bonnetjes aan dossiers te koppelen en de betaald-status
// bij te werken". De juiste kolomnamen van die export kennen we (nog) niet:
// daarom stelt het ERP de kolommen VOOR op basis van de kopteksten en kies
// jij ze zelf in het scherm. Niets wordt gewijzigd zonder jouw bevestiging.
// - koppelen op het nummer (factuur- of bonnetjesnummer = het nummer dat je
//   bij het afrekenen invulde), hoofdletters/spaties/leestekens genegeerd
// - betaald: via een kolom betaaldatum, een status-/betaald-kolom of een
//   kolom "openstaand bedrag" (0 = betaald)
import ExcelJS from 'exceljs';
import { DomeinFout, VIA_VERKOOP } from './hulp.js';
import { logGebeurtenis } from './historiek.js';

export const VELDEN = {
  nummer: 'Nummer (factuur/bonnetje)', datum: 'Datum', bedrag: 'Bedrag (totaal)', klant: 'Klant',
  betaaldatum: 'Betaaldatum', betaald: 'Status / betaald', openstaand: 'Openstaand bedrag',
};
const PATRONEN = {
  nummer: /^(factuur|document|bonnetje|ontvangst)?\s*(nummer|nr\.?|number|no\.?)$|factuurnummer|^nummer|invoice ?(number|no)/i,
  betaaldatum: /betaal\s*datum|datum\s*betaling|betaald op|paid (on|date)|payment date/i,
  datum: /^(factuur)?datum$|^date$|invoice date|documentdatum|uitgiftedatum/i,
  bedrag: /totaal|bedrag|amount|incl/i,
  openstaand: /openstaand|te ontvangen|outstanding|due amount|saldo/i,
  betaald: /^betaald$|status|paid/i,
  klant: /klant|client|customer|naam|contact/i,
};

const cel = v => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.result !== undefined) return cel(v.result);
    if (v.text !== undefined) return String(v.text);
    if (Array.isArray(v.richText)) return v.richText.map(x => x.text).join('');
    return null;
  }
  return v;
};

function csvRijen(tekst) {
  const regels = tekst.replace(/^﻿/, '').split(/\r?\n/).filter(r => r.trim() !== '');
  const sep = (regels[0].match(/;/g) || []).length >= (regels[0].match(/,/g) || []).length ? ';' : ',';
  return regels.map(r => {
    const uit = []; let cur = ''; let q = false;
    for (let i = 0; i < r.length; i++) {
      const c = r[i];
      if (q) { if (c === '"' && r[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === sep) { uit.push(cur); cur = ''; } else cur += c;
    }
    uit.push(cur);
    return uit.map(x => (x.trim() === '' ? null : x.trim()));
  });
}

// → [{ naam, koppen, rijen }]; de koprij = de eerste rij met minstens 2 teksten
export async function leesBestand(buffer, bestandsnaam) {
  let bladen = [];
  if (/\.csv$/i.test(bestandsnaam)) {
    bladen = [{ naam: 'CSV', ruw: csvRijen(buffer.toString('utf8')) }];
  } else {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch { throw new DomeinFout('Het bestand kon niet gelezen worden. Gebruik de Excel-export (.xlsx) of een CSV.'); }
    bladen = wb.worksheets.map(ws => {
      const ruw = [];
      ws.eachRow({ includeEmpty: false }, rij => { const v = rij.values.slice(1).map(cel); ruw.push(v); });
      return { naam: ws.name, ruw };
    });
  }
  return bladen.map(b => {
    const k = b.ruw.findIndex(r => r.filter(x => typeof x === 'string' && x.trim()).length >= 2);
    if (k < 0) return { naam: b.naam, koppen: [], rijen: [] };
    const koppen = b.ruw[k].map((x, i) => (x == null ? `Kolom ${i + 1}` : String(x).trim()));
    const rijen = b.ruw.slice(k + 1).filter(r => r.some(x => x != null && String(x).trim() !== ''))
      .map(r => koppen.map((_, i) => (r[i] == null ? null : r[i])));
    return { naam: b.naam, koppen, rijen };
  }).filter(b => b.koppen.length);
}

export function stelKolommenVoor(koppen) {
  const gekozen = {};
  const bezet = new Set();
  for (const veld of ['betaaldatum', 'openstaand', 'nummer', 'datum', 'bedrag', 'betaald', 'klant']) {
    const i = koppen.findIndex((k, j) => !bezet.has(j) && PATRONEN[veld].test(k));
    if (i >= 0) { gekozen[veld] = i; bezet.add(i); }
  }
  return gekozen;
}

const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// zonder het woord ervoor: "Bonnetje 2026-020" en "2026-020" → "2026020" (26-09:
// het ERP nummert bonnetjes als "Bonnetje 2026-020"). Enkel gebruikt als het
// ondubbelzinnig is: een bonnetje en een factuur kunnen hetzelfde "2026-020" hebben.
const kaal = s => norm(String(s ?? '').replace(/^\s*(bonnetje|factuur)\b/i, ''));
export function datumVan(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);   // Excel-serienummer
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
export function bedragVan(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let t = String(v).replace(/[€\s]/g, '').replace(/EUR/i, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
const JA = /^(ja|yes|true|1|betaald|paid|voldaan|x)$/i;

// Elke rij → { nummer, datum, bedrag, klant, betaald, betaald_op }
export function interpreteer(blad, kolommen) {
  if (kolommen.nummer == null) throw new DomeinFout('Kies de kolom met het nummer');
  const w = (r, veld) => (kolommen[veld] == null ? null : r[kolommen[veld]]);
  return blad.rijen.map((r, i) => {
    const nummer = w(r, 'nummer') == null ? null : String(w(r, 'nummer')).trim();
    const datum = datumVan(w(r, 'datum'));
    const bd = datumVan(w(r, 'betaaldatum'));
    let betaald = null;
    if (kolommen.betaaldatum != null) betaald = !!bd;
    else if (kolommen.openstaand != null) { const o = bedragVan(w(r, 'openstaand')); betaald = o == null ? null : Math.abs(o) < 0.01; }
    else if (kolommen.betaald != null) { const s = String(w(r, 'betaald') ?? '').trim(); betaald = s === '' ? null : JA.test(s); }
    return { rij: i + 1, nummer, datum, bedrag: bedragVan(w(r, 'bedrag')), klant: w(r, 'klant') == null ? null : String(w(r, 'klant')), betaald, betaald_op: bd };
  }).filter(x => x.nummer);
}

// Vergelijken met de afgerekende dossiers.
// status: betalen (in de export betaald, in het ERP nog niet) / in_orde /
// open (nog niet betaald) / niet_gevonden (geen dossier met dat nummer)
export function vergelijk(db, rijen) {
  const dossiers = db.prepare(`SELECT id, nummer, titel, afgerekend_soort, afgerekend_nummer, afgerekend_op, afgerekend_bedrag, betaald_op
    FROM dossiers WHERE afgerekend_nummer IS NOT NULL AND NOT ${VIA_VERKOOP('dossiers')}`).all();   // via een verkoop: zit in die verkoop
  // losse verkopen (26-09): bonnetjes, dus altijd al betaald → enkel "in orde"
  for (const v of db.prepare(`SELECT id, nummer, omschrijving, datum, totaal FROM verkopen WHERE geannuleerd_op IS NULL`).all()) {
    dossiers.push({ id: `v${v.id}`, verkoop_id: v.id, nummer: null, titel: v.omschrijving || 'Losse verkoop', afgerekend_soort: 'bonnetje',
      afgerekend_nummer: v.nummer, afgerekend_op: v.datum, afgerekend_bedrag: v.totaal, betaald_op: v.datum });
  }
  const opNummer = new Map(dossiers.map(d => [norm(d.afgerekend_nummer), d]));
  const opKaal = new Map();
  for (const d of dossiers) opKaal.set(kaal(d.afgerekend_nummer), [...(opKaal.get(kaal(d.afgerekend_nummer)) || []), d]);
  const zoek = nr => opNummer.get(norm(nr)) || (opKaal.get(kaal(nr))?.length === 1 ? opKaal.get(kaal(nr))[0] : null);
  const gezien = new Set();
  const uit = rijen.map(r => {
    const d = zoek(r.nummer);
    if (!d) return { ...r, status: 'niet_gevonden', dossier: null };
    gezien.add(d.id);
    const verschil = r.bedrag != null && d.afgerekend_bedrag != null && Math.abs(Math.abs(r.bedrag) - d.afgerekend_bedrag) > 0.01;
    if (d.verkoop_id) return { ...r, status: 'in_orde', bedrag_verschilt: verschil, dossier: null, verkoop: { id: d.verkoop_id, nummer: d.afgerekend_nummer, titel: d.titel, afgerekend_bedrag: d.afgerekend_bedrag } };
    const status = r.betaald && !d.betaald_op ? 'betalen' : r.betaald === false && !d.betaald_op ? 'open' : 'in_orde';
    return { ...r, status, bedrag_verschilt: verschil, dossier: { id: d.id, nummer: d.nummer, titel: d.titel, afgerekend_bedrag: d.afgerekend_bedrag, betaald_op: d.betaald_op } };
  });
  // afgerekend in het ERP maar niet in de export (binnen de periode van de export)
  const datums = rijen.map(r => r.datum).filter(Boolean).sort();
  const ontbreekt = datums.length ? dossiers.filter(d => !gezien.has(d.id) && d.afgerekend_op >= datums[0] && d.afgerekend_op <= datums.at(-1)) : [];
  return { rijen: uit, ontbreekt_in_export: ontbreekt, periode: datums.length ? { van: datums[0], tot: datums.at(-1) } : null,
    telling: Object.fromEntries(['betalen', 'open', 'in_orde', 'niet_gevonden'].map(s => [s, uit.filter(x => x.status === s).length])) };
}

// Betaald zetten voor de gekozen dossiers (enkel regels met status betalen).
export function pasToe(db, vergeleken, dossierIds, bestandsnaam) {
  const kies = new Set(dossierIds.map(Number));
  const vandaag = new Date().toISOString().slice(0, 10);
  const upd = db.prepare('UPDATE dossiers SET betaald_op = ? WHERE id = ? AND betaald_op IS NULL AND afgerekend_op IS NOT NULL');
  let n = 0;
  for (const r of vergeleken.rijen) {
    if (r.status !== 'betalen' || !kies.has(r.dossier.id)) continue;
    const datum = r.betaald_op || vandaag;
    if (upd.run(datum, r.dossier.id).changes) {
      n++;
      logGebeurtenis(db, 'dossier', r.dossier.id, 'status', `Betaald op ${datum.split('-').reverse().join('-')} (uit de Accountable-export ${bestandsnaam})`);
    }
  }
  return n;
}
