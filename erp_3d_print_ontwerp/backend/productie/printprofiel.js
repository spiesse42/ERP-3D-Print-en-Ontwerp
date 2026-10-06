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
    materialen: (Array.isArray(b?.materialen) ? b.materialen : []).map((m, i) => {
      const a = heel(m?.artikel_id, 'Filament'), f = heel(m?.filament_type_id, 'Prijsgroep');
      if (!a === !f) throw new DomeinFout(`Kleur ${i + 1}: kies een filament of een prijsgroep`);
      if (a && !db.prepare(`SELECT 1 FROM artikelen WHERE id = ? AND type = 'filament'`).get(a)) throw new DomeinFout(`Kleur ${i + 1}: onbekend filament`);
      if (f && !db.prepare('SELECT 1 FROM filament_types WHERE id = ?').get(f)) throw new DomeinFout(`Kleur ${i + 1}: onbekende prijsgroep`);
      return a ? { artikel_id: a, gram: nietNeg(m.gram, `Kleur ${i + 1}: gram per stuk`) ?? 0 } : { filament_type_id: f, gram: nietNeg(m.gram, `Kleur ${i + 1}: gram per stuk`) ?? 0 };
    }),
  };
  if (p.printer_id && !db.prepare('SELECT 1 FROM printers WHERE id = ?').get(p.printer_id)) throw new DomeinFout('Onbekende printer');
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
