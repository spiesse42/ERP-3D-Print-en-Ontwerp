// ═══════════════════════════════════════════════════════════════════════
// AFREKENEN van een klantdossier — gedeeld door:
// - "Afrekenen" (verwijzing naar een factuur/bonnetje dat in Accountable
//   gemaakt werd; nummer met de hand ingevuld), en
// - "Bonnetje maken" (26-09): het ERP maakt zelf het bonnetje (nummer uit de
//   reeks BON), mailt het naar inkomsten@accountable.eu en optioneel naar
//   de klant.
// Afrekenen maakt de werkbon definitief (momentopname): met aanvaarde
// offerte het offertebedrag, anders het bedrag volgens de metingen. Nog geen
// werkbon → eerst automatisch aanmaken (25-09).
import { DomeinFout } from './hulp.js';
import { logGebeurtenis } from './historiek.js';
import { maakWerkbon, afrekeningWeergave, isErpBonnetje, isErpFactuur, isErpDocument, eenRegelInhoud } from './documenten.js';
import { leesDossier, leesRegelsVan } from './dossiers.js';
import { volgendNummer } from './nummering.js';
import { leverRestUitVoorraad } from './leveringen.js';

const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmj = d => String(d).split('-').reverse().join('-');


// afrekening(wb) → { soort, nummer, datum, bedrag, extra? } — pas opgeroepen
// als de werkbon volledig berekend is (dus geen nummer "verbruikt" bij een fout).
// leverVoorraad (29-09): nog niet geleverde artikelen uit voorraad meteen leveren.
export function rekenAf(db, d0, { waarom = 'bij het afrekenen', afrekening, logTekst = null, leverVoorraad = true, eenRegel = null }) {
  const d = !d0.werkbon && maakWerkbon(db, d0.id, { waarom }) ? leesDossier(db, d0.id) : d0;
  const wb = d.werkbon;
  if (!wb.volledig || !wb.concept_document) throw new DomeinFout('Niet alle regels van de werkbon kunnen berekend worden. Los dat eerst op (zie de regels).');
  const a = afrekening(wb);
  const momentopname = { regels_api: leesRegelsVan(db, d.id), document: eenRegel ? eenRegelInhoud(wb.concept_document, eenRegel) : wb.concept_document, basis: wb.basis, metingen_totaal: wb.berekening?.totaal ?? null };
  db.prepare('UPDATE werkbonnen SET definitief_op = ?, momentopname = ?, totaal = ? WHERE id = ?')
    .run(a.datum, JSON.stringify(momentopname), wb.bedrag, wb.id);
  // Een bonnetje = afgerekend én betaald in één keer (dagontvangsten).
  const betaald = a.soort === 'bonnetje' ? a.datum : null;
  db.prepare(`UPDATE dossiers SET afgerekend_soort=?, afgerekend_nummer=?, afgerekend_op=?, afgerekend_bedrag=?, betaald_op=?,
      afrekening_pdf_op = ?, afrekening_vervaldatum = ? WHERE id=?`)
    .run(a.soort, a.nummer, a.datum, a.bedrag, betaald, a.pdf ? new Date().toISOString() : null, a.vervaldatum || null, d.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', logTekst ? logTekst(a, betaald)
    : `Afgerekend in Accountable: ${afrekeningWeergave(a.soort, a.nummer)} van ${dmj(a.datum)}, ${euro(a.bedrag)}${betaald ? ' (meteen betaald)' : ''}`);
  if (leverVoorraad) a.levering = leverRestUitVoorraad(db, d, a.datum, waarom);
  return a;
}

// ── Bonnetje (26-09; nummer uit Accountable sinds 04-10) ────────────────
// Het ERP maakt het bonnetje (PDF) nog, maar het NUMMER komt uit Accountable
// (met de hand ingevuld): het bonnetje gaat niet meer naar inkomsten@ en
// Accountable nummert het zelf. Het bedrag is ALTIJD dat van de werkbon.
const kaalBon = t => String(t ?? '').trim().replace(/^bonnetje\s*/i, '').trim();
// 11-11: een Accountable-nummer mag nergens al gebruikt zijn: niet als
// nummer van een bonnetje, niet als Accountable-nummer naast een kassabon.
export function leesBonnummer(db, invoer, { behalveVerkoop = null, behalveDossier = null } = {}) {
  const t = kaalBon(invoer);
  if (!t) throw new DomeinFout('Vul het nummer van het bonnetje uit Accountable in (bv. 2026-025).');
  if (t.length > 40) throw new DomeinFout('Dat bonnetjesnummer is te lang.');
  if (/^kassabon\b/i.test(t)) throw new DomeinFout('Dat is een ERP-nummer (kassabon), geen nummer uit Accountable.');
  const zelfde = x => x != null && kaalBon(x).toLowerCase() === t.toLowerCase();
  const d = db.prepare(`SELECT id, nummer, afgerekend_nummer, accountable_nummer FROM dossiers WHERE afgerekend_soort = 'bonnetje' AND afgerekend_nummer IS NOT NULL`).all()
    .find(x => x.id !== behalveDossier && (zelfde(x.afgerekend_nummer) || zelfde(x.accountable_nummer)));
  const v = db.prepare(`SELECT id, nummer, accountable_nummer FROM verkopen WHERE soort = 'bonnetje' AND geannuleerd_op IS NULL`).all()
    .find(x => x.id !== behalveVerkoop && (zelfde(x.nummer) || zelfde(x.accountable_nummer)));
  if (d || v) throw new DomeinFout(`Bonnetje ${t} is al gebruikt (${d ? `dossier ${d.nummer}` : `verkoop ${v.nummer}`}). Controleer het nummer in Accountable.`);
  return `Bonnetje ${t}`;
}

// Voorstel (enkel ter hulp): het hoogste bonnetjesnummer van dat jaar + 1.
export function bonnummerVoorstel(db, datum) {
  const jaar = String(datum || '').slice(0, 4);
  const re = new RegExp(`^${jaar}-(\\d+)$`);
  const alle = [...db.prepare(`SELECT afgerekend_nummer n FROM dossiers WHERE afgerekend_soort = 'bonnetje' UNION ALL SELECT accountable_nummer FROM dossiers WHERE accountable_nummer IS NOT NULL`).all(),
    ...db.prepare(`SELECT nummer n FROM verkopen WHERE soort = 'bonnetje' UNION ALL SELECT accountable_nummer FROM verkopen WHERE accountable_nummer IS NOT NULL`).all()]
    .map(x => kaalBon(x.n).match(re)).filter(Boolean).map(m => ({ n: Number(m[1]), w: m[1].length }));
  if (!alle.length) return null;
  const hoog = alle.reduce((a, b) => (b.n > a.n ? b : a));
  return `${jaar}-${String(hoog.n + 1).padStart(hoog.w, '0')}`;
}

// 11-11: het Accountable-nummer naast een kassabon (dossier) invullen of
// wissen, ook later (zodra het bonnetje in Accountable staat).
export function zetAccountableNummer(db, dossierId, invoer) {
  const d = db.prepare('SELECT id, afgerekend_soort, afgerekend_nummer FROM dossiers WHERE id = ?').get(Number(dossierId));
  if (!d) throw Object.assign(new DomeinFout('Dossier niet gevonden'), { status: 404 });
  if (d.afgerekend_soort !== 'bonnetje' || !/^kassabon\b/i.test(d.afgerekend_nummer || '')) throw new DomeinFout('Enkel bij een kassabon (eigen ERP-nummer) hoort een apart Accountable-nummer.');
  const nr = String(invoer ?? '').trim() ? leesBonnummer(db, invoer, { behalveDossier: d.id }) : null;
  db.prepare('UPDATE dossiers SET accountable_nummer = ? WHERE id = ?').run(nr, d.id);
  logGebeurtenis(db, 'dossier', d.id, 'gewijzigd', nr ? `Nummer in Accountable bij ${d.afgerekend_nummer}: ${nr}` : `Nummer in Accountable bij ${d.afgerekend_nummer} gewist`);
  return nr;
}

// 11-11: eigen = eigen ERP-nummer (reeks KB, "Kassabon 2026-001"); het
// Accountable-nummer staat dan apart (accountable, optioneel/later).
export function maakBonnetje(db, d0, { datum, nummer, eigen = false, accountable = null, leverVoorraad = true, eenRegel = null }) {
  if (!eigen && !nummer) throw new DomeinFout('Vul het nummer van het bonnetje uit Accountable in.');
  const a = rekenAf(db, d0, {
    waarom: 'bij het maken van het bonnetje', leverVoorraad, eenRegel,
    afrekening: wb => ({ soort: 'bonnetje', nummer: eigen ? volgendNummer(db, 'KB', { jaar: Number(String(datum).slice(0, 4)) }) : nummer, datum, bedrag: wb.bedrag, pdf: true }),
    logTekst: a => `${a.nummer} gemaakt (${eigen ? `eigen ERP-nummer${accountable ? `; in Accountable: ${accountable}` : '; nog in Accountable te zetten'}` : 'nummer uit Accountable'}; ${dmj(a.datum)}, ${euro(a.bedrag)}): afgerekend en meteen betaald${eenRegel ? ` (één regel: "${eenRegel}")` : ''}`,
  });
  if (eigen && accountable) db.prepare('UPDATE dossiers SET accountable_nummer = ? WHERE id = ?').run(accountable, d0.id);
  return a;
}

// ── Factuur door het ERP (29-09) ────────────────────────────────────────
// Zelfde als het bonnetje, maar: nummer uit de reeks FAC, NIET meteen betaald,
// met een vervaldatum. Het bedrag is altijd dat van de werkbon.
export function maakFactuur(db, d0, { datum, vervaldatum, leverVoorraad = true, eenRegel = null }) {
  if (!d0.klant_id) throw new DomeinFout('Een factuur is altijd op naam: kies eerst de klant van dit dossier (of maak een bonnetje).');
  return rekenAf(db, d0, {
    waarom: 'bij het maken van de factuur', leverVoorraad, eenRegel,
    afrekening: wb => ({ soort: 'factuur', nummer: volgendNummer(db, 'FAC', { jaar: Number(String(datum).slice(0, 4)) }), datum, vervaldatum, bedrag: wb.bedrag, pdf: true }),
    logTekst: a => `${a.nummer} gemaakt door het ERP (${dmj(a.datum)}, ${euro(a.bedrag)}, vervalt ${dmj(a.vervaldatum)})${eenRegel ? `, in één regel: "${eenRegel}"` : ''}`,
  });
}

// Afrekening ongedaan (dossier-knop, of een losse verkoop die ongedaan
// gemaakt wordt). De werkbon wordt weer een concept, als nieuwe versie
// (domeinmodel: wijzigen na afrekenen = nieuwe versie).
export function maakAfrekeningOngedaan(db, d, { waarom = 'Pas dit ook aan in Accountable.' } = {}) {
  db.prepare(`UPDATE dossiers SET afgerekend_soort=NULL, afgerekend_nummer=NULL, afgerekend_op=NULL, afgerekend_bedrag=NULL, betaald_op=NULL,
    afrekening_pdf_op=NULL, afrekening_gemaild_op=NULL, afrekening_klant_mail=NULL, afrekening_vervaldatum=NULL, accountable_nummer=NULL WHERE id=?`).run(d.id);
  if (d.werkbon?.definitief_op) db.prepare('UPDATE werkbonnen SET definitief_op = NULL, momentopname = NULL, totaal = NULL, versie = versie + 1 WHERE id = ?').run(d.werkbon.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', `Afrekening ongedaan gemaakt (was ${afrekeningWeergave(d.afgerekend_soort, d.afgerekend_nummer)}). ${waarom}`.trim());
}

export { afrekeningWeergave, isErpBonnetje, isErpFactuur, isErpDocument };
