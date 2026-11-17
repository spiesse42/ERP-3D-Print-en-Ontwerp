// ═══════════════════════════════════════════════════════════════════════
// DOCUMENTEN VAN EEN DOSSIER (stap 5b): offerte (versies) en werkbon
// ═══════════════════════════════════════════════════════════════════════
// Een concept volgt altijd de huidige dossierregels. Bij versturen (offerte)
// of definitief maken (werkbon, bij het afrekenen) wordt een MOMENTOPNAME
// bewaard: precies wat de klant kreeg, ook als het dossier nadien wijzigt.
import fs from 'fs';
import path from 'path';
import { bijlagenMap } from '../db/index.js';
import { getBedrijfsgegevens, DomeinFout } from './hulp.js';
import { offerteStatus } from './status/offerte.js';
import { volgendNummer } from './nummering.js';
import { logGebeurtenis } from './historiek.js';

export function offertesVan(db, dossierId) {
  const rijen = db.prepare('SELECT * FROM offertes WHERE dossier_id = ? ORDER BY versie').all(dossierId);
  const hoogste = rijen.reduce((m, o) => Math.max(m, o.versie), 0);
  return rijen.map(o => {
    const m = o.momentopname ? JSON.parse(o.momentopname) : null;
    const { momentopname: _m, ...rest } = o;
    return { ...rest, fotos: leesFotoIds(o.fotos), status: offerteStatus(o, { nieuwereVersie: o.versie < hoogste && !o.aanvaard_op && !o.geweigerd_op }),
      weergave: nummerMetVersie(o), regels_api: m?.regels_api, document: m?.document };
  });
}
export const nummerMetVersie = d => (d.versie > 1 ? `${d.nummer} v${d.versie}` : d.nummer);

// Afrekening in teksten (26-09): "bonnetje Bonnetje 2026-020" → "Bonnetje 2026-020"
// (het ERP-nummer draagt het woord al), anders "factuur 2026-002".
export function afrekeningWeergave(soort, nummer) {
  const n = String(nummer ?? '').trim();
  return n.toLowerCase().startsWith(`${soort} `) ? n : `${soort} ${n}`;
}
// Een bonnetje dat het ERP zelf maakte (en dus kan tonen/mailen).
export function isErpBonnetje(d) { return d.afgerekend_soort === 'bonnetje' && !!d.afrekening_pdf_op; }
// Een factuur die het ERP zelf maakte (29-09).
export function isErpFactuur(d) { return d.afgerekend_soort === 'factuur' && !!d.afrekening_pdf_op; }
export const isErpDocument = d => isErpBonnetje(d) || isErpFactuur(d);

// De laatst verstuurde versie bepaalt de fase van het dossier.
export function laatsteVerstuurde(offertes) {
  return [...offertes].filter(o => o.verstuurd_op).sort((a, b) => b.versie - a.versie)[0] || null;
}

// Nieuwe werkbon (knop, Starten, offerte aanvaard of afrekenen zonder werkbon).
export function maakWerkbon(db, dossierId, { waarom = null } = {}) {
  if (db.prepare('SELECT 1 FROM werkbonnen WHERE dossier_id = ?').get(dossierId)) return null;
  const nummer = volgendNummer(db, 'WB');
  db.prepare('INSERT INTO werkbonnen (dossier_id, nummer) VALUES (?, ?)').run(dossierId, nummer);
  logGebeurtenis(db, 'dossier', dossierId, 'status', `Werkbon ${nummer} aangemaakt${waarom ? ` (${waarom})` : ''}`);
  return nummer;
}

export function werkbonVan(db, dossierId) {
  const w = db.prepare('SELECT * FROM werkbonnen WHERE dossier_id = ?').get(dossierId);
  if (!w) return null;
  const { momentopname, ...rest } = w;
  return { ...rest, weergave: nummerMetVersie(w), document: momentopname ? JSON.parse(momentopname).document : null };
}

// Wat er op het document komt: bedrijf, klant, dossier en de regels zoals
// de klant ze ziet (omschrijving, aantal, prijs per stuk, bedrag).
const STANDAARD_LABEL = { printen: 'Printwerk', ontwerp: 'Ontwerp', aanpassing: 'Aanpassing', extra: 'Extra kost', korting: 'Korting' };
// 15-10: "Korting 10 %" als er geen omschrijving is
const kortingLabel = r => (r.type === 'korting' && r.korting?.totaal?.soort === 'pct' ? `Korting ${String(r.korting.totaal.waarde).replace('.', ',')} %` : null);
export function documentInhoud(db, dossier, berekening) {
  const regels = berekening.regels.map(r => {
    const b = r._berekend || {};
    const aantal = r.type === 'printen' || r.type === 'artikel' || (r.type === 'extra' && r.per_stuk) ? Number(r.aantal ?? 1) : 1;
    return {
      omschrijving: r.omschrijving || (r.type === 'artikel' ? r.naam : null) || kortingLabel(r) || STANDAARD_LABEL[r.type] || r.type,
      aantal, per_stuk: b.per_stuk ?? null, bedrag: b.eindbedrag ?? null,
      // printwerk: ter info op de werkbon (werkelijke of geschatte printtijd)
      uren: r.type === 'printen' ? Math.round((b.tijd_u ?? 0) * 100) / 100 : null,
      // kleine afbeelding van de print (28-09), op offerte en werkbon
      afbeelding: r.type === 'printen' ? r.afbeelding || null : null,
      // 17-11: soort regel, om de printregels op de offerte samen te voegen
      soort: r.type,
    };
  });
  return {
    bedrijf: getBedrijfsgegevens(db),
    klant: dossier.klant_gegevens || null,
    dossier: { nummer: dossier.nummer, titel: dossier.titel },
    regels,
    totaal: berekening.totaal, btw_grondslag: berekening.btw_grondslag, vast: berekening.vast,
  };
}

// 31-10: de klant ziet het werk als één regel (bv. "Bureeldecoratie") in plaats van
// alle printregels. Het totaal blijft exact gelijk; de werkbon zelf verandert niet.
export function eenRegelInhoud(inhoud, omschrijving) {
  const o = String(omschrijving ?? '').trim();
  if (!o) throw new DomeinFout('Vul een omschrijving in voor de ene regel op het document.');
  if (o.length > 200) throw new DomeinFout('De omschrijving voor de ene regel is te lang (maximum 200 tekens).');
  const bedrag = Math.round(Number(inhoud.totaal) * 100) / 100;
  return { ...inhoud, regels: [{ omschrijving: o, aantal: 1, per_stuk: bedrag, bedrag, uren: null, afbeelding: null }] };
}

// 17-11: offerte met alle printregels als één regel (bv. een beeld in 3 delen).
// Ontwerp, afwerking, artikels, kortingen… blijven apart; de ene regel komt op
// de plaats van de eerste printregel. Het totaal blijft exact gelijk.
export function printregelsInhoud(inhoud, omschrijving) {
  const o = String(omschrijving ?? '').trim();
  const print = inhoud.regels.filter(r => r.soort === 'printen');
  if (!o || print.length === 0) return inhoud;
  const bedrag = print.some(r => r.bedrag == null) ? null : Math.round(print.reduce((t, r) => t + Number(r.bedrag), 0) * 100) / 100;
  const een = { omschrijving: o, aantal: 1, per_stuk: bedrag, bedrag, uren: null, afbeelding: null, soort: 'printen' };
  const regels = [];
  for (const r of inhoud.regels) {
    if (r.soort !== 'printen') regels.push(r);
    else if (r === print[0]) regels.push(een);
  }
  return { ...inhoud, regels };
}

// 17-11: foto's voor de pagina "Beelden" van een offerte: enkel foto-bijlagen
// (png, jpg, webp) van dit dossier, als data-URI voor de PDF. Een intussen
// verwijderde foto wordt gewoon overgeslagen.
export const FOTO_TYPES = /^image\/(png|jpe?g|webp)$/;
export const MAX_FOTOS = 12;
export function leesFotoIds(waarde) {
  try { const a = JSON.parse(waarde || '[]'); return Array.isArray(a) ? a.filter(Number.isInteger) : []; } catch { return []; }
}
export function controleerFotos(db, dossierId, ids) {
  if (ids == null) return [];
  if (!Array.isArray(ids)) throw new DomeinFout("Ongeldige lijst foto's");
  const uniek = [...new Set(ids.map(Number))];
  if (uniek.length > MAX_FOTOS) throw new DomeinFout(`Maximum ${MAX_FOTOS} foto's op een offerte.`);
  for (const id of uniek) {
    const b = Number.isInteger(id) ? db.prepare(`SELECT mimetype FROM bijlagen WHERE id = ? AND entiteit = 'dossier' AND entiteit_id = ?`).get(id, dossierId) : null;
    if (!b) throw new DomeinFout('Een gekozen foto hoort niet bij dit dossier.');
    if (!FOTO_TYPES.test(b.mimetype || '')) throw new DomeinFout('Enkel foto\'s in jpg, png of webp kunnen op de offerte.');
  }
  return uniek;
}
export function offerteFotos(db, dossierId, waarde) {
  const uit = [];
  for (const id of leesFotoIds(waarde)) {
    const b = db.prepare(`SELECT pad, mimetype FROM bijlagen WHERE id = ? AND entiteit = 'dossier' AND entiteit_id = ?`).get(id, dossierId);
    if (!b || !FOTO_TYPES.test(b.mimetype || '')) continue;
    try { uit.push(`data:${b.mimetype};base64,${fs.readFileSync(path.join(bijlagenMap(), b.pad)).toString('base64')}`); } catch { /* bestand weg */ }
  }
  return uit;
}

export function geldigheidDagen(db) {
  const w = db.prepare(`SELECT waarde FROM instellingen WHERE sleutel = 'offerte_geldig_dagen'`).get()?.waarde;
  const n = parseInt(w, 10);
  return Number.isInteger(n) && n > 0 ? n : 30;
}
// Betaaltermijn van een factuur in dagen (Instellingen → Bedrijf; standaard 7).
export function betaaltermijn(db) {
  const n = parseInt(db.prepare(`SELECT waarde FROM instellingen WHERE sleutel = 'factuur_betaaltermijn'`).get()?.waarde, 10);
  return Number.isInteger(n) && n >= 0 ? n : 7;
}
export function plusDagen(datum, dagen) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dagen);
  return d.toISOString().slice(0, 10);
}
