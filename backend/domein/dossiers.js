// ═══════════════════════════════════════════════════════════════════════
// DOSSIERS (stap 5a) — kop, regels, afrekening als verwijzing
// ═══════════════════════════════════════════════════════════════════════
import { DomeinFout, getTarieven } from './hulp.js';
import { getal } from './rekenmotor.js';
import { berekenMetDb } from './berekening.js';
import { faseVan, actiesVan, stappenVan } from './status/dossier.js';
import { offertesVan, laatsteVerstuurde, werkbonVan, documentInhoud, afrekeningWeergave, isErpBonnetje, isErpFactuur, isErpDocument } from './documenten.js';
import { peppolVerplicht } from '../documenten/factuur.js';
import { leverbaar, leverStatus, leverStatusVan, leveringenVan, controleerGeleverd, nogTeLeveren } from './leveringen.js';
import { productieVan, productieOverzicht, metingenPerRegel, controleerPrintopdrachten, wisOpdrachtenVanRegels } from '../productie/opdrachten.js';

export const SOORTEN = { klant: 'Klantopdracht', eigen: 'Eigen product', intern: 'Intern' };
export const REGELTYPES = ['printen', 'ontwerp', 'aanpassing', 'artikel', 'extra'];

const tekst = v => { const t = String(v ?? '').trim(); return t || null; };
const id = (v, wat) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new DomeinFout(`Ongeldige ${wat}`);
  return n;
};
function nietNegatief(v, wat) {
  const n = getal(v);
  if (v !== null && v !== undefined && v !== '' && n === null) throw new DomeinFout(`${wat} moet een getal zijn`);
  if (n !== null && n < 0) throw new DomeinFout(`${wat} mag niet negatief zijn`);
  return n;
}
// aantal: leeg = 1, maar een ingevulde 0 kan niet (29-09: een regel met 0
// stuks gaf "geleverd" zonder dat er iets geleverd was)
function aantal(v, nr) {
  const n = nietNegatief(v, `${nr}: aantal`);
  if (n === 0) throw new DomeinFout(`${nr}: aantal moet groter dan 0 zijn (of haal de regel weg)`);
  return n ?? 1;
}
const datumOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));
// Kleine afbeelding bij een printregel (28-09): data-URI, in de browser verkleind.
const MAX_AFBEELDING = 400_000;
function afbeelding(v, nr) {
  if (v === null || v === undefined || v === '') return null;
  const t = String(v);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(t)) throw new DomeinFout(`${nr}: ongeldige afbeelding`);
  if (t.length > MAX_AFBEELDING) throw new DomeinFout(`${nr}: afbeelding is te groot`);
  return t;
}

// ── invoer ──────────────────────────────────────────────────────────────
export function leesKop(body) {
  const soort = body?.soort ?? 'klant';
  if (!SOORTEN[soort]) throw new DomeinFout('Soort moet klantopdracht, eigen product of intern zijn');
  const titel = tekst(body?.titel);
  if (!titel) throw new DomeinFout('Geef het dossier een titel (bv. "Naamplaatje fiets")');
  return { soort, klant_id: id(body?.klant_id, 'klant'), titel, notities: tekst(body?.notities) };
}

// Regels in de vorm van de regeleditor/rekenmotor (naarApi in de frontend).
// Enkel de velden die bij het soort regel horen worden bewaard.
export function leesRegels(lijst) {
  if (lijst === undefined) return undefined;
  if (!Array.isArray(lijst)) throw new DomeinFout('Regels moeten een lijst zijn');
  return lijst.map((r, i) => {
    const nr = `Regel ${i + 1}`;
    if (!REGELTYPES.includes(r?.type)) throw new DomeinFout(`${nr}: onbekend soort regel`);
    const leeg = { aantal: null, printer_id: null, tijd_min: null, voorbereiding_min: null, nabewerking_min: null,
      minuten: null, tarief: null, artikel_id: null, bedrag: null, per_stuk: 0, materialen: [], afbeelding: null,
      slicer_bijlage_id: null, slicer_plaat: null };
    const basis = { ...leeg, id: Number.isInteger(r.id) ? r.id : null, type: r.type, omschrijving: tekst(r.omschrijving),
      handmatig_bedrag: nietNegatief(r.handmatig_bedrag, `${nr}: eindbedrag`) };
    if (r.type === 'printen') {
      // artikel_id bij een printregel = eindproduct (enkel bij een dossier
      // "Eigen product": de goede stuks gaan naar de voorraad, stap 6c)
      return { ...basis, afbeelding: afbeelding(r.afbeelding, nr),
        // slicerbestand (bijlage van dit dossier) + plaat, 28-09
        slicer_bijlage_id: id(r.slicer_bijlage_id, 'slicerbestand'), slicer_plaat: r.slicer_bijlage_id ? id(r.slicer_plaat, 'plaat') : null,
        aantal: aantal(r.aantal, nr), printer_id: id(r.printer_id, 'printer'), artikel_id: id(r.artikel_id, 'eindproduct'),
        tijd_min: nietNegatief(r.tijd_min, `${nr}: printtijd`) ?? 0,
        voorbereiding_min: nietNegatief(r.voorbereiding_min, `${nr}: voorbereiding`),
        nabewerking_min: nietNegatief(r.nabewerking_min, `${nr}: nabewerking`),
        materialen: (Array.isArray(r.materialen) ? r.materialen : []).map(m => {
          const a = id(m?.artikel_id, 'filament'), f = id(m?.filament_type_id, 'prijsgroep');
          if (!a === !f) throw new DomeinFout(`${nr}: kies per kleur een filament of een prijsgroep`);
          return { artikel_id: a, filament_type_id: f, gram: nietNegatief(m.gram, `${nr}: gewicht`) ?? 0 };
        }) };
    }
    if (r.type === 'ontwerp' || r.type === 'aanpassing') {
      return { ...basis, minuten: nietNegatief(r.minuten, `${nr}: minuten`) ?? 0, tarief: nietNegatief(r.tarief, `${nr}: tarief`) };
    }
    if (r.type === 'artikel') return { ...basis, artikel_id: id(r.artikel_id, 'artikel'), aantal: aantal(r.aantal, nr) };
    return { ...basis, bedrag: nietNegatief(r.bedrag, `${nr}: bedrag`) ?? 0, per_stuk: r.per_stuk ? 1 : 0,
      aantal: r.per_stuk ? aantal(r.aantal, nr) : null };
  });
}

// ── regels bewaren: bestaande id's behouden (leveringen/printopdrachten
// verwijzen er later naar), nieuwe toevoegen, weggelaten regels schrappen.
const KOL = ['type', 'omschrijving', 'aantal', 'printer_id', 'tijd_min', 'voorbereiding_min', 'nabewerking_min',
  'minuten', 'tarief', 'artikel_id', 'bedrag', 'per_stuk', 'handmatig_bedrag', 'afbeelding', 'slicer_bijlage_id', 'slicer_plaat'];
export function bewaarRegels(db, dossierId, regels) {
  const soort = db.prepare('SELECT soort FROM dossiers WHERE id = ?').get(dossierId)?.soort;
  for (const [i, r] of regels.entries()) {
    if (r.type !== 'printen' || !r.artikel_id) continue;
    if (soort !== 'eigen') { r.artikel_id = null; continue; }
    const a = db.prepare('SELECT type, zelf_geprint, naam FROM artikelen WHERE id = ?').get(r.artikel_id);
    if (!a || a.type !== 'artikel' || !a.zelf_geprint) throw new DomeinFout(`Regel ${i + 1}: kies als eindproduct een artikel dat we zelf printen`);
  }
  // slicerbestand: enkel een (nog bestaande) bijlage van DIT dossier; anders
  // vervalt de koppeling (bv. regels teruggezet uit een oude offerte)
  const bijlage = db.prepare(`SELECT 1 FROM bijlagen WHERE id = ? AND entiteit = 'dossier' AND entiteit_id = ?`);
  for (const r of regels) {
    if (r.slicer_bijlage_id && !bijlage.get(r.slicer_bijlage_id, dossierId)) { r.slicer_bijlage_id = null; r.slicer_plaat = null; }
  }
  controleerGeleverd(db, dossierId, regels);
  const opdrachtenWeg = controleerPrintopdrachten(db, dossierId, regels);
  wisOpdrachtenVanRegels(db, opdrachtenWeg);
  const bestaand = new Set(db.prepare('SELECT id FROM dossier_regels WHERE dossier_id = ?').all(dossierId).map(r => r.id));
  const behouden = new Set();
  const upd = db.prepare(`UPDATE dossier_regels SET volgorde = ?, ${KOL.map(k => `${k} = ?`).join(', ')} WHERE id = ?`);
  const ins = db.prepare(`INSERT INTO dossier_regels (dossier_id, volgorde, ${KOL.join(', ')}) VALUES (?, ?, ${KOL.map(() => '?').join(', ')})`);
  const wisMat = db.prepare('DELETE FROM dossier_regel_materialen WHERE regel_id = ?');
  const insMat = db.prepare('INSERT INTO dossier_regel_materialen (regel_id, volgorde, artikel_id, filament_type_id, gram) VALUES (?,?,?,?,?)');
  regels.forEach((r, i) => {
    let rid;
    if (r.id && bestaand.has(r.id) && !behouden.has(r.id)) {
      upd.run(i, ...KOL.map(k => r[k]), r.id); rid = r.id; wisMat.run(rid);
    } else {
      rid = Number(ins.run(dossierId, i, ...KOL.map(k => r[k])).lastInsertRowid);
    }
    behouden.add(rid);
    r.materialen.forEach((m, k) => insMat.run(rid, k, m.artikel_id, m.filament_type_id, m.gram));
    // werkelijke uren/kWh horen enkel bij een printregel
    if (r.type !== 'printen') db.prepare('UPDATE dossier_regels SET werkelijk_uren = NULL, werkelijk_kwh = NULL WHERE id = ?').run(rid);
  });
  const del = db.prepare('DELETE FROM dossier_regels WHERE id = ?');
  for (const oud of bestaand) if (!behouden.has(oud)) del.run(oud);
}

// ── lezen ───────────────────────────────────────────────────────────────
export function leesRegelsVan(db, dossierId) {
  const regels = db.prepare(`SELECT id, ${KOL.join(', ')}, werkelijk_uren, werkelijk_kwh,
    (SELECT b.bestandsnaam FROM bijlagen b WHERE b.id = dossier_regels.slicer_bijlage_id) AS slicer_bestandsnaam
    FROM dossier_regels WHERE dossier_id = ? ORDER BY volgorde, id`).all(dossierId);
  const mat = db.prepare('SELECT artikel_id, filament_type_id, gram FROM dossier_regel_materialen WHERE regel_id = ? ORDER BY volgorde, id');
  return regels.map(({ werkelijk_uren, werkelijk_kwh, ...r }) => ({ ...r, per_stuk: !!r.per_stuk,
    ...(r.type === 'printen' ? { werkelijk: { uren: werkelijk_uren, kwh: werkelijk_kwh } } : {}),
    materialen: r.type === 'printen' ? mat.all(r.id).map(m => ({
      ...(m.artikel_id ? { artikel_id: m.artikel_id } : { filament_type_id: m.filament_type_id }), gram: m.gram })) : [] }));
}

export function berekenDossier(db, regels, stand = 'schatting', tarieven = null) {
  try { return berekenMetDb(db, regels, { stand, tarieven }); }
  catch (e) { return { fout: e.message, totaal: null, volledig: false, regels: [] }; }
}

const KLANTNAAM = `CASE WHEN k.type = 'zakelijk' AND NULLIF(k.bedrijfsnaam,'') IS NOT NULL THEN k.bedrijfsnaam
  ELSE TRIM(COALESCE(k.voornaam,'') || ' ' || COALESCE(k.naam,'')) END`;

export function leesDossier(db, dossierId) {
  const d = db.prepare(`SELECT d.*, ${KLANTNAAM} AS klant, k.gearchiveerd AS klant_gearchiveerd
    FROM dossiers d LEFT JOIN klanten k ON k.id = d.klant_id WHERE d.id = ?`).get(dossierId);
  if (!d) return null;
  const regels = leesRegelsVan(db, dossierId);
  const berekening = berekenDossier(db, regels);
  const klant_gegevens = d.klant_id ? db.prepare(`SELECT type, naam, voornaam, bedrijfsnaam, email, telefoon, gsm, straat, huisnummer,
    postcode, gemeente, land, btw_nummer, peppol_id FROM klanten WHERE id = ?`).get(d.klant_id) : null;
  const offertes = offertesVan(db, dossierId);
  const offerte = laatsteVerstuurde(offertes);
  const werkbon = werkbonVan(db, dossierId);
  const basis = { ...d, klant_gegevens };
  // Werkbon (domeinmodel, bevestigd 23-09; rechtgezet in 6a): MET aanvaarde
  // offerte blijft de offerteprijs staan en dient de meting enkel voor de
  // marge-analyse; ZONDER offerte rekent de werkbon met de metingen
  // (werkelijke tijd en gemeten kWh).
  const aanvaardeOfferte = offertes.find(o => o.aanvaard_op) || null;
  // Stap 6b: werkelijke tijd en kWh per printregel komen uit de GESLAAGDE
  // runs van de printopdrachten (optie A, 25-09). Zelf ingevulde waarden
  // (Werkbon → werkelijk verbruik) gaan voor: correctie, of een regel zonder
  // gekoppelde runs. Mislukte pogingen = kost voor jou (marge-analyse).
  const gemeten = metingenPerRegel(db, dossierId);
  for (const r of regels) if (r.type === 'printen') r.gemeten = gemeten.get(r.id) || null;
  const regelsWerkelijk = regels.map(({ gemeten: g, ...r }) => (r.type !== 'printen' ? r : { ...r, werkelijk: {
    uren: r.werkelijk?.uren ?? (g?.geslaagd.runs ? g.geslaagd.uren : null),
    kwh: r.werkelijk?.kwh ?? (g?.geslaagd.runs && !g.geslaagd.kwh_onbekend ? g.geslaagd.kwh : null) } }));
  if (werkbon && !werkbon.definitief_op) {
    const metingen = berekenDossier(db, regelsWerkelijk, 'werkelijk');
    werkbon.berekening = metingen;                       // kost volgens de metingen
    if (aanvaardeOfferte) {
      Object.assign(werkbon, { basis: 'offerte', offerte: aanvaardeOfferte.weergave, bedrag: aanvaardeOfferte.totaal, volledig: true,
        concept_document: aanvaardeOfferte.document });
    } else {
      Object.assign(werkbon, { basis: 'metingen', offerte: null, bedrag: metingen.totaal, volledig: !!metingen.volledig,
        concept_document: metingen.regels?.length ? documentInhoud(db, basis, metingen) : null });
    }
  } else if (werkbon) {
    Object.assign(werkbon, { bedrag: werkbon.totaal, volledig: true });
  }
  // Nog geen werkbon: afrekenen maakt hem zelf (25-09). Wat hij dan zou
  // tonen, voor het standaardbedrag in het afrekenvenster.
  const zonder_werkbon = werkbon || d.soort !== 'klant' || d.afgerekend_op ? null
    : aanvaardeOfferte ? { bedrag: aanvaardeOfferte.totaal, volledig: true }
    : (m => ({ bedrag: m.totaal, volledig: !!m.volledig }))(berekenDossier(db, regelsWerkelijk, 'werkelijk'));
  // Overnamefiche: wat er afgerekend wordt = de werkbon (definitief of concept), anders de schatting.
  const overname = werkbon?.document || werkbon?.concept_document
    || (berekening.regels?.length ? documentInhoud(db, basis, berekening) : null);
  // Wijken de regels af van de aanvaarde offerte? (werkbon: "regels terugzetten")
  const aanvaard = offertes.find(o => o.aanvaard_op);
  // afbeelding en slicerbestand tellen niet mee (offertes van vóór 28-09 hebben ze niet)
  const zonderWerkelijk = l => JSON.stringify(l.map(({ id: _i, werkelijk: _w, gemeten: _g, afbeelding: _a, slicer_bijlage_id: _s, slicer_plaat: _p, slicer_bestandsnaam: _n, ...x }) => x));
  const wijkt_af_van_offerte = !!aanvaard && zonderWerkelijk(aanvaard.regels_api || []) !== zonderWerkelijk(regels);
  const lever_lijst = d.soort === 'klant' ? leverbaar(db, dossierId, regels) : [];
  const lever = leverStatus(lever_lijst);
  const leveringen = leveringenVan(db, dossierId);
  const productie = productieOverzicht(db, dossierId, regels);
  const prod = productie.status;
  const opts = { aantalRegels: regels.length, offerte, werkbon, verstuurdeOffertes: offertes.filter(o => o.verstuurd_op).length, lever, leveringen: leveringen.length,
    prod, printopdrachten: productie.aantal_opdrachten };
  // samenvoegen (29-09): waarin dit dossier opging, of wat hierin opging
  const samengevoegd_in_nummer = d.samengevoegd_in ? db.prepare('SELECT nummer FROM dossiers WHERE id = ?').get(d.samengevoegd_in)?.nummer ?? null : null;
  const samengevoegd_uit = db.prepare('SELECT id, nummer, titel, samengevoegd_op FROM dossiers WHERE samengevoegd_in = ? ORDER BY id').all(dossierId);
  const uit = { ...d, klant_gegevens, samengevoegd_in_nummer, samengevoegd_uit, fase: faseVan(d, { offerte, lever, prod }), stappen: stappenVan(d, { lever, prod }), acties: actiesVan(d, opts),
    leverbaar: lever_lijst, lever_status: lever, leveringen, productie,
    regels, berekening, offertes: offertes.map(({ regels_api: _r, document: _doc, ...o }) => o), werkbon, zonder_werkbon, wijkt_af_van_offerte, overname };
  // afgerekend via een losse verkoop (26-09): enkel daar ongedaan te maken
  uit.afgerekend_via = db.prepare(`SELECT v.id, v.nummer, v.gemaild_op, v.soort, v.betaald_op, v.vervaldatum FROM verkoop_regels vr JOIN verkopen v ON v.id = vr.verkoop_id
    WHERE vr.dossier_id = ? AND v.geannuleerd_op IS NULL`).get(dossierId) || null;
  // afrekening én betaling (factuur, 29-09) lopen via die verkoop
  if (uit.afgerekend_via) uit.acties = { ...uit.acties, afrekening_ongedaan: false, betaling_ongedaan: false, betaald: false };
  uit.volgende_stap = volgendeStap(uit);
  return uit;
}

// ── Volgende stap (25-09): één zin + één knop bovenaan het dossier, zodat je
// niet hoeft te zoeken wat er nu moet gebeuren. Afgeleid uit het dossier
// zoals leesDossier het teruggeeft. `soort` bepaalt de knop in de frontend;
// `extra` zijn optionele tips (bv. leveren).
const euro2 = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nlGetal = v => String(Math.round(Number(v) * 1000) / 1000).replace('.', ',');
// Regels gewijzigd na een aanvaarde offerte (29-09): afrekenen gebruikt de
// offerteprijs, dus wat erbij kwam zou niet aangerekend worden.
export function afwijking(d) {
  const o = d.wijkt_af_van_offerte && (d.offertes || []).find(x => x.aanvaard_op);
  if (!o) return [];
  return [`Let op: de regels wijken af van de aanvaarde offerte ${o.weergave}. Afgerekend wordt de offerteprijs (${euro2(o.totaal)}), niet de regels (${euro2(d.berekening?.totaal ?? 0)}). Kwam er iets bij? Maak het antwoord op de offerte ongedaan en stuur een nieuwe versie. Per ongeluk gewijzigd? Zet de regels terug (tab Werkbon).`];
}

export function volgendeStap(d) {
  const klant = d.soort === 'klant';
  const extra = [];
  if (klant && ['geen', 'deels'].includes(d.lever_status) && d.fase !== 'geannuleerd') extra.push('Leveren (pakbon) kan nog, maar is niet verplicht.');
  if (d.fase === 'samengevoegd') {
    return { soort: 'samengevoegd', dossier_id: d.samengevoegd_in, tekst: `Samengevoegd in ${d.samengevoegd_in_nummer || 'een ander dossier'}${d.samengevoegd_op ? ` op ${String(d.samengevoegd_op).split('-').reverse().join('-')}` : ''}: de regels, printopdrachten, leveringen en bijlagen staan daar.`, extra: [] };
  }
  if (d.fase === 'geannuleerd') return { soort: 'geannuleerd', tekst: 'Dit dossier is geannuleerd: niets af te rekenen of te leveren.', extra: [] };
  // afgerekend via een losse verkoop (26-09)
  if (d.afgerekend_via) {
    const v = d.afgerekend_via;
    const fac = v.soort === 'factuur';
    // 30-09: een bonnetje gaat niet meer naar Accountable (zelf ingeven)
    if (!v.gemaild_op && fac) return { soort: 'verkoop_mailen', tekst: `Afgerekend via ${v.nummer} (losse verkoop), maar ${fac ? 'die factuur' : 'dat bonnetje'} is nog NIET naar Accountable gemaild. Open de verkoop en mail ${fac ? 'ze' : 'het'}.`, extra: [], verkoop_id: v.id };
    if (fac && !v.betaald_op) return { soort: 'verkoop_mailen', tekst: `Afgerekend via ${v.nummer} (losse verkoop)${v.vervaldatum ? `, vervalt op ${v.vervaldatum.split('-').reverse().join('-')}` : ''}. Nog te doen: de factuur op betaald zetten in de verkoop zodra het geld binnen is.`, extra, verkoop_id: v.id };
    return { soort: 'afgerond', tekst: `Afgerond: afgerekend via ${v.nummer} (losse verkoop)${v.gemaild_op ? ', naar Accountable gemaild' : ''}${fac ? ' en betaald' : ''}.`,
      extra: v.gemaild_op ? extra : [...extra, 'Zet het bonnetje zelf in Accountable (dagontvangsten), als dat nog niet gebeurde.'], verkoop_id: v.id };
  }
  // bonnetje van het ERP dat nog niet bij Accountable is (mailen mislukt, 26-09)
  // (29-09) ook een factuur van het ERP
  // 30-09: enkel een factuur; een bonnetje zet je zelf in Accountable
  if (isErpFactuur(d) && !d.afrekening_gemaild_op) {
    return { soort: 'bonnetje_mailen', tekst: isErpFactuur(d)
      ? `${d.afgerekend_nummer} is gemaakt, maar nog NIET naar Accountable gemaild. Mail ze nu, anders ontbreekt ze in je inkomsten.`
      : `${d.afgerekend_nummer} is gemaakt, maar nog NIET naar Accountable gemaild. Mail het nu, anders ontbreekt het in je dagontvangstenboek.`, extra: [] };
  }
  // afgerekend of gratis, maar een begonnen levering of artikelen uit
  // voorraad nog niet geleverd (29-09): dan is het nog niet "klaar"
  const rest = klant ? nogTeLeveren(d.leverbaar || [], d.lever_status) : [];
  if (rest.length && (d.fase === 'betaald' || d.fase === 'gratis')) {
    return { soort: 'leveren', tekst: `${d.fase === 'gratis' ? 'Gratis geleverd' : 'Afgerekend en betaald'}, maar nog niet alles geleverd: ${rest.join(', ')}. Lever de rest via het tabblad Leveringen (pakbon).`, extra: [] };
  }
  if (d.fase === 'betaald') {
    const klantMail = d.afrekening_klant_mail ? ` (naar ${d.afrekening_klant_mail} gemaild)` : '';
    return { soort: 'afgerond', tekst: !isErpDocument(d) ? 'Afgerond: afgerekend en betaald.'
      : d.afrekening_gemaild_op ? `Afgerond: ${d.afgerekend_nummer} gemaakt en naar Accountable gemaild${d.afrekening_klant_mail ? ` (ook naar ${d.afrekening_klant_mail})` : ''}.`
      : `Afgerond: ${d.afgerekend_nummer} gemaakt${klantMail}.`,
      // 30-09: bonnetjes gaan niet meer naar inkomsten@ (daar werden ze een factuur)
      extra: isErpBonnetje(d) && !d.afrekening_gemaild_op ? [...extra, 'Zet het bonnetje zelf in Accountable (dagontvangsten), als dat nog niet gebeurde. De Accountable-import toont het daarna als "in orde".'] : extra };
  }
  if (d.fase === 'gratis') {
    return { soort: 'afgerond', tekst: `Gratis geleverd${d.gratis_waarde != null ? ` (waarde ${euro2(d.gratis_waarde)})` : ''}: niets af te rekenen. Telt niet als omzet; je kost staat in Financiën → Marges.`, extra };
  }
  if (d.fase === 'afgerekend') {
    const erp = isErpFactuur(d);
    const vervallen = erp && d.afrekening_vervaldatum && d.afrekening_vervaldatum < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
    const tips = [...extra, ...(rest.length ? [`Nog te leveren: ${rest.join(', ')}.`] : []),
      // Belgische btw-plichtige klant: factuur via Peppol (verplicht sinds 2026)
      ...(erp && peppolVerplicht(d.klant_gegevens) ? ['Belgische btw-plichtige klant: verstuur deze factuur via Peppol vanuit Accountable (Inkomsten → de factuur → versturen via Peppol) zodra ze daar ingelezen is.'] : [])];
    return { soort: 'betaling', tekst: `${erp ? `${d.afgerekend_nummer} gemaakt en naar Accountable gemaild` : `Afgerekend met ${afrekeningWeergave(d.afgerekend_soort, d.afgerekend_nummer)}`}${erp && d.afrekening_vervaldatum ? `; ${vervallen ? 'VERVALLEN op' : 'vervalt op'} ${d.afrekening_vervaldatum.split('-').reverse().join('-')}` : ''}. Nog te doen: als betaald markeren zodra het geld binnen is (of via de Accountable-import).`,
      extra: tips };
  }
  if (!d.regels.length) return { soort: 'regels', tekst: 'Voeg eerst regels toe: wat moet er gebeuren (printen, ontwerp, aanpassing, artikel, extra)?', extra: [] };
  const offerte = (d.offertes || []).filter(o => o.verstuurd_op).sort((a, b) => b.versie - a.versie)[0];
  if (klant && offerte && !offerte.aanvaard_op && !offerte.geweigerd_op && !d.gestart_op && !d.productie?.aantal_opdrachten) {
    return { soort: 'offerte_wacht', tekst: `Offerte ${offerte.weergave} is verstuurd. Wacht op het antwoord van de klant: zet ze op aanvaard (start dan vanzelf) of geweigerd.`, extra: [] };
  }
  if (d.acties?.starten) {
    const print = d.regels.some(r => r.type === 'printen');
    return { soort: 'starten', tekst: klant
      ? `Klaar om te starten: maakt de werkbon${print ? ' en een printopdracht per printregel' : ''}.${d.offertes?.length ? '' : ' Wil de klant eerst een prijs? Maak dan een offerte (tab Offertes).'}`
      : 'Klaar om te starten: maakt een printopdracht per printregel.', extra: [] };
  }
  const p = d.productie;
  if (p?.regels?.length && p.status !== 'klaar') {
    const run = p.te_koppelen_runs?.[0];
    if (run) return { soort: 'koppelen', tekst: `Er staat een run op ${run.printer} die nog niet gekoppeld is.`, run, extra: [] };
    const ops = p.regels.flatMap(r => r.opdrachten);
    const bevestig = ops.find(o => o.status === 'te_bevestigen');
    if (bevestig) return { soort: 'bevestigen', tekst: `De print "${bevestig.naam}" is klaar: bevestig hoeveel stuks goed zijn.`, opdracht_id: bevestig.id, extra: [] };
    const zonder = p.regels.find(r => r.te_plannen > 0 && !r.printer_id);
    if (zonder && d.gestart_op) return { soort: 'printer_kiezen', tekst: `Kies een printer voor "${zonder.omschrijving || 'Printwerk'}" (tab Regels): dan komt de printopdracht vanzelf.`, extra: [] };
    const mislukt = ops.find(o => o.status === 'mislukt');
    if (mislukt) return { soort: 'herprint', tekst: `De laatste poging van "${mislukt.naam}" op ${mislukt.printer} is mislukt of gestopt. Start een herprint (koppel de nieuwe run aan dezelfde opdracht), of annuleer de printopdracht als ze niet meer nodig is.`, extra: [] };
    const bezig = ops.find(o => o.status === 'bezig');
    if (bezig) return { soort: 'bezig', tekst: `Aan het printen: "${bezig.naam}" op ${bezig.printer}. Als de print klaar is, bevestig je hier het aantal goede stuks.`, extra: [] };
    const gepland = ops.find(o => o.status === 'gepland');
    if (gepland) return { soort: 'wachtrij', tekst: `"${gepland.naam}" staat in de wachtrij van ${gepland.printer}. Start de print op de printer; de run verschijnt dan vanzelf om te koppelen.`, extra: [] };
    const tekort = p.regels.find(r => r.goed < r.besteld);
    if (tekort) return { soort: 'plannen', tekst: `Voor "${tekort.omschrijving || 'Printwerk'}" zijn nog ${nlGetal(tekort.besteld - tekort.goed)} stuks nodig: plan een printopdracht (tab Productie).`, extra: [] };
  }
  if (klant) {
    const reden = !(d.werkbon || d.zonder_werkbon)?.volledig ? ' Eerst moeten alle regels berekend kunnen worden.' : '';
    return { soort: 'afrekenen', tekst: `${p?.status === 'klaar' ? 'Alles is geprint. ' : ''}Nog af te rekenen: ${d.klant_gegevens?.type === 'zakelijk' ? 'maak de factuur ("Factuur maken": het ERP mailt ze naar Accountable), of maak toch een bonnetje' : 'maak het bonnetje ("Bonnetje maken"; zelf in Accountable ingeven), of een factuur ("Factuur maken": het ERP mailt ze naar Accountable)'}.${reden}`,
      kan: !reden, extra: [...extra, ...afwijking(d), 'Krijgt de klant het zonder te betalen? Kies "Gratis geleverd". Gaat de opdracht niet door? "Dossier annuleren".'] };
  }
  return { soort: 'klaar', tekst: d.soort === 'eigen' ? 'Alles is geprint; de goede stuks staan in voorraad.' : 'Alles is geprint.', extra: [] };
}

export function leesDossiers(db, { archief = '0', klant_id = null } = {}) {
  const waar = [];
  const par = [];
  if (archief === '1') waar.push('d.gearchiveerd = 1'); else if (archief !== 'alle') waar.push('d.gearchiveerd = 0');
  if (klant_id) { waar.push('d.klant_id = ?'); par.push(klant_id); }
  const rijen = db.prepare(`SELECT d.*, ${KLANTNAAM} AS klant,
      (SELECT COUNT(*) FROM dossier_regels r WHERE r.dossier_id = d.id) AS aantal_regels
    FROM dossiers d LEFT JOIN klanten k ON k.id = d.klant_id
    ${waar.length ? `WHERE ${waar.join(' AND ')}` : ''} ORDER BY d.id DESC`).all(...par);
  const tarieven = getTarieven(db);   // één keer voor de hele lijst
  return rijen.map(d => {
    const b = d.aantal_regels ? berekenDossier(db, leesRegelsVan(db, d.id), 'schatting', tarieven) : { totaal: 0, volledig: true };
    const offerte = laatsteVerstuurde(offertesVan(db, d.id));
    const lever = d.soort === 'klant' ? leverStatusVan(db, d.id) : null;
    const prod = productieVan(db, d.id);
    return { ...d, fase: faseVan(d, { offerte, lever, prod }), lever_status: lever, prod_status: prod, totaal: b.totaal, volledig: b.volledig };
  });
}

// ── afrekening (verwijzing naar Accountable) ────────────────────────────
export function leesAfrekening(body, totaal) {
  const soort = body?.soort;
  if (soort !== 'factuur' && soort !== 'bonnetje') throw new DomeinFout('Kies factuur of bonnetje');
  const nummer = tekst(body?.nummer);
  if (!nummer) throw new DomeinFout(`Vul het nummer van ${soort === 'factuur' ? 'de factuur' : 'het bonnetje'} uit Accountable in`);
  if (!datumOk(body?.datum)) throw new DomeinFout('Vul een geldige datum in');
  const bedrag = body?.bedrag === undefined || body?.bedrag === '' || body?.bedrag === null ? totaal : nietNegatief(body.bedrag, 'Bedrag');
  if (bedrag === null) throw new DomeinFout('Vul het bedrag in');
  return { soort, nummer, datum: body.datum, bedrag };
}
export { datumOk };

// Antwoord naar de browser (29-09): de afbeelding van een printregel enkel
// bij de regels zelf, niet nog eens in de berekening, het overnamedocument en
// de werkbon (scheelt ± 2/3 van de grootte; een dossier in productie ververst
// elke 15 s). PDF's lezen het dossier rechtstreeks en houden hun afbeeldingen.
const zonderAfbeelding = doc => (Array.isArray(doc?.regels) ? { ...doc, regels: doc.regels.map(({ afbeelding: _a, ...r }) => r) } : doc);
export function slankDossier(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.regels) || !d.berekening) return d;
  return { ...d, berekening: zonderAfbeelding(d.berekening), overname: zonderAfbeelding(d.overname),
    werkbon: d.werkbon && { ...d.werkbon, berekening: zonderAfbeelding(d.werkbon.berekening),
      concept_document: zonderAfbeelding(d.werkbon.concept_document), document: zonderAfbeelding(d.werkbon.document) } };
}
