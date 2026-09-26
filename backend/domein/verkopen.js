// ═══════════════════════════════════════════════════════════════════════
// LOSSE VERKOOP (26-09) — tegel "Verkoop", zonder dossier
// ═══════════════════════════════════════════════════════════════════════
// Iets verkopen dat op voorraad ligt (of een dienst, bv. verzending). In één
// transactie: nummer uit de reeks BON (dezelfde teller als "Bonnetje maken"
// op een dossier), regels bewaren zoals ze op het bonnetje staan, voorraad
// FIFO uitboeken (reden "levering", bron verkoop_regel). Het mailen naar
// Accountable (+ optioneel de klant) gebeurt daarna in de route.
// Ongedaan = geannuleerd + voorraad terug op dezelfde partijen; het nummer
// blijft bezet (Accountable kreeg het al).
import { DomeinFout, rond } from './hulp.js';
import { logGebeurtenis } from './historiek.js';
import { boekUit } from './voorraad.js';
import { volgendNummer, overzicht as nummerOverzicht } from './nummering.js';
import { getBedrijfsgegevens } from './hulp.js';

const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tekst = v => { const t = String(v ?? '').trim(); return t || null; };
const getal = (v, wat, { strikt = false } = {}) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (strikt && n <= 0)) throw new DomeinFout(`${wat} moet een getal ${strikt ? 'groter dan 0' : 'vanaf 0'} zijn`);
  return rond(n);
};
const datumOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
export const vandaagLokaal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const ARTIKEL = `SELECT a.id, a.type, a.naam, a.verkoopprijs, a.gearchiveerd,
    CASE WHEN a.type = 'filament' THEN fm.naam || ' ' || mat.naam || ' · ' || k.naam ELSE a.naam END AS weergave,
    (SELECT COALESCE(SUM(aantal_resterend), 0) FROM voorraad_partijen p WHERE p.artikel_id = a.id) AS voorraad
  FROM artikelen a LEFT JOIN filament_types ft ON ft.id = a.filament_type_id LEFT JOIN filament_merken fm ON fm.id = ft.merk_id
  LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id LEFT JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.id = ?`;

export function leesDatum(v) {
  const datum = tekst(v) || vandaagLokaal();
  if (!datumOk(datum)) throw new DomeinFout('Vul een geldige datum in');
  if (datum > vandaagLokaal()) throw new DomeinFout('Een bonnetje kan niet in de toekomst liggen.');
  return datum;
}

// Invoer → { datum, klant_id, omschrijving, regels: [{ artikel_id, omschrijving, aantal, prijs_per_stuk, bedrag, type }], totaal }
// Controleert ook of er genoeg voorraad is (vóór er een nummer uitgegeven wordt).
export function leesVerkoop(db, body) {
  const datum = leesDatum(body?.datum);
  let klant_id = null;
  if (body?.klant_id !== undefined && body?.klant_id !== null && body?.klant_id !== '') {
    klant_id = Number(body.klant_id);
    if (!Number.isInteger(klant_id) || !db.prepare('SELECT 1 FROM klanten WHERE id = ?').get(klant_id)) throw new DomeinFout('Onbekende klant');
  }
  const lijst = Array.isArray(body?.regels) ? body.regels.filter(r => r && (r.artikel_id || r.aantal || r.prijs_per_stuk)) : [];
  if (!lijst.length) throw new DomeinFout('Voeg minstens één artikel toe.');
  const nodig = new Map();   // artikel → totaal aantal (zelfde artikel op twee regels)
  const regels = lijst.map((r, i) => {
    const nr = `Regel ${i + 1}`;
    const a = db.prepare(ARTIKEL).get(Number(r.artikel_id));
    if (!a) throw new DomeinFout(`${nr}: kies een artikel`);
    const aantal = getal(r.aantal ?? 1, `${nr}: aantal`, { strikt: true });
    const leeg = r.prijs_per_stuk === undefined || r.prijs_per_stuk === null || r.prijs_per_stuk === '';
    if (leeg && a.verkoopprijs == null) throw new DomeinFout(`${nr}: vul de prijs per stuk in (${a.weergave} heeft geen verkoopprijs)`);
    const prijs = leeg ? rond(a.verkoopprijs) : getal(r.prijs_per_stuk, `${nr}: prijs per stuk`);
    if (a.type !== 'dienst') nodig.set(a.id, { a, n: (nodig.get(a.id)?.n || 0) + aantal });
    return { artikel_id: a.id, type: a.type, omschrijving: tekst(r.omschrijving) || a.weergave, aantal, prijs_per_stuk: prijs,
      bedrag: Math.round(aantal * prijs * 100) / 100 };
  });
  for (const { a, n } of nodig.values()) {
    if (n > a.voorraad + 1e-9) throw new DomeinFout(`Onvoldoende voorraad van ${a.weergave}: ${String(a.voorraad).replace('.', ',')} beschikbaar, ${String(n).replace('.', ',')} verkocht`);
  }
  const totaal = Math.round(regels.reduce((t, r) => t + r.bedrag, 0) * 100) / 100;
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
  const ins = db.prepare('INSERT INTO verkoop_regels (verkoop_id, volgorde, artikel_id, omschrijving, aantal, prijs_per_stuk, bedrag) VALUES (?,?,?,?,?,?,?)');
  v.regels.forEach((r, k) => {
    const rid = Number(ins.run(id, k, r.artikel_id, r.omschrijving, r.aantal, r.prijs_per_stuk, r.bedrag).lastInsertRowid);
    if (r.type !== 'dienst') boekUit(db, { artikelId: r.artikel_id, aantal: r.aantal, reden: 'levering', bronType: 'verkoop_regel', bronId: rid, notitie: `Verkoop ${nummer}` });
  });
  logGebeurtenis(db, 'verkoop', id, 'aangemaakt', `${nummer} gemaakt (${euro(v.totaal)}): verkocht en meteen betaald; voorraad uitgeboekt`);
  return id;
}

const KLANTNAAM = `CASE WHEN k.type = 'zakelijk' AND NULLIF(k.bedrijfsnaam,'') IS NOT NULL THEN k.bedrijfsnaam
  ELSE TRIM(COALESCE(k.voornaam,'') || ' ' || COALESCE(k.naam,'')) END`;

// Kost (partijprijs van wat uitgeboekt werd) voor de marge; onvolledig als
// een partij geen prijs had.
function kostVan(db, verkoopId) {
  const r = db.prepare(`SELECT SUM(-m.aantal * p.prijs_per_eenheid) kost, SUM(CASE WHEN p.prijs_per_eenheid IS NULL THEN 1 ELSE 0 END) zonder_prijs
    FROM voorraad_mutaties m JOIN verkoop_regels vr ON vr.id = m.bron_id LEFT JOIN voorraad_partijen p ON p.id = m.partij_id
    WHERE m.bron_type = 'verkoop_regel' AND m.reden = 'levering' AND m.aantal < 0 AND vr.verkoop_id = ?`).get(verkoopId);
  return { kost: Math.round((r?.kost || 0) * 100) / 100, onvolledig: !!r?.zonder_prijs };
}

export function leesVerkoopRij(db, id) {
  const v = db.prepare(`SELECT v.*, ${KLANTNAAM} AS klant FROM verkopen v LEFT JOIN klanten k ON k.id = v.klant_id WHERE v.id = ?`).get(Number(id));
  if (!v) return null;
  const regels = db.prepare('SELECT r.*, a.type FROM verkoop_regels r JOIN artikelen a ON a.id = r.artikel_id WHERE r.verkoop_id = ? ORDER BY r.volgorde, r.id').all(v.id);
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

// Overzicht van ALLE bonnetjes: van losse verkopen én van dossiers (ERP of
// met de hand afgerekend als bonnetje). Facturen van dossiers staan erbij
// zodat je alle afrekeningen op één plaats ziet.
export function overzicht(db) {
  const verkopen = db.prepare(`SELECT v.id, v.nummer, v.datum, v.totaal AS bedrag, v.gemaild_op, v.klant_mail, v.geannuleerd_op, v.omschrijving AS titel,
      ${KLANTNAAM} AS klant, (SELECT COUNT(*) FROM verkoop_regels r WHERE r.verkoop_id = v.id) AS regels
    FROM verkopen v LEFT JOIN klanten k ON k.id = v.klant_id`).all()
    .map(v => ({ ...v, bron: 'verkoop', soort: 'bonnetje', erp: true, sleutel: `v${v.id}` }));
  const dossiers = db.prepare(`SELECT d.id, d.afgerekend_nummer AS nummer, d.afgerekend_op AS datum, d.afgerekend_bedrag AS bedrag, d.afgerekend_soort AS soort,
      d.afrekening_gemaild_op AS gemaild_op, d.afrekening_klant_mail AS klant_mail, d.afrekening_pdf_op, d.titel, d.nummer AS dossier_nummer, ${KLANTNAAM} AS klant
    FROM dossiers d LEFT JOIN klanten k ON k.id = d.klant_id WHERE d.afgerekend_op IS NOT NULL`).all()
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
  logGebeurtenis(db, 'verkoop', v.id, 'status', `Ongedaan gemaakt: voorraad teruggeboekt. ${v.gemaild_op ? 'Het bonnetje staat al in Accountable: pas het daar ook aan.' : ''}`.trim());
}
