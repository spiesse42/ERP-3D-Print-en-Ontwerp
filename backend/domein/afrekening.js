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
import { maakWerkbon, afrekeningWeergave, isErpBonnetje } from './documenten.js';
import { leesDossier, leesRegelsVan } from './dossiers.js';
import { volgendNummer } from './nummering.js';

const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmj = d => String(d).split('-').reverse().join('-');


// afrekening(wb) → { soort, nummer, datum, bedrag, extra? } — pas opgeroepen
// als de werkbon volledig berekend is (dus geen nummer "verbruikt" bij een fout).
export function rekenAf(db, d0, { waarom = 'bij het afrekenen', afrekening, logTekst = null }) {
  const d = !d0.werkbon && maakWerkbon(db, d0.id, { waarom }) ? leesDossier(db, d0.id) : d0;
  const wb = d.werkbon;
  if (!wb.volledig || !wb.concept_document) throw new DomeinFout('Niet alle regels van de werkbon kunnen berekend worden. Los dat eerst op (zie de regels).');
  const a = afrekening(wb);
  const momentopname = { regels_api: leesRegelsVan(db, d.id), document: wb.concept_document, basis: wb.basis, metingen_totaal: wb.berekening?.totaal ?? null };
  db.prepare('UPDATE werkbonnen SET definitief_op = ?, momentopname = ?, totaal = ? WHERE id = ?')
    .run(a.datum, JSON.stringify(momentopname), wb.bedrag, wb.id);
  // Een bonnetje = afgerekend én betaald in één keer (dagontvangsten).
  const betaald = a.soort === 'bonnetje' ? a.datum : null;
  db.prepare(`UPDATE dossiers SET afgerekend_soort=?, afgerekend_nummer=?, afgerekend_op=?, afgerekend_bedrag=?, betaald_op=?,
      afrekening_pdf_op = ? WHERE id=?`)
    .run(a.soort, a.nummer, a.datum, a.bedrag, betaald, a.pdf ? new Date().toISOString() : null, d.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', logTekst ? logTekst(a, betaald)
    : `Afgerekend in Accountable: ${afrekeningWeergave(a.soort, a.nummer)} van ${dmj(a.datum)}, ${euro(a.bedrag)}${betaald ? ' (meteen betaald)' : ''}`);
  return a;
}

// ── Bonnetje door het ERP (26-09) ───────────────────────────────────────
// Het nummer komt uit de reeks BON van het jaar van de bonnetjesdatum. Het
// bedrag is ALTIJD dat van de werkbon: de regels op het bonnetje moeten
// samen het totaal geven (een ander bedrag? pas de regels van het dossier aan).
export function maakBonnetje(db, d0, { datum }) {
  return rekenAf(db, d0, {
    waarom: 'bij het maken van het bonnetje',
    afrekening: wb => ({ soort: 'bonnetje', nummer: volgendNummer(db, 'BON', { jaar: Number(String(datum).slice(0, 4)) }), datum, bedrag: wb.bedrag, pdf: true }),
    logTekst: a => `${a.nummer} gemaakt door het ERP (${dmj(a.datum)}, ${euro(a.bedrag)}): afgerekend en meteen betaald`,
  });
}

export { afrekeningWeergave, isErpBonnetje };
