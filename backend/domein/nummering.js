// Doorlopende nummering voor INTERNE documenten (aankopen, dossiers,
// offertes, werkbonnen, pakbonnen) én, sinds 26-09, voor bonnetjes/facturen
// die het ERP zelf genereert en naar inkomsten@accountable.eu mailt. Eén
// teller per reeks per jaar, opgehoogd in dezelfde transactie als het
// aanmaken van het document, dus geen dubbele nummers.
//
// Bonnetjes/facturen: Accountable kent er ZELF ook een nummer aan toe zodra
// de mail verwerkt is. Het "volgende nummer" hier is dus geen louter interne
// teller: klopt het niet meer met wat er in Accountable verschijnt, corrigeer
// je het hier (net als bij de overschakeling van het oude pakket).
//
// Formaten (beslist 25-09, bonnetje/factuur-vorm verfijnd 26-09): zoals in
// het oude pakket ("REEKS-jaar-nummer"), behalve reeksen met `metNaam`: die
// tonen de volledige naam in plaats van de reekscode, gescheiden door een
// spatie in plaats van een streepje (bv. "Bonnetje 2026-020"), exact zoals
// het bij Accountable verschijnt — zo zijn ze in één oogopslag te vergelijken.
import { DomeinFout } from './hulp.js';

// tabel/kolom: waar de uitgegeven nummers staan (om te weigeren dat je het
// volgende nummer lager zet dan wat al bestaat). `filter` beperkt dat tot
// de juiste rijen als de kolom ook voor iets anders gebruikt wordt (bv.
// afgerekend_nummer bevat zowel bonnetje- als (voorlopig nog handmatige)
// factuurnummers).
export const REEKSEN = {
  D:   { naam: 'Dossier',  cijfers: 3, tabel: 'dossiers', kolom: 'nummer' },
  OFF: { naam: 'Offerte',  cijfers: 3, tabel: 'offertes', kolom: 'nummer' },
  WB:  { naam: 'Werkbon',  cijfers: 4, tabel: 'werkbonnen', kolom: 'nummer' },
  PB:  { naam: 'Pakbon',   cijfers: 3, tabel: 'leveringen', kolom: 'nummer' },
  AK:  { naam: 'Aankoop',  cijfers: 4, tabel: 'aankopen', kolom: 'nummer' },
  BON: { naam: 'Bonnetje', cijfers: 3, tabel: 'dossiers', kolom: 'afgerekend_nummer', metNaam: true, filter: "afgerekend_soort = 'bonnetje'" },
};

// "BON-" (klassiek) of "Bonnetje " (metNaam) — het stuk vóór "jaar-nummer".
const voorvoegsel = (reeks, r) => (r?.metNaam ? `${r.naam} ` : `${reeks}-`);

export function volgendNummer(db, reeks, { jaar = new Date().getFullYear(), cijfers } = {}) {
  if (!/^[A-Z]{1,4}$/.test(reeks)) throw new Error(`Ongeldige reeks: ${reeks}`);
  const r = REEKSEN[reeks];
  const c = cijfers ?? r?.cijfers ?? 4;
  const verhoog = db.transaction(() => {
    db.prepare(`
      INSERT INTO nummering (reeks, jaar, laatste) VALUES (?, ?, 1)
      ON CONFLICT (reeks, jaar) DO UPDATE SET laatste = laatste + 1
    `).run(reeks, jaar);
    return db.prepare('SELECT laatste FROM nummering WHERE reeks = ? AND jaar = ?').get(reeks, jaar).laatste;
  });
  const n = verhoog();
  return `${voorvoegsel(reeks, r)}${jaar}-${String(n).padStart(c, '0')}`;
}

// Hoogste nummer dat voor dit jaar echt in gebruik is (0 als er geen is).
function hoogsteUitgegeven(db, reeks, jaar) {
  const r = REEKSEN[reeks];
  if (!r?.tabel) return 0;
  const prefix = `${voorvoegsel(reeks, r)}${jaar}-`;
  const waar = r.filter ? `${r.kolom} LIKE ? AND ${r.filter}` : `${r.kolom} LIKE ?`;
  const rijen = db.prepare(`SELECT ${r.kolom} AS n FROM ${r.tabel} WHERE ${waar}`).all(`${prefix}%`);
  return rijen.reduce((m, x) => Math.max(m, parseInt(String(x.n).slice(prefix.length), 10) || 0), 0);
}

export function overzicht(db, jaar = new Date().getFullYear()) {
  return Object.entries(REEKSEN).map(([reeks, r]) => {
    const laatste = db.prepare('SELECT laatste FROM nummering WHERE reeks = ? AND jaar = ?').get(reeks, jaar)?.laatste ?? 0;
    const volgend = laatste + 1;
    return { reeks, naam: r.naam, jaar, laatste, volgend, voorbeeld: `${voorvoegsel(reeks, r)}${jaar}-${String(volgend).padStart(r.cijfers, '0')}`,
      minimum: hoogsteUitgegeven(db, reeks, jaar) + 1 };
  });
}

// Het volgende nummer van een reeks (voor dit jaar) instellen, bv. om verder
// te tellen waar het oude pakket stopte, of om bij te sturen naar wat
// Accountable zelf aan een bonnetje/factuur toekende. Nooit lager dan wat
// al bestaat.
export function zetVolgend(db, reeks, volgend, jaar = new Date().getFullYear()) {
  if (!REEKSEN[reeks]) throw new DomeinFout('Onbekende reeks');
  const n = Number(volgend);
  if (!Number.isInteger(n) || n < 1 || n > 999999) throw new DomeinFout('Het volgende nummer moet een geheel getal vanaf 1 zijn');
  const r = REEKSEN[reeks];
  const min = hoogsteUitgegeven(db, reeks, jaar) + 1;
  if (n < min) throw new DomeinFout(`Het volgende nummer kan niet lager dan ${min}: ${r.metNaam ? '' : `${r.naam.toLowerCase()} `}${voorvoegsel(reeks, r)}${jaar}-${String(min - 1).padStart(r.cijfers, '0')} bestaat al`);
  db.prepare(`INSERT INTO nummering (reeks, jaar, laatste) VALUES (?, ?, ?)
    ON CONFLICT (reeks, jaar) DO UPDATE SET laatste = excluded.laatste`).run(reeks, jaar, n - 1);
}
