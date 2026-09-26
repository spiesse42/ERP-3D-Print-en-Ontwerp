// ═══════════════════════════════════════════════════════════════════════
// LOSSE VERKOOP (26-09) — tegel "Verkoop"
// ═══════════════════════════════════════════════════════════════════════
// Eén bonnetje met regels van vier soorten (claude/beslissingen-2026-09-26.md):
// - artikel         uit voorraad (FIFO uitgeboekt, reden "levering") of een dienst
// - dossier         één regel voor een klantdossier; prijs = werkbon, zonder
//                   aanvaarde offerte aanpasbaar. Het dossier wordt afgerekend
//                   (+ betaald) met HETZELFDE bonnetjesnummer.
// - printopdracht   een voltooide LOSSE printopdracht, hele opdracht; voorstel
//                   van de rekenmotor (stand werkelijk), aanpasbaar; maar één
//                   keer te verkopen
// - vrij            omschrijving + prijs, geen artikel, geen voorraad
// Alles in één transactie (nummer uit de reeks BON, zelfde teller als
// "Bonnetje maken" op een dossier). Het mailen gebeurt daarna in de route.
// Ongedaan = geannuleerd + voorraad terug op dezelfde partijen + afrekening van
// de dossiers ongedaan; het nummer blijft bezet (Accountable kreeg het al).
import { DomeinFout, rond, getBedrijfsgegevens, VIA_VERKOOP } from './hulp.js';
import { logGebeurtenis } from './historiek.js';
import { boekUit } from './voorraad.js';
import { volgendNummer, overzicht as nummerOverzicht } from './nummering.js';
import { leesDossier, berekenDossier } from './dossiers.js';
import { rekenAf, maakAfrekeningOngedaan } from './afrekening.js';
import { leesOpdracht } from '../productie/opdrachten.js';

const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tekst = v => { const t = String(v ?? '').trim(); return t || null; };
const r2 = v => Math.round((v || 0) * 100) / 100;
const leeg = v => v === undefined || v === null || v === '';
const getal = (v, wat, { strikt = false } = {}) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (strikt && n <= 0)) throw new DomeinFout(`${wat} moet een getal ${strikt ? 'groter dan 0' : 'vanaf 0'} zijn`);
  return rond(n);
};
const datumOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
export const vandaagLokaal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const SOORTEN = ['artikel', 'dossier', 'printopdracht', 'vrij'];

const ARTIKEL = `SELECT a.id, a.type, a.naam, a.verkoopprijs, a.gearchiveerd,
    CASE WHEN a.type = 'filament' THEN fm.naam || ' ' || mat.naam || ' · ' || k.naam ELSE a.naam END AS weergave,
    (SELECT COALESCE(SUM(aantal_resterend), 0) FROM voorraad_partijen p WHERE p.artikel_id = a.id) AS voorraad
  FROM artikelen a LEFT JOIN filament_types ft ON ft.id = a.filament_type_id LEFT JOIN filament_merken fm ON fm.id = ft.merk_id
  LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id LEFT JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.id = ?`;
const VERKOCHT = `SELECT v.id, v.nummer FROM verkoop_regels vr JOIN verkopen v ON v.id = vr.verkoop_id
  WHERE vr.printopdracht_id = ? AND v.geannuleerd_op IS NULL`;

export function leesDatum(v) {
  const datum = tekst(v) || vandaagLokaal();
  if (!datumOk(datum)) throw new DomeinFout('Vul een geldige datum in');
  if (datum > vandaagLokaal()) throw new DomeinFout('Een bonnetje kan niet in de toekomst liggen.');
  return datum;
}

// ── dossier als regel ────────────────────────────────────────────────────
// Bedrag = wat de werkbon wordt (aanvaarde offerte → offerteprijs, anders
// volgens de metingen). Enkel zonder aanvaarde offerte aanpasbaar.
export function dossierInfo(db, dossierId) {
  const d = leesDossier(db, Number(dossierId));
  if (!d) throw new DomeinFout('Onbekend dossier');
  if (d.soort !== 'klant') throw new DomeinFout(`${d.nummer} is geen klantopdracht: enkel een klantopdracht wordt afgerekend.`);
  if (!d.acties.afrekenen) throw new DomeinFout(`${d.nummer} is al afgerekend, gratis geleverd of geannuleerd.`);
  const wb = d.werkbon || d.zonder_werkbon;
  const offerte = d.werkbon ? d.werkbon.basis === 'offerte' : d.offertes.some(o => o.aanvaard_op);
  const waarschuwingen = [];
  if (!['klaar', 'deels', 'geleverd'].includes(d.fase) && d.productie?.aantal_opdrachten) waarschuwingen.push('Nog niet alles geprint.');
  if (d.lever_status === 'geen' || d.lever_status === 'deels') waarschuwingen.push(d.lever_status === 'deels' ? 'Deels geleverd.' : 'Nog niet geleverd.');
  return { d, id: d.id, nummer: d.nummer, titel: d.titel, klant_id: d.klant_id, klant: d.klant, fase: d.fase,
    bedrag: wb?.bedrag ?? null, volledig: !!wb?.volledig, offerte, waarschuwingen };
}

// ── losse printopdracht als regel ────────────────────────────────────────
// Voorstelprijs: dezelfde rekenmotor als een dossier, stand "werkelijk":
// printtijd en kWh van de GESLAAGDE runs, machinetarief van de printer,
// BMCU, filament van de opdracht, marges uit de tarieven.
export function printopdrachtVoorstel(db, o) {
  const runs = db.prepare(`SELECT gestart_op, geeindigd_op, kwh FROM printruns WHERE printopdracht_id = ? AND uitkomst = 'klaar'`).all(o.id);
  const uren = runs.reduce((t, r) => t + Math.max(0, Date.parse(r.geeindigd_op) - Date.parse(r.gestart_op)) / 3600e3, 0);
  const kwh = !runs.length || runs.some(r => r.kwh == null) ? null : runs.reduce((t, r) => t + r.kwh, 0);
  const mat = db.prepare('SELECT artikel_id, filament_type_id, gram FROM printopdracht_materialen WHERE printopdracht_id = ? ORDER BY volgorde, id').all(o.id)
    .map(m => (m.artikel_id ? { artikel_id: m.artikel_id, gram: m.gram } : { filament_type_id: m.filament_type_id, gram: m.gram }));
  const regel = { type: 'printen', omschrijving: o.naam, printer_id: o.printer_id, aantal: o.aantal_goed, tijd_min: Math.round(uren * 6000) / 100,
    voorbereiding_min: null, nabewerking_min: null, materialen: mat, werkelijk: { uren: Math.round(uren * 10000) / 10000, kwh } };
  const b = berekenDossier(db, [regel], 'werkelijk');
  const waarschuwingen = [];
  if (!mat.some(m => m.gram > 0)) waarschuwingen.push('Geen filament ingegeven: het materiaal is niet meegerekend (open de printopdracht → Filament).');
  if (kwh == null) waarschuwingen.push('Gemeten kWh ontbreekt: de elektriciteit is geschat.');
  const fout = b.volledig ? null : (b.fout || b.regels?.[0]?._berekend?.fout || 'niet te berekenen (bv. machinetarief van de printer ontbreekt)');
  return { voorstel: b.volledig ? r2(b.totaal) : null, fout, waarschuwingen };
}
function printopdrachtInfo(db, id) {
  const o = leesOpdracht(db, Number(id));
  if (!o) throw new DomeinFout('Onbekende printopdracht');
  if (o.dossier_regel_id) throw new DomeinFout(`"${o.naam}" hoort bij dossier ${o.dossier_nummer}: reken het dossier af.`);
  if (o.status !== 'voltooid') throw new DomeinFout(`Printopdracht "${o.naam}" is nog niet bevestigd (voltooid).`);
  if (!(o.aantal_goed > 0)) throw new DomeinFout(`Printopdracht "${o.naam}" heeft geen goede stuks.`);
  const verkocht = db.prepare(VERKOCHT).get(o.id);
  if (verkocht) throw new DomeinFout(`Printopdracht "${o.naam}" is al verkocht via ${verkocht.nummer}.`);
  return o;
}

// Wat je in "Nieuwe verkoop" kunt koppelen.
export function kandidaten(db) {
  const dossiers = db.prepare(`SELECT id FROM dossiers WHERE soort = 'klant' AND afgerekend_op IS NULL AND gratis_op IS NULL AND geannuleerd_op IS NULL
      AND gearchiveerd = 0 ORDER BY id DESC`).all()
    .map(({ id }) => { try { const { d: _d, ...x } = dossierInfo(db, id); return x; } catch { return null; } })
    .filter(Boolean);
  const printopdrachten = db.prepare(`SELECT o.id FROM printopdrachten o WHERE o.voltooid_op IS NOT NULL AND o.dossier_regel_id IS NULL AND o.aantal_goed > 0
      AND NOT EXISTS (SELECT 1 FROM verkoop_regels vr JOIN verkopen v ON v.id = vr.verkoop_id WHERE vr.printopdracht_id = o.id AND v.geannuleerd_op IS NULL)
      ORDER BY o.voltooid_op DESC, o.id DESC`).all()
    .map(({ id }) => {
      const o = leesOpdracht(db, id);
      return { id: o.id, naam: o.naam, printer: o.printer, soort: o.soort, voltooid_op: o.voltooid_op, aantal_goed: o.aantal_goed,
        productiekost_stuk: o.productiekost_stuk, ...printopdrachtVoorstel(db, o) };
    });
  return { dossiers, printopdrachten };
}

// ── invoer ───────────────────────────────────────────────────────────────
// → { datum, klant_id, omschrijving, regels: [{ soort, artikel_id, dossier_id, printopdracht_id, type, omschrijving, aantal, prijs_per_stuk, bedrag, berekend }], totaal }
// Controleert ALLES vóór er een nummer uitgegeven wordt (voorraad, dossiers
// afrekenbaar, printopdrachten vrij, prijzen).
export function leesVerkoop(db, body) {
  const datum = leesDatum(body?.datum);
  let klant_id = null;
  if (!leeg(body?.klant_id)) {
    klant_id = Number(body.klant_id);
    if (!Number.isInteger(klant_id) || !db.prepare('SELECT 1 FROM klanten WHERE id = ?').get(klant_id)) throw new DomeinFout('Onbekende klant');
  }
  const lijst = Array.isArray(body?.regels) ? body.regels.filter(r => r && (r.artikel_id || r.dossier_id || r.printopdracht_id || r.soort === 'vrij')) : [];
  if (!lijst.length) throw new DomeinFout('Voeg minstens één regel toe.');
  const nodig = new Map();      // artikel → totaal aantal (zelfde artikel op twee regels)
  const gezien = new Set();     // dossier/printopdracht maar één keer
  const regels = lijst.map((r, i) => {
    const nr = `Regel ${i + 1}`;
    const soort = r.soort || (r.dossier_id ? 'dossier' : r.printopdracht_id ? 'printopdracht' : 'artikel');
    if (!SOORTEN.includes(soort)) throw new DomeinFout(`${nr}: onbekend soort regel`);
    const basis = { soort, artikel_id: null, dossier_id: null, printopdracht_id: null, type: null, berekend: null };
    if (soort === 'dossier') {
      const x = dossierInfo(db, r.dossier_id);
      if (gezien.has(`d${x.id}`)) throw new DomeinFout(`${nr}: dossier ${x.nummer} staat al op dit bonnetje`);
      gezien.add(`d${x.id}`);
      if (!x.volledig || x.bedrag == null) throw new DomeinFout(`${nr}: dossier ${x.nummer} kan (nog) niet volledig berekend worden. Los dat eerst op in het dossier.`);
      if (x.klant_id) {
        if (klant_id && klant_id !== x.klant_id) throw new DomeinFout(`${nr}: dossier ${x.nummer} hoort bij een andere klant (${x.klant}).`);
        klant_id = x.klant_id;
      }
      let prijs = x.bedrag;
      if (!leeg(r.prijs_per_stuk)) {
        prijs = getal(r.prijs_per_stuk, `${nr}: prijs`);
        if (x.offerte && Math.abs(prijs - x.bedrag) > 0.005) throw new DomeinFout(`${nr}: dossier ${x.nummer} heeft een aanvaarde offerte; de prijs (${euro(x.bedrag)}) ligt vast.`);
      }
      return { ...basis, dossier_id: x.id, omschrijving: tekst(r.omschrijving) || `${x.titel} (dossier ${x.nummer})`, aantal: 1, prijs_per_stuk: prijs,
        bedrag: r2(prijs), berekend: x.bedrag };
    }
    if (soort === 'printopdracht') {
      const o = printopdrachtInfo(db, r.printopdracht_id);
      if (gezien.has(`p${o.id}`)) throw new DomeinFout(`${nr}: printopdracht "${o.naam}" staat al op dit bonnetje`);
      gezien.add(`p${o.id}`);
      const { voorstel } = printopdrachtVoorstel(db, o);
      const aantal = o.aantal_goed;
      let prijs;
      if (!leeg(r.prijs_per_stuk)) prijs = getal(r.prijs_per_stuk, `${nr}: prijs per stuk`);
      // op 2 decimalen, zodat aantal × prijs/stuk op het bonnetje exact het bedrag geeft
      else if (voorstel != null) prijs = r2(voorstel / aantal);
      else throw new DomeinFout(`${nr}: vul de prijs per stuk in (de prijs van "${o.naam}" kan niet berekend worden)`);
      return { ...basis, printopdracht_id: o.id, omschrijving: tekst(r.omschrijving) || o.naam, aantal, prijs_per_stuk: prijs,
        bedrag: r2(aantal * prijs), berekend: voorstel };
    }
    if (soort === 'vrij') {
      const oms = tekst(r.omschrijving);
      if (!oms) throw new DomeinFout(`${nr}: vul een omschrijving in`);
      const aantal = getal(r.aantal ?? 1, `${nr}: aantal`, { strikt: true });
      if (leeg(r.prijs_per_stuk)) throw new DomeinFout(`${nr}: vul de prijs per stuk in`);
      const prijs = getal(r.prijs_per_stuk, `${nr}: prijs per stuk`);
      return { ...basis, omschrijving: oms, aantal, prijs_per_stuk: prijs, bedrag: r2(aantal * prijs) };
    }
    const a = db.prepare(ARTIKEL).get(Number(r.artikel_id));
    if (!a) throw new DomeinFout(`${nr}: kies een artikel`);
    const aantal = getal(r.aantal ?? 1, `${nr}: aantal`, { strikt: true });
    if (leeg(r.prijs_per_stuk) && a.verkoopprijs == null) throw new DomeinFout(`${nr}: vul de prijs per stuk in (${a.weergave} heeft geen verkoopprijs)`);
    const prijs = leeg(r.prijs_per_stuk) ? rond(a.verkoopprijs) : getal(r.prijs_per_stuk, `${nr}: prijs per stuk`);
    if (a.type !== 'dienst') nodig.set(a.id, { a, n: (nodig.get(a.id)?.n || 0) + aantal });
    return { ...basis, artikel_id: a.id, type: a.type, omschrijving: tekst(r.omschrijving) || a.weergave, aantal, prijs_per_stuk: prijs, bedrag: r2(aantal * prijs) };
  });
  for (const { a, n } of nodig.values()) {
    if (n > a.voorraad + 1e-9) throw new DomeinFout(`Onvoldoende voorraad van ${a.weergave}: ${String(a.voorraad).replace('.', ',')} beschikbaar, ${String(n).replace('.', ',')} verkocht`);
  }
  const totaal = r2(regels.reduce((t, r) => t + r.bedrag, 0));
  return { datum, klant_id, omschrijving: tekst(body?.omschrijving), regels, totaal };
}

// Wat het bonnetje ZOU worden (venster/voorbeeld): nummer zonder het uit te geven.
export function voorstelNummer(db, datum) {
  return nummerOverzicht(db, Number(datum.slice(0, 4))).find(x => x.reeks === 'BON').voorbeeld;
}

export function maakVerkoop(db, v) {
  const nummer = volgendNummer(db, 'BON', { jaar: Number(v.datum.slice(0, 4)) });
  const id = Number(db.prepare('INSERT INTO verkopen (nummer, datum, klant_id, omschrijving, totaal) VALUES (?,?,?,?,?)')
    .run(nummer, v.datum, v.klant_id, v.omschrijving, v.totaal).lastInsertRowid);
  const ins = db.prepare(`INSERT INTO verkoop_regels (verkoop_id, volgorde, soort, artikel_id, dossier_id, printopdracht_id, omschrijving, aantal, prijs_per_stuk, bedrag, berekend)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  v.regels.forEach((r, k) => {
    const rid = Number(ins.run(id, k, r.soort, r.artikel_id, r.dossier_id, r.printopdracht_id, r.omschrijving, r.aantal, r.prijs_per_stuk, r.bedrag, r.berekend).lastInsertRowid);
    if (r.soort === 'artikel' && r.type !== 'dienst') {
      boekUit(db, { artikelId: r.artikel_id, aantal: r.aantal, reden: 'levering', bronType: 'verkoop_regel', bronId: rid, notitie: `Verkoop ${nummer}` });
    }
    if (r.soort === 'dossier') {
      rekenAf(db, leesDossier(db, r.dossier_id), {
        waarom: `bij de verkoop ${nummer}`,
        afrekening: () => ({ soort: 'bonnetje', nummer, datum: v.datum, bedrag: r.bedrag, pdf: false }),
        logTekst: a => `Afgerekend via ${nummer} (losse verkoop), ${euro(a.bedrag)}${r.berekend != null && Math.abs(r.berekend - a.bedrag) > 0.005 ? ` (berekend: ${euro(r.berekend)})` : ''}: meteen betaald`,
      });
    }
  });
  logGebeurtenis(db, 'verkoop', id, 'aangemaakt', `${nummer} gemaakt (${euro(v.totaal)}): verkocht en meteen betaald`
    + `${v.regels.some(r => r.soort === 'artikel' && r.type !== 'dienst') ? '; voorraad uitgeboekt' : ''}`
    + `${v.regels.some(r => r.soort === 'dossier') ? `; dossier${v.regels.filter(r => r.soort === 'dossier').length > 1 ? 's' : ''} afgerekend` : ''}`);
  return id;
}

const KLANTNAAM = `CASE WHEN k.type = 'zakelijk' AND NULLIF(k.bedrijfsnaam,'') IS NOT NULL THEN k.bedrijfsnaam
  ELSE TRIM(COALESCE(k.voornaam,'') || ' ' || COALESCE(k.naam,'')) END`;

// Kost van de verkoop ZONDER de dossierregels (die hebben hun eigen marge in
// Financiën → Marges): partijprijs van wat uit voorraad ging + productiekost
// van de verkochte printopdrachten. Onvolledig als een prijs ontbreekt.
export function kostVan(db, verkoopId) {
  const s = db.prepare(`SELECT SUM(-m.aantal * p.prijs_per_eenheid) kost, SUM(CASE WHEN p.prijs_per_eenheid IS NULL THEN 1 ELSE 0 END) zonder_prijs
    FROM voorraad_mutaties m JOIN verkoop_regels vr ON vr.id = m.bron_id LEFT JOIN voorraad_partijen p ON p.id = m.partij_id
    WHERE m.bron_type = 'verkoop_regel' AND m.reden = 'levering' AND m.aantal < 0 AND vr.verkoop_id = ?`).get(verkoopId);
  const p = db.prepare(`SELECT SUM(o.productiekost_stuk * o.aantal_goed) kost, SUM(COALESCE(o.arbeid_stuk, 0) * o.aantal_goed) arbeid,
      SUM(CASE WHEN o.productiekost_stuk IS NULL OR o.kost_onvolledig = 1 THEN 1 ELSE 0 END) onvolledig
    FROM verkoop_regels vr JOIN printopdrachten o ON o.id = vr.printopdracht_id WHERE vr.verkoop_id = ?`).get(verkoopId);
  const dossierdeel = db.prepare(`SELECT COALESCE(SUM(bedrag), 0) b FROM verkoop_regels WHERE verkoop_id = ? AND soort = 'dossier'`).get(verkoopId).b;
  return { kost: r2((s?.kost || 0) + (p?.kost || 0)), arbeid: r2(p?.arbeid || 0), dossierdeel: r2(dossierdeel),
    onvolledig: !!s?.zonder_prijs || !!p?.onvolledig };
}

export function leesVerkoopRij(db, id) {
  const v = db.prepare(`SELECT v.*, ${KLANTNAAM} AS klant FROM verkopen v LEFT JOIN klanten k ON k.id = v.klant_id WHERE v.id = ?`).get(Number(id));
  if (!v) return null;
  const regels = db.prepare(`SELECT r.*, a.type, d.nummer AS dossier_nummer, d.titel AS dossier_titel, o.naam AS printopdracht_naam
    FROM verkoop_regels r LEFT JOIN artikelen a ON a.id = r.artikel_id LEFT JOIN dossiers d ON d.id = r.dossier_id
    LEFT JOIN printopdrachten o ON o.id = r.printopdracht_id WHERE r.verkoop_id = ? ORDER BY r.volgorde, r.id`).all(v.id);
  const klant_gegevens = v.klant_id ? db.prepare('SELECT * FROM klanten WHERE id = ?').get(v.klant_id) : null;
  return { ...v, regels, klant_gegevens, ...kostVan(db, v.id), geannuleerd: !!v.geannuleerd_op };
}

// Inhoud voor het sjabloon (zelfde vorm als documentInhoud van een dossier).
export function verkoopInhoud(db, v) {
  return {
    bedrijf: getBedrijfsgegevens(db), klant: v.klant_gegevens || null,
    dossier: { titel: v.omschrijving || null, nummer: null },
    regels: v.regels.map(r => ({ omschrijving: r.omschrijving, aantal: r.aantal, per_stuk: r.prijs_per_stuk, bedrag: r.bedrag, uren: null })),
    totaal: v.totaal, vast: 0,
  };
}

// Overzicht van ALLE afrekeningen: losse verkopen + dossiers (bonnetje of
// factuur). Een dossier dat via een verkoop afgerekend werd, staat er niet
// apart bij (het zit in die verkoop).
export function overzicht(db) {
  const verkopen = db.prepare(`SELECT v.id, v.nummer, v.datum, v.totaal AS bedrag, v.gemaild_op, v.klant_mail, v.geannuleerd_op, v.omschrijving AS titel,
      ${KLANTNAAM} AS klant, (SELECT COUNT(*) FROM verkoop_regels r WHERE r.verkoop_id = v.id) AS regels,
      (SELECT GROUP_CONCAT(d.nummer, ', ') FROM verkoop_regels r JOIN dossiers d ON d.id = r.dossier_id WHERE r.verkoop_id = v.id) AS dossiers
    FROM verkopen v LEFT JOIN klanten k ON k.id = v.klant_id`).all()
    .map(v => ({ ...v, bron: 'verkoop', soort: 'bonnetje', erp: true, sleutel: `v${v.id}` }));
  const dossiers = db.prepare(`SELECT d.id, d.afgerekend_nummer AS nummer, d.afgerekend_op AS datum, d.afgerekend_bedrag AS bedrag, d.afgerekend_soort AS soort,
      d.afrekening_gemaild_op AS gemaild_op, d.afrekening_klant_mail AS klant_mail, d.afrekening_pdf_op, d.titel, d.nummer AS dossier_nummer, ${KLANTNAAM} AS klant
    FROM dossiers d LEFT JOIN klanten k ON k.id = d.klant_id WHERE d.afgerekend_op IS NOT NULL AND NOT ${VIA_VERKOOP('d')}`).all()
    .map(d => ({ ...d, bron: 'dossier', erp: !!d.afrekening_pdf_op, geannuleerd_op: null, sleutel: `d${d.id}` }));
  return [...verkopen, ...dossiers].sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || String(b.nummer).localeCompare(String(a.nummer)));
}

export function annuleerVerkoop(db, v) {
  if (v.geannuleerd_op) throw new DomeinFout('Deze verkoop is al ongedaan gemaakt.');
  const mut = db.prepare(`SELECT m.* FROM voorraad_mutaties m JOIN verkoop_regels r ON r.id = m.bron_id
    WHERE m.bron_type = 'verkoop_regel' AND m.reden = 'levering' AND r.verkoop_id = ?`).all(v.id);
  const terug = db.prepare('UPDATE voorraad_partijen SET aantal_resterend = aantal_resterend + ? WHERE id = ?');
  const ins = db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden, bron_type, bron_id, notitie) VALUES (?,?,?,?,?,?,?)`);
  for (const m of mut) {
    if (m.partij_id) terug.run(-m.aantal, m.partij_id);
    ins.run(m.artikel_id, m.partij_id, -m.aantal, 'correctie', 'verkoop_regel', m.bron_id, `Verkoop ${v.nummer} ongedaan gemaakt`);
  }
  db.prepare(`UPDATE verkopen SET geannuleerd_op = datetime('now') WHERE id = ?`).run(v.id);
  // eerst de verkoop op geannuleerd (dan hangt het dossier er niet meer aan vast)
  for (const r of v.regels.filter(x => x.soort === 'dossier')) {
    const d = leesDossier(db, r.dossier_id);
    if (d?.afgerekend_nummer === v.nummer) maakAfrekeningOngedaan(db, d, { waarom: `Verkoop ${v.nummer} ongedaan gemaakt.` });
  }
  const acc = v.gemaild_op ? ' Het bonnetje staat al in Accountable: pas het daar ook aan.' : '';
  logGebeurtenis(db, 'verkoop', v.id, 'status', `Ongedaan gemaakt: voorraad teruggeboekt${v.regels.some(x => x.soort === 'dossier') ? ', afrekening van de dossiers ongedaan' : ''}${v.regels.some(x => x.soort === 'printopdracht') ? ', printopdrachten weer vrij' : ''}.${acc}`);
}
