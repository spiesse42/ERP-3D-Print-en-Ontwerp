// ═══════════════════════════════════════════════════════════════════════
// PRIJS PER AANTAL (staffel, 21-11) — indicatief, op een offerte
// ═══════════════════════════════════════════════════════════════════════
// Eén printregel opnieuw rekenen voor andere aantallen (bv. 50, 100, 200
// sleutelhangers). Printtijd, filament en voorbereiding/nabewerking volgen
// dezelfde invoerwijze als de RegelEditor:
//   - per plaat (stuks per plaat ingevuld, "per stuk" uit): per plaat × platen
//   - per stuk, of geen van beide: per stuk × aantal
// Voorbereiding schaalt met het aantal platen. Handmatig eindbedrag en korting
// van de regel tellen niet mee (die horen bij het aantal op de regel zelf).
import { DomeinFout } from './hulp.js';
import { leesRegelsVan, berekenDossier } from './dossiers.js';

export const MAX_STAFFELS = 8;
const r4 = x => Math.round(x * 10000) / 10000;

function factoren(r, aantal) {
  const pp = Number(r.per_plaat) > 0 ? Number(r.per_plaat) : 0;
  const platen = pp ? Math.max(1, Math.ceil(aantal / pp - 1e-9)) : 1;
  if (!r.per_stuk && pp) return { t: platen, v: platen, nb: platen };
  return { t: aantal, v: platen, nb: aantal };
}

// De regel (API-vorm, zoals leesRegelsVan) voor een ander aantal.
export function regelVoorAantal(r, aantal) {
  const oud = factoren(r, Number(r.aantal) || 1), nieuw = factoren(r, aantal);
  const maal = (v, a, b) => (v == null || v === '' ? null : r4(Number(v) / a * b));
  return {
    ...r, aantal, handmatig_bedrag: null, korting: null, werkelijk: undefined, plaat_van: null,
    tijd_min: maal(r.tijd_min, oud.t, nieuw.t) ?? 0,
    voorbereiding_min: maal(r.voorbereiding_min, oud.v, nieuw.v),
    nabewerking_min: maal(r.nabewerking_min, oud.nb, nieuw.nb),
    materialen: (r.materialen || []).map(m => ({ ...m, gram: maal(m.gram, oud.t, nieuw.t) ?? 0 })),
  };
}

export function leesAantallen(waarde) {
  const lijst = (Array.isArray(waarde) ? waarde : String(waarde ?? '').split(/[\s,;]+/)).map(x => String(x).trim()).filter(Boolean);
  const getallen = lijst.map(Number);
  if (getallen.some(n => !Number.isInteger(n) || n < 1 || n > 100000)) throw new DomeinFout('Vul de aantallen in als hele getallen (bv. 50, 100, 200).');
  const uniek = [...new Set(getallen)].sort((a, b) => a - b);
  if (uniek.length > MAX_STAFFELS) throw new DomeinFout(`Maximum ${MAX_STAFFELS} aantallen.`);
  return uniek;
}

// → { regel_id, omschrijving, rijen: [{ aantal, per_stuk, totaal, platen }] }
// per_stuk naar boven afgerond op de cent; totaal = per_stuk × aantal (zo
// kan de klant het zelf narekenen).
export function berekenStaffel(db, d, regelId, aantallen) {
  const regels = leesRegelsVan(db, d.id);
  const r = regels.find(x => x.id === Number(regelId));
  if (!r || r.type !== 'printen') throw new DomeinFout('Kies een printregel van dit dossier voor de prijs per aantal.');
  const rijen = leesAantallen(aantallen).map(aantal => {
    const b = berekenDossier(db, [regelVoorAantal(r, aantal)], 'schatting', null, d.filament_inkoop, d.soort, d.klant_id);
    const rb = b.regels?.[0]?._berekend;
    if (!b.volledig || rb?.eindbedrag == null) throw new DomeinFout(`De regel "${r.omschrijving || 'Printwerk'}" kan niet berekend worden: ${b.fout || rb?.fout || 'vul eerst printer, tijd en filament in'}.`);
    const per_stuk = Math.ceil(r4(rb.eindbedrag / aantal) * 100) / 100;
    return { aantal, per_stuk, totaal: Math.round(per_stuk * aantal * 100) / 100, platen: rb.detail?.platen ?? null };
  });
  return { regel_id: r.id, omschrijving: r.omschrijving || 'Printwerk', rijen };
}
