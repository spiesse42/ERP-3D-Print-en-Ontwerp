// ═══════════════════════════════════════════════════════════════════════
// Offertes en werkbon van een dossier (stap 5b) — gemount op /api
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { logGebeurtenis } from '../domein/historiek.js';
import { volgendNummer } from '../domein/nummering.js';
import { leesDossier, leesRegelsVan, berekenDossier, datumOk, bewaarRegels, leesRegels } from '../domein/dossiers.js';
import { offertesVan, nummerMetVersie, documentInhoud, geldigheidDagen, plusDagen, maakWerkbon, isErpBonnetje, isErpFactuur } from '../domein/documenten.js';
import { getBedrijfsgegevens } from '../domein/hulp.js';
import { factuurHtml, factuurBestand, peppolVerplicht } from '../documenten/factuur.js';
import { maakBonnetje, maakFactuur } from '../domein/afrekening.js';
import { overzicht as nummerOverzicht } from '../domein/nummering.js';
import { start } from '../domein/uitvoering.js';
import { synchroniseer } from '../productie/opdrachten.js';
import { OFFERTE_STATUS, vandaag } from '../domein/status/offerte.js';
import { documentHtml, dmjDatum } from '../documenten/sjabloon.js';
import { htmlNaarPdf, vindBrowser } from '../documenten/pdf.js';
import { verstuurMail, MailFout, mailIngesteld, geldigAdres } from '../documenten/mail.js';
import { accountableAdres, afzender, DREMPEL_BONNETJE, bonnetjeHtml, bonnetjeBestand, stuurBonnetje } from '../documenten/bonnetje.js';

const r = Router();
const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tekst = v => { const t = String(v ?? '').trim(); return t || null; };

function metFouten(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof DomeinFout || e instanceof MailFout) return res.status(e.status || 400).json({ error: e.message });
      console.error('[documenten]', e);
      res.status(500).json({ error: e.message });
    }
  };
}
const nietGevonden = wat => Object.assign(new DomeinFout(`${wat} niet gevonden`), { status: 404 });
const idVan = v => { const n = Number(v); if (!Number.isInteger(n)) throw new DomeinFout('Ongeldig id'); return n; };
function dossier(db, id) { const d = leesDossier(db, id); if (!d) throw nietGevonden('Dossier'); return d; }
function offerte(db, id) {
  const o = db.prepare('SELECT * FROM offertes WHERE id = ?').get(idVan(id));
  if (!o) throw nietGevonden('Offerte');
  const d = dossier(db, o.dossier_id);
  return { o, d, status: d.offertes.find(x => x.id === o.id).status };
}
function werkbon(db, id) {
  const w = db.prepare('SELECT * FROM werkbonnen WHERE id = ?').get(idVan(id));
  if (!w) throw nietGevonden('Werkbon');
  return { w, d: dossier(db, w.dossier_id) };
}
const log = (db, dossierId, t) => logGebeurtenis(db, 'dossier', dossierId, 'status', t);

// ── Offertes ────────────────────────────────────────────────────────────
r.get('/offertes', metFouten((req, res) => {
  const db = getDb();
  const rijen = db.prepare(`SELECT o.id, o.dossier_id, d.nummer AS dossier_nummer, d.titel, d.gearchiveerd,
      CASE WHEN k.type = 'zakelijk' AND NULLIF(k.bedrijfsnaam,'') IS NOT NULL THEN k.bedrijfsnaam
        ELSE TRIM(COALESCE(k.voornaam,'') || ' ' || COALESCE(k.naam,'')) END AS klant
    FROM offertes o JOIN dossiers d ON d.id = o.dossier_id LEFT JOIN klanten k ON k.id = d.klant_id ORDER BY o.id DESC`).all();
  const perDossier = new Map();
  const uit = rijen.map(x => {
    if (!perDossier.has(x.dossier_id)) {
      const d = leesDossier(db, x.dossier_id);
      perDossier.set(x.dossier_id, d);
    }
    const d = perDossier.get(x.dossier_id);
    const o = d.offertes.find(y => y.id === x.id);
    return { ...x, ...o, totaal: o.verstuurd_op ? o.totaal : d.berekening.totaal };
  });
  res.json(uit);
}));

// Nieuwe offerte of nieuwe versie (zelfde nummer, versie + 1).
r.post('/dossiers/:id/offertes', metFouten((req, res) => {
  const db = getDb();
  const d = dossier(db, idVan(req.params.id));
  if (!d.acties.offerte) {
    throw new DomeinFout(d.soort !== 'klant' ? 'Enkel een klantopdracht krijgt een offerte.'
      : d.offertes.some(o => o.aanvaard_op) ? 'De klant ging al akkoord met een offerte. Maak die eerst ongedaan als je een nieuwe versie wilt.'
      : 'Dit dossier is afgerekend of geannuleerd.');
  }
  if (d.offertes.some(o => o.status === 'concept')) throw new DomeinFout('Er is al een concept-offerte. Werk die af of verwijder ze.');
  const vorige = [...d.offertes].sort((a, b) => b.versie - a.versie)[0];
  db.transaction(() => {
    const nummer = vorige ? vorige.nummer : volgendNummer(db, 'OFF');
    const versie = vorige ? vorige.versie + 1 : 1;
    db.prepare('INSERT INTO offertes (dossier_id, nummer, versie, geldig_tot, levertermijn, opmerking) VALUES (?,?,?,?,?,?)')
      .run(d.id, nummer, versie, plusDagen(vandaag(), geldigheidDagen(db)), vorige?.levertermijn ?? null, vorige?.opmerking ?? null);
    log(db, d.id, `Offerte ${nummerMetVersie({ nummer, versie })} aangemaakt (concept)`);
  })();
  res.status(201).json(leesDossier(db, d.id));
}));

r.put('/offertes/:id', metFouten((req, res) => {
  const db = getDb();
  const { o, d, status } = offerte(db, req.params.id);
  if (status !== 'concept') throw new DomeinFout('Een verstuurde offerte ligt vast. Maak een nieuwe versie.');
  const geldig = tekst(req.body?.geldig_tot);
  if (geldig && !datumOk(geldig)) throw new DomeinFout('Ongeldige datum bij "geldig tot"');
  db.prepare('UPDATE offertes SET geldig_tot = ?, levertermijn = ?, opmerking = ? WHERE id = ?')
    .run(geldig, tekst(req.body?.levertermijn), tekst(req.body?.opmerking), o.id);
  res.json(leesDossier(db, d.id));
}));

r.delete('/offertes/:id', metFouten((req, res) => {
  const db = getDb();
  const { o, d, status } = offerte(db, req.params.id);
  if (status !== 'concept') throw new DomeinFout('Enkel een concept-offerte kan verwijderd worden.');
  db.transaction(() => {
    db.prepare('DELETE FROM offertes WHERE id = ?').run(o.id);
    log(db, d.id, `Concept-offerte ${nummerMetVersie(o)} verwijderd`);
  })();
  res.json(leesDossier(db, d.id));
}));

// Versturen = bevriezen (momentopname). Ook gebruikt door "mailen".
function versturen(db, o, d) {
  if (!d.regels.length) throw new DomeinFout('Voeg eerst regels toe aan het dossier.');
  if (!d.berekening.volledig) throw new DomeinFout('Niet alle regels kunnen berekend worden. Los dat eerst op.');
  if (!d.klant_id) throw new DomeinFout('Kies eerst een klant voor dit dossier.');
  const geldig = o.geldig_tot || plusDagen(vandaag(), geldigheidDagen(db));
  if (geldig < vandaag()) throw new DomeinFout('"Geldig tot" ligt in het verleden. Pas de datum aan.');
  const momentopname = { regels_api: leesRegelsVan(db, d.id), document: documentInhoud(db, d, d.berekening) };
  db.prepare('UPDATE offertes SET verstuurd_op = ?, geldig_tot = ?, momentopname = ?, totaal = ? WHERE id = ?')
    .run(vandaag(), geldig, JSON.stringify(momentopname), d.berekening.totaal, o.id);
  log(db, d.id, `Offerte ${nummerMetVersie(o)} verstuurd (${euro(d.berekening.totaal)}, geldig tot ${dmjDatum(geldig)})`);
}
r.post('/offertes/:id/versturen', metFouten((req, res) => {
  const db = getDb();
  const { o, d, status } = offerte(db, req.params.id);
  if (status !== 'concept') throw new DomeinFout('Deze offerte is al verstuurd.');
  db.transaction(() => versturen(db, o, d))();
  res.json(leesDossier(db, d.id));
}));

const FASE_TEKST = { afgerekend: 'al afgerekend', betaald: 'al afgerekend', gratis: 'gratis geleverd', geannuleerd: 'geannuleerd', samengevoegd: 'samengevoegd in een ander dossier' };
function antwoord(soort) {
  return metFouten((req, res) => {
    const db = getDb();
    const { o, d, status } = offerte(db, req.params.id);
    if (!['verstuurd', 'verlopen'].includes(status)) {
      throw new DomeinFout(status === 'vervangen' ? 'Er is een nieuwere versie van deze offerte.' : `Deze offerte is ${OFFERTE_STATUS[status].toLowerCase()}.`);
    }
    // afgerekend, gratis, geannuleerd of samengevoegd: het antwoord verandert
    // niets meer (en aanvaarden zou niet meer starten)
    if (!d.acties.bewerken) throw new DomeinFout(`Het dossier is ${FASE_TEKST[d.fase] || 'afgesloten'}: een antwoord op de offerte verandert niets meer.`);
    const datum = req.body?.datum || vandaag();
    if (!datumOk(datum)) throw new DomeinFout('Vul een geldige datum in');
    if (datum > vandaag()) throw new DomeinFout('De datum van het antwoord kan niet in de toekomst liggen.');
    db.transaction(() => {
      db.prepare(`UPDATE offertes SET ${soort === 'aanvaard' ? 'aanvaard_op' : 'geweigerd_op'} = ? WHERE id = ?`).run(datum, o.id);
      log(db, d.id, `Offerte ${nummerMetVersie(o)} ${soort === 'aanvaard' ? 'aanvaard door de klant' : 'geweigerd door de klant'} (${dmjDatum(datum)})`);
      // aanvaard = uitvoering start: werkbon + printopdrachten (25-09)
      if (soort === 'aanvaard' && d.acties.bewerken) start(db, d.id, { waarom: `offerte ${nummerMetVersie(o)} aanvaard` });
    })();
    res.json(leesDossier(db, d.id));
  });
}
r.post('/offertes/:id/aanvaard', antwoord('aanvaard'));
r.post('/offertes/:id/geweigerd', antwoord('geweigerd'));
r.post('/offertes/:id/antwoord-ongedaan', metFouten((req, res) => {
  const db = getDb();
  const { o, d, status } = offerte(db, req.params.id);
  if (status !== 'aanvaard' && status !== 'geweigerd') throw new DomeinFout('Er is geen antwoord om ongedaan te maken.');
  if (!d.acties.bewerken) throw new DomeinFout(`Het dossier is ${FASE_TEKST[d.fase] || 'afgesloten'}. ${d.fase === 'geannuleerd' ? 'Heropen het eerst.' : d.fase === 'gratis' ? 'Maak "Gratis geleverd" eerst ongedaan.' : d.fase === 'samengevoegd' ? '' : 'Maak de afrekening eerst ongedaan.'}`.trim());
  db.transaction(() => {
    db.prepare('UPDATE offertes SET aanvaard_op = NULL, geweigerd_op = NULL WHERE id = ?').run(o.id);
    log(db, d.id, `Antwoord op offerte ${nummerMetVersie(o)} ongedaan gemaakt`);
  })();
  res.json(leesDossier(db, d.id));
}));

function offerteDocument(db, o, d, status) {
  const verstuurd = !!o.verstuurd_op;
  const inhoud = verstuurd ? JSON.parse(o.momentopname).document : documentInhoud(db, d, d.berekening);
  return documentHtml({
    soort: 'OFFERTE', nummer: nummerMetVersie(o), datum: o.verstuurd_op || vandaag(), concept: !verstuurd, inhoud, opmerking: o.opmerking,
    info: [['Geldig tot', dmjDatum(o.geldig_tot || plusDagen(vandaag(), geldigheidDagen(db)))], ['Levertermijn', o.levertermijn],
      ...(status === 'vervangen' ? [['Status', 'vervangen door een nieuwere versie']] : [])],
  });
}
const pdfNaam = (soort, nr) => `${soort} ${nr}.pdf`.replace(/[^\w .-]/g, '_');
async function stuurPdf(res, html, naam) {
  const pdf = await htmlNaarPdf(html);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${naam}"` });
  res.send(pdf);
}
r.get('/offertes/:id/pdf', metFouten(async (req, res) => {
  const db = getDb();
  const { o, d, status } = offerte(db, req.params.id);
  await stuurPdf(res, offerteDocument(db, o, d, status), pdfNaam('Offerte', nummerMetVersie(o)));
}));
// Een concept wordt eerst verstuurd (vastgelegd), dan gemaild.
// Mislukt het mailen (geen verbinding, verkeerd adres…), dan blijft een
// concept een concept (29-09): anders stond de offerte op "verstuurd" terwijl
// de klant niets kreeg.
r.post('/offertes/:id/mail', metFouten(async (req, res) => {
  const db = getDb();
  let { o, d, status } = offerte(db, req.params.id);
  if (!geldigAdres(req.body?.aan)) throw new DomeinFout('Vul een geldig e-mailadres in.');
  if (!mailIngesteld()) throw new DomeinFout('Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie). Download de PDF en stuur hem zelf, en kies dan "Markeren als verstuurd".');
  if (!vindBrowser()) throw new DomeinFout('Geen Chrome, Edge of Chromium gevonden om de PDF te maken.');
  const concept = status === 'concept' ? o : null;
  if (concept) {
    db.transaction(() => versturen(db, o, d))();
    ({ o, d, status } = offerte(db, req.params.id));
  }
  try {
    const pdf = await htmlNaarPdf(offerteDocument(db, o, d, status));
    await verstuurMail({ aan: req.body?.aan, onderwerp: tekst(req.body?.onderwerp) || `Offerte ${nummerMetVersie(o)}`, tekst: req.body?.tekst || '',
      bijlage: { naam: pdfNaam('Offerte', nummerMetVersie(o)), inhoud: pdf } });
  } catch (e) {
    if (concept) db.transaction(() => {
      db.prepare('UPDATE offertes SET verstuurd_op = NULL, geldig_tot = ?, momentopname = NULL, totaal = NULL WHERE id = ?').run(concept.geldig_tot, concept.id);
      log(db, d.id, `Mailen van offerte ${nummerMetVersie(o)} mislukt: ze blijft een concept`);
    })();
    throw e;
  }
  log(db, d.id, `Offerte ${nummerMetVersie(o)} gemaild naar ${String(req.body.aan).trim()}`);
  res.json(leesDossier(db, d.id));
}));

// ── Werkbon ─────────────────────────────────────────────────────────────
r.post('/dossiers/:id/werkbon', metFouten((req, res) => {
  const db = getDb();
  const d = dossier(db, idVan(req.params.id));
  if (!d.acties.werkbon) throw new DomeinFout(d.werkbon ? 'Dit dossier heeft al een werkbon.' : 'Dit dossier is afgerekend of geannuleerd.');
  db.transaction(() => maakWerkbon(db, d.id))();
  res.status(201).json(leesDossier(db, d.id));
}));
r.put('/werkbonnen/:id', metFouten((req, res) => {
  const db = getDb();
  const { w, d } = werkbon(db, req.params.id);
  if (w.definitief_op) throw new DomeinFout('De werkbon is definitief (afgerekend).');
  db.prepare('UPDATE werkbonnen SET opmerking = ? WHERE id = ?').run(tekst(req.body?.opmerking), w.id);
  res.json(leesDossier(db, d.id));
}));
r.delete('/werkbonnen/:id', metFouten((req, res) => {
  const db = getDb();
  const { w, d } = werkbon(db, req.params.id);
  if (w.definitief_op) throw new DomeinFout('Een definitieve werkbon kan niet verwijderd worden.');
  db.transaction(() => {
    db.prepare('DELETE FROM werkbonnen WHERE id = ?').run(w.id);
    log(db, d.id, `Werkbon ${nummerMetVersie(w)} verwijderd`);
  })();
  res.json(leesDossier(db, d.id));
}));

// Werkelijke printtijd en gemeten kWh per printregel (tot stap 6 met de hand).
r.put('/dossiers/:id/werkelijk', metFouten((req, res) => {
  const db = getDb();
  const d = dossier(db, idVan(req.params.id));
  if (!d.acties.bewerken) throw new DomeinFout('Dit dossier ligt vast.');
  const lijst = Array.isArray(req.body?.regels) ? req.body.regels : [];
  const printregels = new Map(d.regels.filter(x => x.type === 'printen').map(x => [x.id, x]));
  const getalOfNull = (v, wat) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) throw new DomeinFout(`${wat} moet een getal ≥ 0 zijn`);
    return n;
  };
  const upd = db.prepare('UPDATE dossier_regels SET werkelijk_uren = ?, werkelijk_kwh = ? WHERE id = ?');
  const delen = [];
  db.transaction(() => {
    for (const x of lijst) {
      const oud = printregels.get(Number(x.id));
      if (!oud) throw new DomeinFout('Onbekende printregel');
      const uren = getalOfNull(x.uren, 'Werkelijke printtijd'), kwh = getalOfNull(x.kwh, 'Gemeten kWh');
      if (uren === (oud.werkelijk?.uren ?? null) && kwh === (oud.werkelijk?.kwh ?? null)) continue;
      upd.run(uren, kwh, oud.id);
      const nl = v => (v == null ? '—' : String(v).replace('.', ','));
      delen.push(`${oud.omschrijving || 'printregel'}: ${nl(uren)} u, ${nl(kwh)} kWh`);
    }
    if (delen.length) logGebeurtenis(db, 'dossier', d.id, 'gewijzigd', `Werkelijk verbruik: ${delen.join('; ')}`);
  })();
  res.json(leesDossier(db, d.id));
}));

// Regels terugzetten naar die van de aanvaarde offerte (werkbon-tabblad,
// als het dossier intussen gewijzigd is). Bestaande regel-id's blijven.
r.post('/dossiers/:id/regels-uit-offerte', metFouten((req, res) => {
  const db = getDb();
  const d = dossier(db, idVan(req.params.id));
  if (!d.acties.bewerken) throw new DomeinFout('Dit dossier ligt vast.');
  const o = db.prepare('SELECT * FROM offertes WHERE dossier_id = ? AND aanvaard_op IS NOT NULL').get(d.id);
  if (!o) throw new DomeinFout('Er is geen aanvaarde offerte.');
  const { regels_api } = JSON.parse(o.momentopname);
  db.transaction(() => {
    bewaarRegels(db, d.id, leesRegels(regels_api));
    synchroniseer(db, d.id, { oudeRegels: d.regels });
    logGebeurtenis(db, 'dossier', d.id, 'gewijzigd', `Regels teruggezet naar offerte ${nummerMetVersie(o)} (${euro(o.totaal)})`);
  })();
  res.json(leesDossier(db, d.id));
}));

function werkbonDocument(db, w, d) {
  const definitief = !!w.definitief_op;
  const m = definitief ? JSON.parse(w.momentopname) : null;
  const inhoud = definitief ? m.document : d.werkbon.concept_document;
  if (!inhoud) throw new DomeinFout('De werkbon heeft nog geen regels.');
  const basis = definitief ? (m.basis || 'metingen') : d.werkbon.basis;
  return documentHtml({ soort: 'WERKBON', nummer: nummerMetVersie(w), datum: w.definitief_op || vandaag(), concept: !definitief,
    inhoud, opmerking: w.opmerking, toonUren: basis === 'metingen',
    info: d.offertes.filter(o => o.aanvaard_op).map(o => ['Volgens offerte', o.weergave]) });
}
r.get('/werkbonnen/:id/pdf', metFouten(async (req, res) => {
  const db = getDb();
  const { w, d } = werkbon(db, req.params.id);
  await stuurPdf(res, werkbonDocument(db, w, d), pdfNaam('Werkbon', nummerMetVersie(w)));
}));
r.post('/werkbonnen/:id/mail', metFouten(async (req, res) => {
  const db = getDb();
  const { w, d } = werkbon(db, req.params.id);
  const pdf = await htmlNaarPdf(werkbonDocument(db, w, d));
  await verstuurMail({ aan: req.body?.aan, onderwerp: tekst(req.body?.onderwerp) || `Werkbon ${nummerMetVersie(w)}`, tekst: req.body?.tekst || '',
    bijlage: { naam: pdfNaam('Werkbon', nummerMetVersie(w)), inhoud: pdf } });
  log(db, d.id, `Werkbon ${nummerMetVersie(w)} gemaild naar ${String(req.body.aan).trim()}`);
  res.json(leesDossier(db, d.id));
}));

// ── Bonnetje en factuur door het ERP (26-09, factuur 29-09) ─────────────
// Herziening van "optie A" (claude/beslissingen-2026-09-26.md): het ERP maakt
// het bonnetje (reeks BON: "Bonnetje 2026-020") of de factuur (reeks FAC:
// "Factuur 2026-004"), mailt het ALTIJD naar Accountable (inkomsten@) en
// optioneel naar de klant (Accountable dan in cc). Accountable krijgt elk
// document exact één keer: een tweede mail zou een dubbele inkomst geven. Het
// PDF wordt niet bewaard maar opnieuw opgebouwd uit de definitieve werkbon +
// nummer/datum van de afrekening. Routes: /dossiers/:id/bonnetje/… en
// /dossiers/:id/factuur/… (zelfde werking).
const TERUG = Symbol('terugdraaien');
const SOORT = {
  bonnetje: { wat: 'het bonnetje', Wat: 'Bonnetje', reeks: 'BON', isErp: isErpBonnetje, bestand: bonnetjeBestand },
  factuur: { wat: 'de factuur', Wat: 'Factuur', reeks: 'FAC', isErp: isErpFactuur, bestand: factuurBestand },
};
function betaaltermijn(db) {
  const n = parseInt(db.prepare(`SELECT waarde FROM instellingen WHERE sleutel = 'factuur_betaaltermijn'`).get()?.waarde, 10);
  return Number.isInteger(n) && n >= 0 ? n : 7;
}
// Datum van de laatste levering (datum uitvoering), anders de factuurdatum.
const uitvoering = (d, datum) => d.leveringen?.map(l => l.datum).filter(x => x <= datum).sort().at(-1) || datum;
async function erpDocumentHtml(soort, d) {
  const S = SOORT[soort];
  if (!S.isErp(d)) throw new DomeinFout(`Dit dossier heeft geen ${S.Wat.toLowerCase()} dat door het ERP gemaakt werd.`);
  if (!d.werkbon?.document) throw new DomeinFout(`De definitieve werkbon ontbreekt: ${S.wat} kan niet opgebouwd worden.`);
  return soort === 'factuur'
    ? factuurHtml({ inhoud: d.werkbon.document, nummer: d.afgerekend_nummer, datum: d.afgerekend_op, vervaldatum: d.afrekening_vervaldatum || d.afgerekend_op, uitvoering: uitvoering(d, d.afgerekend_op) })
    : bonnetjeHtml({ inhoud: d.werkbon.document, nummer: d.afgerekend_nummer, datum: d.afgerekend_op });
}
function documentDatum(v, soort) {
  const datum = tekst(v) || vandaag();
  if (!datumOk(datum)) throw new DomeinFout('Vul een geldige datum in');
  if (datum > vandaag()) throw new DomeinFout(`${SOORT[soort].Wat === 'Factuur' ? 'Een factuur' : 'Een bonnetje'} kan niet in de toekomst liggen.`);
  return datum;
}
function vervalDatum(db, v, datum) {
  const verval = tekst(v) || plusDagen(datum, betaaltermijn(db));
  if (!datumOk(verval)) throw new DomeinFout('Vul een geldige vervaldatum in');
  if (verval < datum) throw new DomeinFout('De vervaldatum kan niet vóór de factuurdatum liggen.');
  return verval;
}
// Wat het document ZOU worden (venster + voorbeeld-PDF), zonder iets te
// bewaren: de werkbon wordt zo nodig gemaakt in een transactie die daarna
// teruggedraaid wordt, zodat het exact hetzelfde is als bij het echte maken.
function documentVoorstel(db, d0, datum, soort) {
  if (!d0.acties.afrekenen) throw new DomeinFout(d0.soort !== 'klant' ? 'Enkel een klantopdracht wordt afgerekend.' : 'Dit dossier is al afgerekend, gratis geleverd of geannuleerd.');
  if (soort === 'factuur' && !d0.klant_id) throw new DomeinFout('Een factuur is altijd op naam: kies eerst de klant van dit dossier (of maak een bonnetje).');
  let uit = null;
  try {
    db.transaction(() => {
      const d = !d0.werkbon && maakWerkbon(db, d0.id) ? leesDossier(db, d0.id) : d0;
      const wb = d.werkbon;
      if (!wb.volledig || !wb.concept_document) throw new DomeinFout('Niet alle regels van de werkbon kunnen berekend worden. Los dat eerst op (zie de regels).');
      uit = { inhoud: wb.concept_document, bedrag: wb.bedrag, werkbon: wb.weergave };
      throw TERUG;
    })();
  } catch (e) { if (e !== TERUG) throw e; }
  const nummer = nummerOverzicht(db, Number(datum.slice(0, 4))).find(x => x.reeks === SOORT[soort].reeks).voorbeeld;
  return { ...uit, nummer, datum };
}
async function mailDocument(db, soort, d, body) {
  const S = SOORT[soort];
  const uit = await stuurBonnetje({ nummer: d.afgerekend_nummer, titel: d.titel, bedrag: d.afgerekend_bedrag, context: `dossier ${d.nummer}`,
    html: await erpDocumentHtml(soort, d), ...body, al_bij_accountable: !!d.afrekening_gemaild_op, wat: S.wat, bestand: S.bestand(d.afgerekend_nummer) });
  db.transaction(() => {
    if (uit.accountable) db.prepare('UPDATE dossiers SET afrekening_gemaild_op = ? WHERE id = ?').run(new Date().toISOString(), d.id);
    if (uit.klantAdres) db.prepare('UPDATE dossiers SET afrekening_klant_mail = ? WHERE id = ?').run(uit.klantAdres, d.id);
    log(db, d.id, uit.tekst);
  })();
}
const soortVan = req => {
  if (!SOORT[req.params.soort]) throw nietGevonden('Pagina');
  return req.params.soort;
};

// Gegevens voor het venster "Bonnetje maken" / "Factuur maken".
r.get('/dossiers/:id/:soort(bonnetje|factuur)/voorstel', metFouten((req, res) => {
  const db = getDb();
  const soort = soortVan(req);
  const d = dossier(db, idVan(req.params.id));
  const datum = documentDatum(req.query.datum, soort);
  const v = documentVoorstel(db, d, datum, soort);
  const k = d.klant_gegevens;
  const b = getBedrijfsgegevens(db);
  res.json({ nummer: v.nummer, datum: v.datum, bedrag: v.bedrag, werkbon: v.werkbon, accountable: accountableAdres(), afzender: afzender(),
    mail_ingesteld: mailIngesteld(), pdf_mogelijk: !!vindBrowser(), drempel: DREMPEL_BONNETJE, klant_email: k?.email || null,
    ...(soort === 'factuur' ? {
      vervaldatum: plusDagen(v.datum, betaaltermijn(db)), betaaltermijn: betaaltermijn(db),
      peppol_verplicht: peppolVerplicht(k),
      // wat er ontbreekt op de factuur (bedrijfsgegevens, adres van de klant)
      ontbreekt: [!b.naam && 'je bedrijfsnaam', !b.adres && 'je adres', !b.btw && 'je ondernemingsnummer', !b.iban && 'je IBAN',
        !(k?.straat && k?.gemeente) && 'het adres van de klant', k?.type === 'zakelijk' && !k?.btw_nummer && (k?.land || 'BE') === 'BE' && 'het btw-nummer van de klant'].filter(Boolean),
    } : {}) });
}));
r.get('/dossiers/:id/:soort(bonnetje|factuur)/voorbeeld', metFouten(async (req, res) => {
  const db = getDb();
  const soort = soortVan(req);
  const d = dossier(db, idVan(req.params.id));
  const datum = documentDatum(req.query.datum, soort);
  const v = documentVoorstel(db, d, datum, soort);
  const html = soort === 'factuur'
    ? await factuurHtml({ inhoud: v.inhoud, nummer: v.nummer, datum, vervaldatum: vervalDatum(db, req.query.vervaldatum, datum), uitvoering: uitvoering(d, datum), concept: true })
    : bonnetjeHtml({ inhoud: v.inhoud, nummer: v.nummer, datum: v.datum, concept: true });
  await stuurPdf(res, html, SOORT[soort].bestand(v.nummer, ' - voorbeeld'));
}));
// Maken (afrekenen; bonnetje = ook betaald) en meteen mailen. Eerst alles
// controleren wat het mailen kan tegenhouden, zodat er geen nummer
// "verbruikt" wordt voor niets. Mislukt het mailen toch (bv. geen
// verbinding), dan blijft het document bestaan en meldt de volgende stap dat
// het nog gemaild moet worden.
r.post('/dossiers/:id/:soort(bonnetje|factuur)', metFouten(async (req, res) => {
  const db = getDb();
  const soort = soortVan(req);
  const d0 = dossier(db, idVan(req.params.id));
  const datum = documentDatum(req.body?.datum, soort);
  const verval = soort === 'factuur' ? vervalDatum(db, req.body?.vervaldatum, datum) : null;
  documentVoorstel(db, d0, datum, soort);   // zelfde controles als het venster
  const naarKlant = !!req.body?.naar_klant;
  if (naarKlant && !geldigAdres(req.body?.aan)) throw new DomeinFout('Vul een geldig e-mailadres van de klant in (of vink "ook naar de klant" uit).');
  if (!mailIngesteld()) throw new DomeinFout(`Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie). ${soort === 'factuur' ? 'Een factuur' : 'Een bonnetje'} moet naar Accountable gemaild worden.`);
  if (!vindBrowser()) throw new DomeinFout('Geen Chrome, Edge of Chromium gevonden om de PDF te maken.');
  const leverVoorraad = req.body?.voorraad_leveren !== false;
  db.transaction(() => (soort === 'factuur'
    ? maakFactuur(db, d0, { datum, vervaldatum: verval, leverVoorraad })
    : maakBonnetje(db, d0, { datum, leverVoorraad })))();
  let mail_fout = null;
  try {
    await mailDocument(db, soort, leesDossier(db, d0.id), { naar_klant: naarKlant, aan: req.body?.aan, onderwerp: req.body?.onderwerp, tekst: req.body?.tekst, naar_accountable: true });
  } catch (e) {
    mail_fout = e.message;
    console.error(`[${soort}]`, e);
    log(db, d0.id, `Mailen van ${SOORT[soort].wat} mislukt: ${e.message}. Het is NOG NIET naar Accountable gestuurd.`);
  }
  res.status(201).json({ ...leesDossier(db, d0.id), mail_fout });
}));
r.get('/dossiers/:id/:soort(bonnetje|factuur)/pdf', metFouten(async (req, res) => {
  const db = getDb();
  const soort = soortVan(req);
  const d = dossier(db, idVan(req.params.id));
  await stuurPdf(res, await erpDocumentHtml(soort, d), SOORT[soort].bestand(d.afgerekend_nummer));
}));
// Opnieuw mailen: naar de klant (altijd mogelijk) en/of naar Accountable
// (enkel als dat nog niet gebeurd is).
r.post('/dossiers/:id/:soort(bonnetje|factuur)/mail', metFouten(async (req, res) => {
  const db = getDb();
  const soort = soortVan(req);
  const d = dossier(db, idVan(req.params.id));
  await erpDocumentHtml(soort, d);
  await mailDocument(db, soort, d, { naar_klant: !!req.body?.naar_klant, aan: req.body?.aan, onderwerp: req.body?.onderwerp, tekst: req.body?.tekst,
    naar_accountable: !!req.body?.naar_accountable });
  res.json(leesDossier(db, d.id));
}));

export default r;
