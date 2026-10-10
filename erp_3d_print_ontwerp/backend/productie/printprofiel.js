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

// invoer → genormaliseerd profiel (of null = wissen)
export function leesProfiel(db, b) {
  if (b === null) return null;
  const p = {
    printer_id: heel(b?.printer_id, 'Printer'),
    tijd_min: nietNeg(b?.tijd_min, 'Printtijd per stuk') ?? 0,
    per_plaat: heel(b?.per_plaat, 'Stuks per plaat'),
    voorbereiding_min: nietNeg(b?.voorbereiding_min, 'Voorbereiding per plaat'),
    nabewerking_min: nietNeg(b?.nabewerking_min, 'Nabewerking per stuk'),
    // 09-10: het slicerbestand (bijlage bij het artikel) waaruit het profiel komt
    slicer_bijlage_id: heel(b?.slicer_bijlage_id, 'Slicerbestand'),
    slicer_plaat: heel(b?.slicer_plaat, 'Plaat'),
    materialen: (Array.isArray(b?.materialen) ? b.materialen : []).map((m, i) => {
      const a = heel(m?.artikel_id, 'Filament'), f = heel(m?.filament_type_id, 'Prijsgroep');
      if (!a === !f) throw new DomeinFout(`Kleur ${i + 1}: kies een filament of een prijsgroep`);
      if (a && !db.prepare(`SELECT 1 FROM artikelen WHERE id = ? AND type = 'filament'`).get(a)) throw new DomeinFout(`Kleur ${i + 1}: onbekend filament`);
      if (f && !db.prepare('SELECT 1 FROM filament_types WHERE id = ?').get(f)) throw new DomeinFout(`Kleur ${i + 1}: onbekende prijsgroep`);
      return a ? { artikel_id: a, gram: nietNeg(m.gram, `Kleur ${i + 1}: gram per stuk`) ?? 0 } : { filament_type_id: f, gram: nietNeg(m.gram, `Kleur ${i + 1}: gram per stuk`) ?? 0 };
    }),
  };
  if (p.printer_id && !db.prepare('SELECT 1 FROM printers WHERE id = ?').get(p.printer_id)) throw new DomeinFout('Onbekende printer');
  if (p.slicer_bijlage_id && !db.prepare(`SELECT 1 FROM bijlagen WHERE id = ? AND entiteit = 'artikel'`).get(p.slicer_bijlage_id)) p.slicer_bijlage_id = null;
  if (!p.slicer_bijlage_id) { delete p.slicer_bijlage_id; delete p.slicer_plaat; }
  if (!p.tijd_min && !p.materialen.some(m => m.gram > 0)) throw new DomeinFout('Vul minstens de printtijd of het gewicht per stuk in.');
  return p;
}

export function bewaarProfiel(db, artikelId, body) {
  const a = artikelMetProfiel(db, artikelId);
  if (a.type !== 'artikel' || !a.zelf_geprint) throw new DomeinFout('Een printprofiel hoort bij een artikel dat we zelf printen.');
  const p = leesProfiel(db, body);
  db.prepare('UPDATE artikelen SET printprofiel = ? WHERE id = ?').run(p ? JSON.stringify(p) : null, a.id);
  return p;
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

// Alle zelf geprinte artikelen met een profiel (keuzelijst "Uit product").
export function leesProfielen(db) {
  return db.prepare(`SELECT id, naam, verkoopprijs, printprofiel FROM artikelen
    WHERE type = 'artikel' AND zelf_geprint = 1 AND gearchiveerd = 0 AND printprofiel IS NOT NULL ORDER BY naam COLLATE NOCASE`).all()
    .map(({ printprofiel, ...a }) => { try { return { ...a, profiel: JSON.parse(printprofiel) }; } catch { return null; } })
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
  const pp = profiel?.per_plaat > 0 ? profiel.per_plaat : 1;
  let filament = 0, energie = 0, machine = 0, bmcu = 0, arbeid = 0;
  if (profiel) {
    for (const m of profiel.materialen || []) {
      if (!m.gram) continue;
      const kg = kostPerKg(db, m);
      if (kg == null) ontbreekt.push('inkoopprijs filament'); else filament += m.gram / 1000 * kg;
    }
    const uren = (profiel.tijd_min || 0) / 60;
    const p = profiel.printer_id ? db.prepare('SELECT naam, machine_per_uur, verbruik_watt FROM printers WHERE id = ?').get(profiel.printer_id) : null;
    if (!p) ontbreekt.push('printer in het printprofiel');
    else {
      if (p.verbruik_watt == null || t.kwh_prijs == null) ontbreekt.push('verbruik (watt) of kWh-prijs'); else energie = p.verbruik_watt / 1000 * uren * t.kwh_prijs;
      if (p.machine_per_uur == null) ontbreekt.push(`machinetarief ${p.naam}`); else machine = uren * p.machine_per_uur;
    }
    bmcu = (t.bmcu_per_job ?? 0) / pp;
    const voorb = profiel.voorbereiding_min ?? t.voorbereiding_min ?? 0;
    const nabew = profiel.nabewerking_min ?? 0;
    arbeid = (voorb / pp + nabew) / 60 * (t.arbeid_per_uur ?? 0);
  } else ontbreekt.push('printprofiel');
  let delen = 0;
  for (const o of onderdelen) {
    if (o.prijs == null) ontbreekt.push(`prijs ${o.naam}`); else delen += o.aantal * o.prijs;
  }
  const rond = v => Math.round(v * 10000) / 10000;
  return { filament: rond(filament), energie: rond(energie), machine: rond(machine), bmcu: rond(bmcu), onderdelen: rond(delen),
    kost: rond(filament + energie + machine + bmcu + delen), arbeid: rond(arbeid), onvolledig: ontbreekt.length > 0, ontbreekt: [...new Set(ontbreekt)] };
}
