// ═══════════════════════════════════════════════════════════════════════
// DOSSIERS (stap 5a) — kop, regels, afrekening als verwijzing
// ═══════════════════════════════════════════════════════════════════════
import { DomeinFout } from './hulp.js';
import { getal } from './rekenmotor.js';
import { berekenMetDb } from './berekening.js';
import { faseVan, actiesVan, stappenVan } from './status/dossier.js';
import { offertesVan, laatsteVerstuurde, werkbonVan, documentInhoud } from './documenten.js';
import { leverbaar, leverStatus, leverStatusVan, leveringenVan, controleerGeleverd } from './leveringen.js';
import { productieVan, productieOverzicht, metingenPerRegel, controleerPrintopdrachten } from '../productie/opdrachten.js';

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
const datumOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(d));

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
      minuten: null, tarief: null, artikel_id: null, bedrag: null, per_stuk: 0, materialen: [] };
    const basis = { ...leeg, id: Number.isInteger(r.id) ? r.id : null, type: r.type, omschrijving: tekst(r.omschrijving),
      handmatig_bedrag: nietNegatief(r.handmatig_bedrag, `${nr}: eindbedrag`) };
    if (r.type === 'printen') {
      // artikel_id bij een printregel = eindproduct (enkel bij een dossier
      // "Eigen product": de goede stuks gaan naar de voorraad, stap 6c)
      return { ...basis, aantal: nietNegatief(r.aantal, `${nr}: aantal`) ?? 1, printer_id: id(r.printer_id, 'printer'), artikel_id: id(r.artikel_id, 'eindproduct'),
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
    if (r.type === 'artikel') return { ...basis, artikel_id: id(r.artikel_id, 'artikel'), aantal: nietNegatief(r.aantal, `${nr}: aantal`) ?? 1 };
    return { ...basis, bedrag: nietNegatief(r.bedrag, `${nr}: bedrag`) ?? 0, per_stuk: r.per_stuk ? 1 : 0,
      aantal: r.per_stuk ? (nietNegatief(r.aantal, `${nr}: aantal`) ?? 1) : null };
  });
}

// ── regels bewaren: bestaande id's behouden (leveringen/printopdrachten
// verwijzen er later naar), nieuwe toevoegen, weggelaten regels schrappen.
const KOL = ['type', 'omschrijving', 'aantal', 'printer_id', 'tijd_min', 'voorbereiding_min', 'nabewerking_min',
  'minuten', 'tarief', 'artikel_id', 'bedrag', 'per_stuk', 'handmatig_bedrag'];
export function bewaarRegels(db, dossierId, regels) {
  const soort = db.prepare('SELECT soort FROM dossiers WHERE id = ?').get(dossierId)?.soort;
  for (const [i, r] of regels.entries()) {
    if (r.type !== 'printen' || !r.artikel_id) continue;
    if (soort !== 'eigen') { r.artikel_id = null; continue; }
    const a = db.prepare('SELECT type, zelf_geprint, naam FROM artikelen WHERE id = ?').get(r.artikel_id);
    if (!a || a.type !== 'artikel' || !a.zelf_geprint) throw new DomeinFout(`Regel ${i + 1}: kies als eindproduct een artikel dat we zelf printen`);
  }
  controleerGeleverd(db, dossierId, regels);
  controleerPrintopdrachten(db, dossierId, regels);
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
  const regels = db.prepare(`SELECT id, ${KOL.join(', ')}, werkelijk_uren, werkelijk_kwh FROM dossier_regels WHERE dossier_id = ? ORDER BY volgorde, id`).all(dossierId);
  const mat = db.prepare('SELECT artikel_id, filament_type_id, gram FROM dossier_regel_materialen WHERE regel_id = ? ORDER BY volgorde, id');
  return regels.map(({ werkelijk_uren, werkelijk_kwh, ...r }) => ({ ...r, per_stuk: !!r.per_stuk,
    ...(r.type === 'printen' ? { werkelijk: { uren: werkelijk_uren, kwh: werkelijk_kwh } } : {}),
    materialen: r.type === 'printen' ? mat.all(r.id).map(m => ({
      ...(m.artikel_id ? { artikel_id: m.artikel_id } : { filament_type_id: m.filament_type_id }), gram: m.gram })) : [] }));
}

export function berekenDossier(db, regels, stand = 'schatting') {
  try { return berekenMetDb(db, regels, { stand }); }
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
    postcode, gemeente, btw_nummer, peppol_id FROM klanten WHERE id = ?`).get(d.klant_id) : null;
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
  // Overnamefiche: wat er afgerekend wordt = de werkbon (definitief of concept), anders de schatting.
  const overname = werkbon?.document || werkbon?.concept_document
    || (berekening.regels?.length ? documentInhoud(db, basis, berekening) : null);
  // Wijken de regels af van de aanvaarde offerte? (werkbon: "regels terugzetten")
  const aanvaard = offertes.find(o => o.aanvaard_op);
  const zonderWerkelijk = l => JSON.stringify(l.map(({ id: _i, werkelijk: _w, gemeten: _g, ...x }) => x));
  const wijkt_af_van_offerte = !!aanvaard && zonderWerkelijk(aanvaard.regels_api || []) !== zonderWerkelijk(regels);
  const lever_lijst = d.soort === 'klant' ? leverbaar(db, dossierId, regels) : [];
  const lever = leverStatus(lever_lijst);
  const leveringen = leveringenVan(db, dossierId);
  const productie = productieOverzicht(db, dossierId, regels);
  const prod = productie.status;
  const opts = { aantalRegels: regels.length, offerte, werkbon, verstuurdeOffertes: offertes.filter(o => o.verstuurd_op).length, lever, leveringen: leveringen.length,
    prod, printopdrachten: productie.aantal_opdrachten };
  return { ...d, klant_gegevens, fase: faseVan(d, { offerte, lever, prod }), stappen: stappenVan(d, { lever, prod }), acties: actiesVan(d, opts),
    leverbaar: lever_lijst, lever_status: lever, leveringen, productie,
    regels, berekening, offertes: offertes.map(({ regels_api: _r, document: _doc, ...o }) => o), werkbon, wijkt_af_van_offerte, overname };
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
  return rijen.map(d => {
    const b = d.aantal_regels ? berekenDossier(db, leesRegelsVan(db, d.id)) : { totaal: 0, volledig: true };
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
