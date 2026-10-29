// ═══════════════════════════════════════════════════════════════════════
// PRINTPROFIEL van een vast product (06-10)
// ═══════════════════════════════════════════════════════════════════════
// Voor een zelf geprint artikel (webshop, voorraad): printtijd en gram PER
// STUK, hoeveel stuks er op één plaat passen, de printer, voorbereiding per
// plaat en nabewerking per stuk. Daarmee wordt een printregel "× aantal"
// (dossier, Bijprinten) zonder telkens te rekenen. Bewaard als JSON op
// artikelen.printprofiel; de ids worden bij het bewaren gecontroleerd.
import { DomeinFout } from '../domein/hulp.js';
import { getal } from '../domein/rekenmotor.js';
import { getTarieven } from '../domein/hulp.js';
import { kostPerKg } from './kost.js';

function nietNeg(v, wat) {
  if (v === null || v === undefined || v === '') return null;
  const n = getal(v);
  if (n === null || n < 0) throw new DomeinFout(`${wat}: geef een getal (0 of meer)`);
  return n;
}
function heel(v, wat) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new DomeinFout(`${wat}: geef een heel getal groter dan 0`);
  return n;
}

export function artikelMetProfiel(db, artikelId) {
  const a = db.prepare(`SELECT id, naam, type, zelf_geprint, printprofiel FROM artikelen WHERE id = ?`).get(Number(artikelId));
  if (!a) throw Object.assign(new DomeinFout('Artikel niet gevonden'), { status: 404 });
  let profiel = null;
  try { profiel = a.printprofiel ? JSON.parse(a.printprofiel) : null; } catch { profiel = null; }
  return { ...a, profiel };
}

// 21-10: een artikel kan uit MEERDERE platen bestaan (bv. 4 platen die samen
// één stuk vormen). Bewaard: één plaat = de vlakke vorm van vroeger; meer =
// { platen: [...], slicer_bijlage_id }. Altijd lezen via platenVan().
export const platenVan = p => (!p ? [] : Array.isArray(p.platen) && p.platen.length ? p.platen : [p]);

// 29-10: LETTERPROFIEL (bv. bubble letters): elke plaat is één letter of
// teken (A, B, É, &…) — een stuk is ÉÉN letter, niet alle platen samen.
// { letters: true, platen: [{ letter, naam, tijd_min, materialen… }] }.
// Voor de kost per stuk en "Uit product" geldt de gemiddelde letter; een
// letterbestelling neemt per letter de eigen plaat (letterPlaat).
export const isLetterProfiel = p => !!(p && p.letters && Array.isArray(p.platen) && p.platen.length);
export const normLetter = l => String(l ?? '').trim().toLocaleUpperCase('nl-BE');
export function letterPlaat(p, letter) {
  if (!isLetterProfiel(p)) return null;
  const l = normLetter(letter);
  return p.platen.find(x => normLetter(x.letter) === l) || null;
}
const r4 = v => Math.round(v * 10000) / 10000;
function gemiddeldePlaat(p) {
  const n = p.platen.length, eerste = p.platen[0];
  const mat = new Map();
  for (const x of p.platen) {
    for (const m of x.materialen || []) {
      const k = m.artikel_id ? `a${m.artikel_id}` : `p${m.filament_type_id}`;
      const v = mat.get(k) || { ...(m.artikel_id ? { artikel_id: m.artikel_id } : { filament_type_id: m.filament_type_id }), gram: 0 };
      v.gram += Number(m.gram) || 0;
      mat.set(k, v);
    }
  }
  return { printer_id: eerste.printer_id ?? null, tijd_min: r4(p.platen.reduce((t, x) => t + (Number(x.tijd_min) || 0), 0) / n), per_plaat: 1,
    voorbereiding_min: eerste.voorbereiding_min ?? null, nabewerking_min: eerste.nabewerking_min ?? null,
    materialen: [...mat.values()].map(m => ({ ...m, gram: r4(m.gram / n) })) };
}
// De platen van ÉÉN stuk: bij een letterprofiel de gemiddelde letter.
export const stukPlaten = p => (isLetterProfiel(p) ? [gemiddeldePlaat(p)] : platenVan(p));

function leesPlaat(db, b, wat) {
  const p = {
    ...(String(b?.naam ?? '').trim() ? { naam: String(b.naam).trim().slice(0, 80) } : {}),
    ...(normLetter(b?.letter) ? { letter: normLetter(b.letter).slice(0, 4) } : {}),
    printer_id: heel(b?.printer_id, `${wat}Printer`),
    tijd_min: nietNeg(b?.tijd_min, `${wat}Printtijd per stuk`) ?? 0,
    per_plaat: heel(b?.per_plaat, `${wat}Stuks per plaat`),
    voorbereiding_min: nietNeg(b?.voorbereiding_min, `${wat}Voorbereiding per plaat`),
    nabewerking_min: nietNeg(b?.nabewerking_min, `${wat}Nabewerking per stuk`),
    slicer_plaat: heel(b?.slicer_plaat, `${wat}Plaat`),
    materialen: (Array.isArray(b?.materialen) ? b.materialen : []).map((m, i) => {
      const a = heel(m?.artikel_id, 'Filament'), f = heel(m?.filament_type_id, 'Prijsgroep');
      if (!a === !f) throw new DomeinFout(`${wat}Kleur ${i + 1}: kies een filament of een prijsgroep`);
      if (a && !db.prepare(`SELECT 1 FROM artikelen WHERE id = ? AND type = 'filament'`).get(a)) throw new DomeinFout(`${wat}Kleur ${i + 1}: onbekend filament`);
      if (f && !db.prepare('SELECT 1 FROM filament_types WHERE id = ?').get(f)) throw new DomeinFout(`${wat}Kleur ${i + 1}: onbekende prijsgroep`);
      return a ? { artikel_id: a, gram: nietNeg(m.gram, `${wat}Kleur ${i + 1}: gram per stuk`) ?? 0 } : { filament_type_id: f, gram: nietNeg(m.gram, `${wat}Kleur ${i + 1}: gram per stuk`) ?? 0 };
    }),
  };
  if (p.printer_id && !db.prepare('SELECT 1 FROM printers WHERE id = ?').get(p.printer_id)) throw new DomeinFout(`${wat}Onbekende printer`);
  if (!p.tijd_min && !p.materialen.some(m => m.gram > 0)) throw new DomeinFout(`${wat}Vul minstens de printtijd of het gewicht per stuk in.`);
  return p;
}

// invoer → genormaliseerd profiel (of null = wissen)
export function leesProfiel(db, b) {
  if (b === null) return null;
  const invoer = Array.isArray(b?.platen) && b.platen.length ? b.platen : [b];
  const letters = !!b?.letters;
  const platen = invoer.map((x, i) => leesPlaat(db, x, letters ? `Letter ${normLetter(x?.letter) || i + 1}: ` : invoer.length > 1 ? `Plaat ${i + 1}: ` : ''));
  if (letters) {
    const gezien = new Set();
    platen.forEach((x, i) => {
      if (!x.letter) throw new DomeinFout(`Plaat ${i + 1}${x.naam ? ` (${x.naam})` : ''}: vul de letter of het teken in`);
      if (gezien.has(x.letter)) throw new DomeinFout(`De letter ${x.letter} staat er twee keer in`);
      gezien.add(x.letter);
    });
  } else platen.forEach(x => delete x.letter);
  // 09-10: het slicerbestand (bijlage bij het artikel) waaruit het profiel komt
  let bijlage = heel(b?.slicer_bijlage_id, 'Slicerbestand');
  if (bijlage && !db.prepare(`SELECT 1 FROM bijlagen WHERE id = ? AND entiteit = 'artikel'`).get(bijlage)) bijlage = null;
  if (!bijlage) platen.forEach(x => delete x.slicer_plaat);
  if (letters) return { letters: true, platen, ...(bijlage ? { slicer_bijlage_id: bijlage } : {}) };
  if (platen.length === 1) {
    const { naam: _n, ...p } = platen[0];
    if (bijlage) p.slicer_bijlage_id = bijlage; else delete p.slicer_plaat;
    return p;
  }
  return { platen, ...(bijlage ? { slicer_bijlage_id: bijlage } : {}) };
}

export function bewaarProfiel(db, artikelId, body) {
  const a = artikelMetProfiel(db, artikelId);
  if (a.type !== 'artikel' || !a.zelf_geprint) throw new DomeinFout('Een printprofiel hoort bij een artikel dat we zelf printen.');
  const p = leesProfiel(db, body);
  db.prepare('UPDATE artikelen SET printprofiel = ? WHERE id = ?').run(p ? JSON.stringify(p) : null, a.id);
  return p;
}

// 24-10: een printregel (opslagvorm: totalen, zoals een dossierregel) →
// printprofiel PER STUK van het product. Zonder "per stuk" is de regel één
// plaat met `aantal` stuks erop. `slicer_bijlage_id` = de bijlage bij het
// artikel (al gekopieerd door de oproeper).
export function profielUitRegel(r, { slicer_bijlage_id = null } = {}) {
  const n = Number(String(r?.aantal ?? 1).replace(',', '.')) || 1;
  const pp = Number(r?.per_plaat) > 0 ? Number(r.per_plaat) : r?.per_stuk ? null : Math.round(n);
  const platen = platenVoor(n, pp);
  const deel = (v, d) => (v == null || v === '' ? null : Math.round(Number(String(v).replace(',', '.')) / d * 10000) / 10000);
  return {
    printer_id: r?.printer_id ?? null, tijd_min: deel(r?.tijd_min, n) ?? 0, per_plaat: pp && pp >= 1 ? pp : null,
    voorbereiding_min: deel(r?.voorbereiding_min, platen), nabewerking_min: deel(r?.nabewerking_min, n),
    materialen: (r?.materialen || []).map(m => ({ ...(m.artikel_id ? { artikel_id: m.artikel_id } : { filament_type_id: m.filament_type_id }), gram: deel(m.gram, n) ?? 0 })),
    ...(slicer_bijlage_id ? { slicer_bijlage_id, slicer_plaat: r?.slicer_plaat ?? null } : {}),
  };
}

export const platenVoor = (aantal, perPlaat) => (perPlaat > 0 ? Math.max(1, Math.ceil(aantal / perPlaat - 1e-9)) : 1);
const r2 = v => Math.round(v * 100) / 100;

// Printregel (opslagvorm: totalen) voor `aantal` stuks volgens het profiel.
export function regelUitProfiel(p, aantal) {
  const platen = platenVoor(aantal, p.per_plaat);
  return {
    tijd_min: r2((p.tijd_min || 0) * aantal),
    voorbereiding_min: p.voorbereiding_min == null ? null : r2(p.voorbereiding_min * platen),
    nabewerking_min: p.nabewerking_min == null ? null : r2(p.nabewerking_min * aantal),
    per_stuk: 1, per_plaat: p.per_plaat ?? null,
    materialen: (p.materialen || []).map(m => ({ artikel_id: m.artikel_id ?? null, filament_type_id: m.filament_type_id ?? null, gram: r2((m.gram || 0) * aantal) })),
  };
}

// Eén printregel per plaat (21-10). `printer_id` per plaat (anders `printer`),
// `omschrijving` met "plaat i/n" bij meerdere platen.
export function regelsUitProfiel(p, aantal, naam = '') {
  const lijst = stukPlaten(p);
  return lijst.map((x, i) => ({ ...regelUitProfiel(x, aantal), printer_id: x.printer_id ?? null,
    omschrijving: lijst.length > 1 ? `${naam} — plaat ${i + 1}/${lijst.length}${x.naam ? ` (${x.naam})` : ''}` : naam,
    laatste: i === lijst.length - 1 }));
}
// Gewicht van één stuk (alle platen samen), of null.
export function gewichtVan(p) {
  const g = stukPlaten(p).reduce((t, x) => t + (x.materialen || []).reduce((u, m) => u + (Number(m.gram) || 0), 0), 0);
  return g > 0 ? Math.round(g * 10) / 10 : null;
}

// Alle zelf geprinte artikelen met een profiel (keuzelijst "Uit product").
export function leesProfielen(db) {
  return db.prepare(`SELECT id, naam, verkoopprijs, printprofiel FROM artikelen
    WHERE type = 'artikel' AND zelf_geprint = 1 AND gearchiveerd = 0 AND printprofiel IS NOT NULL ORDER BY naam COLLATE NOCASE`).all()
    .map(({ printprofiel, ...a }) => {
      try {
        const p = JSON.parse(printprofiel);
        // 29-10: letterprofiel → "Uit product" rekent met de gemiddelde letter
        return isLetterProfiel(p) ? { ...a, profiel: stukPlaten(p)[0], letters: p.platen.map(x => x.letter) } : { ...a, profiel: p };
      } catch { return null; }
    })
    .filter(Boolean);
}

// ── kost per stuk VOORAF geschat uit het profiel (06-10) ─────────────────
// Zelfde opbouw als de gemeten productiekost (productie/kost.js), maar met
// de printtijd van het profiel i.p.v. gemeten runs: filament aan inkoopprijs,
// elektriciteit (watt × tijd), machinetarief, BMCU per plaat. Arbeid apart:
// voorbereiding per plaat + nabewerking per stuk. Plus de onderdelen.
export function schatKost(db, profiel, onderdelen = []) {
  const t = getTarieven(db);
  const ontbreekt = [];
  let filament = 0, energie = 0, machine = 0, bmcu = 0, arbeid = 0;
  if (profiel) {
    // 21-10: per plaat, opgeteld (een stuk kan uit meerdere platen bestaan)
    for (const x of stukPlaten(profiel)) {
      const pp = x.per_plaat > 0 ? x.per_plaat : 1;
      for (const m of x.materialen || []) {
        if (!m.gram) continue;
        const kg = kostPerKg(db, m);
        if (kg == null) ontbreekt.push('inkoopprijs filament'); else filament += m.gram / 1000 * kg;
      }
      const uren = (x.tijd_min || 0) / 60;
      const p = x.printer_id ? db.prepare('SELECT naam, machine_per_uur, verbruik_watt, slijtage_per_print FROM printers WHERE id = ?').get(x.printer_id) : null;
      if (!p) ontbreekt.push('printer in het printprofiel');
      else {
        if (p.verbruik_watt == null || t.kwh_prijs == null) ontbreekt.push('verbruik (watt) of kWh-prijs'); else energie += p.verbruik_watt / 1000 * uren * t.kwh_prijs;
        if (p.machine_per_uur == null) ontbreekt.push(`machinetarief ${p.naam}`); else machine += uren * p.machine_per_uur;
      }
      bmcu += (p?.slijtage_per_print ?? t.bmcu_per_job ?? 0) / pp;
      const voorb = x.voorbereiding_min ?? t.voorbereiding_min ?? 0;
      const nabew = x.nabewerking_min ?? 0;
      arbeid += (voorb / pp + nabew) / 60 * (t.arbeid_per_uur ?? 0);
    }
  } else ontbreekt.push('printprofiel');
  let delen = 0;
  for (const o of onderdelen) {
    if (o.prijs == null) ontbreekt.push(`prijs ${o.naam}`); else delen += o.aantal * o.prijs;
  }
  const rond = v => Math.round(v * 10000) / 10000;
  return { filament: rond(filament), energie: rond(energie), machine: rond(machine), bmcu: rond(bmcu), onderdelen: rond(delen),
    kost: rond(filament + energie + machine + bmcu + delen), arbeid: rond(arbeid), onvolledig: ontbreekt.length > 0, ontbreekt: [...new Set(ontbreekt)] };
}
