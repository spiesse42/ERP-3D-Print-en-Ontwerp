// ═══════════════════════════════════════════════════════════════════════
// AANKOPEN — één document van bestelling tot ontvangst (stap 3b)
// ═══════════════════════════════════════════════════════════════════════
// Beslissingen (claude/domeinmodel-v2.md):
// - status wordt AFGELEID, nooit met de hand gezet:
//     geannuleerd_op            → geannuleerd
//     alles ontvangen           → ontvangen
//     iets ontvangen            → deels ontvangen
//     besteld_op                → besteld
//     anders                    → concept
// - prijzen zijn incl. btw (vrijstellingsregel: btw is echte kost)
// - verzendkosten = losse kostregel, niet verrekend in de kostprijs
// - een regel is een artikel, een plaatshouder ("PLA Matte Zwart, merk nog
//   onbekend": merk kiezen bij ontvangst) of een losse kostregel
// - ontvangen = partij + mutatie (domein/voorraad.js), plus: laatste prijs
//   bij de leverancier en inkoopprijs van het artikel bijwerken

import { DomeinFout, optioneelGetal, rond } from './hulp.js';
import { volgendNummer } from './nummering.js';
import { boekIn, laatstePrijs } from './voorraad.js';
import { weergaveNaam } from './artikelen.js';
import { logGebeurtenis } from './historiek.js';

export const STATUSSEN = ['concept', 'besteld', 'deels', 'ontvangen', 'geannuleerd'];

// Een regel "moet ontvangen worden" als het een voorraadartikel of een
// plaatshouder is. Diensten en losse kostregels (verzending) niet.
const ontvangbaar = r => r.plaatshouder_materiaal_id != null || (r.artikel_id != null && r.artikel_type !== 'dienst');

export function afgeleideStatus(aankoop, regels) {
  if (aankoop.geannuleerd_op) return 'geannuleerd';
  const te = regels.filter(ontvangbaar);
  const ontvangen = te.reduce((s, r) => s + r.ontvangen, 0);
  if (te.length && te.every(r => r.ontvangen >= r.aantal - 1e-9)) return 'ontvangen';
  if (ontvangen > 1e-9) return 'deels';
  return aankoop.besteld_op ? 'besteld' : 'concept';
}

function leesRegels(db, aankoopId) {
  return db.prepare(`
    SELECT r.*, a.type AS artikel_type, a.naam AS artikel_naam, a.eenheid,
      m.naam AS merk, mat.naam AS materiaal, k.naam AS kleur, k.hex AS kleur_hex,
      pm.naam AS ph_materiaal, pk.naam AS ph_kleur, pk.hex AS ph_kleur_hex,
      COALESCE((SELECT SUM(p.aantal_ontvangen) FROM voorraad_partijen p WHERE p.aankoop_regel_id = r.id), 0) AS ontvangen
    FROM aankoop_regels r
    LEFT JOIN artikelen a ON a.id = r.artikel_id
    LEFT JOIN filament_types ft ON ft.id = a.filament_type_id
    LEFT JOIN filament_merken m ON m.id = ft.merk_id
    LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id
    LEFT JOIN filament_kleuren k ON k.id = a.kleur_id
    LEFT JOIN filament_materialen pm ON pm.id = r.plaatshouder_materiaal_id
    LEFT JOIN filament_kleuren pk ON pk.id = r.plaatshouder_kleur_id
    WHERE r.aankoop_id = ? ORDER BY r.volgorde, r.id`).all(aankoopId)
    .map(r => {
      const soort = r.artikel_id ? 'artikel' : r.plaatshouder_materiaal_id ? 'plaatshouder' : 'kost';
      const weergave = soort === 'artikel'
        ? weergaveNaam({ type: r.artikel_type, naam: r.artikel_naam, merk: r.merk, materiaal: r.materiaal, kleur: r.kleur })
        : soort === 'plaatshouder' ? `${r.ph_materiaal}${r.ph_kleur ? ` · ${r.ph_kleur}` : ''} (merk nog onbekend)` : r.omschrijving;
      return {
        ...r, soort, weergave, ontvangen: rond(r.ontvangen),
        ontvangbaar: ontvangbaar(r),
        openstaand: ontvangbaar(r) ? rond(Math.max(r.aantal - r.ontvangen, 0)) : 0,
        subtotaal: r.prijs_per_eenheid != null ? rond(r.aantal * r.prijs_per_eenheid) : null,
      };
    });
}

export function leesAankoop(db, id) {
  const a = db.prepare(`SELECT ak.*, l.naam AS leverancier FROM aankopen ak
    LEFT JOIN leveranciers l ON l.id = ak.leverancier_id WHERE ak.id = ?`).get(id);
  if (!a) return null;
  const regels = leesRegels(db, id);
  return {
    ...a, regels,
    status: afgeleideStatus(a, regels),
    totaal: rond(regels.reduce((s, r) => s + (r.subtotaal ?? 0), 0)),
    bijlagen: db.prepare(`SELECT id, bestandsnaam, mimetype, grootte, aangemaakt_op FROM bijlagen
      WHERE entiteit = 'aankoop' AND entiteit_id = ? ORDER BY id`).all(id),
  };
}

// Lijst: één query voor de kop, status per aankoop uit de regels.
export function leesAankopen(db, { leverancierId = null, artikelId = null } = {}) {
  const waar = [];
  const par = [];
  if (leverancierId) { waar.push('ak.leverancier_id = ?'); par.push(leverancierId); }
  if (artikelId) { waar.push('EXISTS (SELECT 1 FROM aankoop_regels r WHERE r.aankoop_id = ak.id AND r.artikel_id = ?)'); par.push(artikelId); }
  const koppen = db.prepare(`SELECT ak.*, l.naam AS leverancier,
      (SELECT COUNT(*) FROM bijlagen b WHERE b.entiteit = 'aankoop' AND b.entiteit_id = ak.id) AS bijlagen
    FROM aankopen ak LEFT JOIN leveranciers l ON l.id = ak.leverancier_id
    ${waar.length ? 'WHERE ' + waar.join(' AND ') : ''} ORDER BY ak.datum DESC, ak.id DESC`).all(...par);
  return koppen.map(a => {
    const regels = leesRegels(db, a.id);
    return {
      ...a,
      status: afgeleideStatus(a, regels),
      regels: regels.length,
      totaal: rond(regels.reduce((s, r) => s + (r.subtotaal ?? 0), 0)),
      samenvatting: regels.slice(0, 3).map(r => r.weergave).join(', ') + (regels.length > 3 ? ', …' : ''),
    };
  });
}

// ── Invoer ────────────────────────────────────────────────────────────────
function tekst(w) { return w === undefined || w === null || String(w).trim() === '' ? null : String(w).trim(); }
function id(w) {
  if (w === undefined || w === null || w === '') return null;
  const n = Number(w);
  if (!Number.isInteger(n)) throw new DomeinFout('Ongeldige keuze');
  return n;
}

export function leesKop(body) {
  const datum = tekst(body?.datum);
  if (datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new DomeinFout('Datum moet de vorm JJJJ-MM-DD hebben');
  return {
    leverancier_id: id(body?.leverancier_id),
    datum,
    extern_factuurnummer: tekst(body?.extern_factuurnummer),
    notities: tekst(body?.notities),
  };
}

export function leesRegelInvoer(r, i) {
  const n = `Regel ${i + 1}`;
  const soort = r?.soort;
  const regel = {
    id: id(r?.id),
    artikel_id: null, plaatshouder_materiaal_id: null, plaatshouder_kleur_id: null,
    omschrijving: tekst(r?.omschrijving),
  };
  if (soort === 'artikel') {
    regel.artikel_id = id(r.artikel_id);
    if (!regel.artikel_id) throw new DomeinFout(`${n}: kies een artikel`);
  } else if (soort === 'plaatshouder') {
    regel.plaatshouder_materiaal_id = id(r.plaatshouder_materiaal_id);
    regel.plaatshouder_kleur_id = id(r.plaatshouder_kleur_id);
    if (!regel.plaatshouder_materiaal_id) throw new DomeinFout(`${n}: kies een type filament`);
    if (!regel.plaatshouder_kleur_id) throw new DomeinFout(`${n}: kies een kleur`);
  } else if (soort === 'kost') {
    if (!regel.omschrijving) throw new DomeinFout(`${n}: vul een omschrijving in (bv. Verzending)`);
  } else throw new DomeinFout(`${n}: onbekend soort regel`);
  const aantal = optioneelGetal(r.aantal);
  if (aantal === null || Number.isNaN(aantal) || aantal <= 0) throw new DomeinFout(`${n}: aantal moet groter zijn dan 0`);
  const prijs = optioneelGetal(r.prijs_per_eenheid);
  if (Number.isNaN(prijs) || (prijs !== null && prijs < 0)) throw new DomeinFout(`${n}: prijs moet een getal ≥ 0 zijn`);
  regel.aantal = rond(aantal);
  regel.prijs_per_eenheid = prijs;
  return regel;
}

export function maakAankoop(db, kop, regels = [], bron = 'manueel') {
  const nummer = volgendNummer(db, 'AK');
  const aankoopId = db.prepare(`INSERT INTO aankopen (nummer, leverancier_id, datum, bron, extern_factuurnummer, notities)
    VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?)`)
    .run(nummer, kop.leverancier_id, kop.datum, bron, kop.extern_factuurnummer, kop.notities).lastInsertRowid;
  const ins = db.prepare(`INSERT INTO aankoop_regels (aankoop_id, volgorde, artikel_id, plaatshouder_materiaal_id, plaatshouder_kleur_id, omschrijving, aantal, prijs_per_eenheid)
    VALUES (?,?,?,?,?,?,?,?)`);
  regels.forEach((r, i) => ins.run(aankoopId, i, r.artikel_id, r.plaatshouder_materiaal_id, r.plaatshouder_kleur_id, r.omschrijving, r.aantal, r.prijs_per_eenheid));
  logGebeurtenis(db, 'aankoop', aankoopId, 'aangemaakt', null);
  return { id: Number(aankoopId), nummer };
}

// Bewaren van kop + regels. Regels die al (deels) ontvangen zijn, liggen
// vast: artikel en prijs niet meer wijzigen, aantal niet onder het ontvangen
// aantal, niet verwijderen. Een geannuleerde aankoop is enkel nog leesbaar.
export function bewaarAankoop(db, aankoopId, kop, regels) {
  const oud = leesAankoop(db, aankoopId);
  if (!oud) throw new DomeinFout('Aankoop niet gevonden');
  if (oud.status === 'geannuleerd') throw new DomeinFout('Een geannuleerde aankoop kan niet meer gewijzigd worden. Heropen ze eerst.');
  const perId = new Map(oud.regels.map(r => [r.id, r]));
  const gezien = new Set();
  const wijzigingen = [];
  regels.forEach((r, i) => {
    if (r.id == null) return;
    const o = perId.get(r.id);
    if (!o) throw new DomeinFout(`Regel ${i + 1} hoort niet bij deze aankoop`);
    gezien.add(r.id);
    if (o.ontvangen > 0) {
      const zelfde = o.artikel_id === r.artikel_id && o.plaatshouder_materiaal_id === r.plaatshouder_materiaal_id
        && o.plaatshouder_kleur_id === r.plaatshouder_kleur_id && (o.prijs_per_eenheid ?? null) === (r.prijs_per_eenheid ?? null);
      if (!zelfde) throw new DomeinFout(`Regel ${i + 1} (${o.weergave}) is al ontvangen: artikel en prijs liggen vast`);
      if (r.aantal < o.ontvangen - 1e-9) throw new DomeinFout(`Regel ${i + 1}: het aantal kan niet lager dan wat al ontvangen is (${String(o.ontvangen).replace('.', ',')})`);
    }
  });
  for (const o of oud.regels) {
    if (!gezien.has(o.id) && o.ontvangen > 0) throw new DomeinFout(`${o.weergave} is al (deels) ontvangen en kan niet verwijderd worden`);
  }
  if (!kop.leverancier_id && oud.status !== 'concept') throw new DomeinFout('Een bestelde of ontvangen aankoop heeft een leverancier nodig');

  db.prepare(`UPDATE aankopen SET leverancier_id = ?, datum = COALESCE(?, datum), extern_factuurnummer = ?, notities = ? WHERE id = ?`)
    .run(kop.leverancier_id, kop.datum, kop.extern_factuurnummer, kop.notities, aankoopId);
  for (const o of oud.regels) if (!gezien.has(o.id)) db.prepare('DELETE FROM aankoop_regels WHERE id = ?').run(o.id);
  const upd = db.prepare(`UPDATE aankoop_regels SET volgorde=?, artikel_id=?, plaatshouder_materiaal_id=?, plaatshouder_kleur_id=?, omschrijving=?, aantal=?, prijs_per_eenheid=? WHERE id=?`);
  const ins = db.prepare(`INSERT INTO aankoop_regels (aankoop_id, volgorde, artikel_id, plaatshouder_materiaal_id, plaatshouder_kleur_id, omschrijving, aantal, prijs_per_eenheid)
    VALUES (?,?,?,?,?,?,?,?)`);
  regels.forEach((r, i) => {
    if (r.id != null) upd.run(i, r.artikel_id, r.plaatshouder_materiaal_id, r.plaatshouder_kleur_id, r.omschrijving, r.aantal, r.prijs_per_eenheid, r.id);
    else ins.run(aankoopId, i, r.artikel_id, r.plaatshouder_materiaal_id, r.plaatshouder_kleur_id, r.omschrijving, r.aantal, r.prijs_per_eenheid);
  });

  // Historiek: kop + samenvatting van de regels.
  const nieuw = leesAankoop(db, aankoopId);
  if ((oud.leverancier_id ?? null) !== (nieuw.leverancier_id ?? null)) wijzigingen.push(`Leverancier: ${oud.leverancier ?? '—'} → ${nieuw.leverancier ?? '—'}`);
  if (oud.datum !== nieuw.datum) wijzigingen.push(`Datum: ${oud.datum} → ${nieuw.datum}`);
  if ((oud.extern_factuurnummer ?? '') !== (nieuw.extern_factuurnummer ?? '')) wijzigingen.push(`Factuurnummer leverancier: ${oud.extern_factuurnummer ?? '—'} → ${nieuw.extern_factuurnummer ?? '—'}`);
  const sleutel = rs => JSON.stringify(rs.map(r => [r.weergave, r.aantal, r.prijs_per_eenheid]));
  if (sleutel(oud.regels) !== sleutel(nieuw.regels)) wijzigingen.push(`Regels gewijzigd (${nieuw.regels.length}, totaal € ${nieuw.totaal.toLocaleString('nl-BE', { minimumFractionDigits: 2 })})`);
  if ((oud.notities ?? '') !== (nieuw.notities ?? '')) wijzigingen.push('Notities gewijzigd');
  if (wijzigingen.length) logGebeurtenis(db, 'aankoop', aankoopId, 'gewijzigd', wijzigingen.join('; '));
  return nieuw;
}

export function bestel(db, aankoopId) {
  const a = leesAankoop(db, aankoopId);
  if (!a) throw new DomeinFout('Aankoop niet gevonden');
  if (a.status !== 'concept') throw new DomeinFout('Enkel een concept kan besteld worden');
  if (!a.leverancier_id) throw new DomeinFout('Kies eerst een leverancier');
  if (!a.regels.length) throw new DomeinFout('Voeg eerst regels toe');
  db.prepare(`UPDATE aankopen SET besteld_op = date('now') WHERE id = ?`).run(aankoopId);
  logGebeurtenis(db, 'aankoop', aankoopId, 'status', `Besteld bij ${a.leverancier}`);
}

export function annuleer(db, aankoopId) {
  const a = leesAankoop(db, aankoopId);
  if (!a) throw new DomeinFout('Aankoop niet gevonden');
  if (a.status === 'geannuleerd') return;
  if (a.regels.some(r => r.ontvangen > 0)) {
    throw new DomeinFout('Er is al iets ontvangen. Zet de aantallen gelijk aan wat ontvangen is, dan staat de aankoop op "ontvangen".');
  }
  db.prepare(`UPDATE aankopen SET geannuleerd_op = date('now') WHERE id = ?`).run(aankoopId);
  logGebeurtenis(db, 'aankoop', aankoopId, 'status', 'Geannuleerd');
}

// Geannuleerd → terug zoals voordien; besteld (nog niets ontvangen) → concept.
export function heropen(db, aankoopId) {
  const a = leesAankoop(db, aankoopId);
  if (!a) throw new DomeinFout('Aankoop niet gevonden');
  if (a.status === 'geannuleerd') {
    db.prepare('UPDATE aankopen SET geannuleerd_op = NULL WHERE id = ?').run(aankoopId);
    logGebeurtenis(db, 'aankoop', aankoopId, 'status', 'Heropend');
  } else if (a.status === 'besteld') {
    db.prepare('UPDATE aankopen SET besteld_op = NULL WHERE id = ?').run(aankoopId);
    logGebeurtenis(db, 'aankoop', aankoopId, 'status', 'Terug naar concept');
  } else throw new DomeinFout('Enkel een geannuleerde of een bestelde aankoop (zonder ontvangst) kan heropend worden');
}

// Filamentartikel voor een plaatshouder: merk + materiaal = prijsgroep, + kleur.
// Bestaat de prijsgroep niet, dan moet er een verkoopprijs/kg meekomen om ze aan te maken.
function filamentVoorPlaatshouder(db, regel, merkId, nieuwePrijsKg) {
  if (!merkId) throw new DomeinFout(`${regel.weergave}: kies het merk`);
  if (!regel.plaatshouder_kleur_id) throw new DomeinFout(`${regel.weergave}: de plaatshouder heeft geen kleur. Vul eerst de kleur in op de regel.`);
  let pg = db.prepare('SELECT id FROM filament_types WHERE merk_id = ? AND materiaal_id = ?').get(merkId, regel.plaatshouder_materiaal_id)?.id;
  if (!pg) {
    const prijs = optioneelGetal(nieuwePrijsKg);
    if (prijs === null || Number.isNaN(prijs) || prijs < 0) {
      throw new DomeinFout(`${regel.weergave}: voor dit merk en type bestaat nog geen prijsgroep. Vul een verkoopprijs per kg in om ze aan te maken.`);
    }
    pg = db.prepare('INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg) VALUES (?,?,?)').run(merkId, regel.plaatshouder_materiaal_id, prijs).lastInsertRowid;
  }
  const bestaand = db.prepare(`SELECT id FROM artikelen WHERE type = 'filament' AND filament_type_id = ? AND kleur_id = ?`).get(pg, regel.plaatshouder_kleur_id);
  if (bestaand) return bestaand.id;
  const cat = db.prepare(`SELECT id FROM categorieen WHERE ouder_id IS NULL AND naam = 'Filament' COLLATE NOCASE`).get()?.id ?? null;
  const nieuw = db.prepare(`INSERT INTO artikelen (type, wordt_gekocht, filament_type_id, kleur_id, eenheid, categorie_id) VALUES ('filament', 1, ?, ?, 'rollen', ?)`)
    .run(pg, regel.plaatshouder_kleur_id, cat).lastInsertRowid;
  logGebeurtenis(db, 'artikel', nieuw, 'aangemaakt', 'Aangemaakt bij ontvangst van een plaatshouder');
  return Number(nieuw);
}

// Laatste prijs bij de leverancier + inkoopprijs op het artikel bijwerken.
function werkPrijzenBij(db, artikelId, leverancierId, prijs) {
  if (prijs == null) return;
  const link = db.prepare('SELECT id FROM artikel_leveranciers WHERE artikel_id = ? AND leverancier_id = ? ORDER BY voorkeur DESC, id LIMIT 1').get(artikelId, leverancierId);
  if (link) {
    db.prepare(`UPDATE artikel_leveranciers SET laatste_prijs = ?, bijgewerkt_op = datetime('now') WHERE id = ?`).run(prijs, link.id);
  } else {
    const eerste = !db.prepare('SELECT 1 FROM artikel_leveranciers WHERE artikel_id = ?').get(artikelId);
    db.prepare('INSERT INTO artikel_leveranciers (artikel_id, leverancier_id, laatste_prijs, voorkeur) VALUES (?,?,?,?)').run(artikelId, leverancierId, prijs, eerste ? 1 : 0);
  }
  db.prepare(`UPDATE artikelen SET inkoopprijs = ? WHERE id = ? AND type <> 'filament'`).run(prijs, artikelId);
}

// Ontvangen: [{ regel_id, aantal, merk_id?, nieuwe_prijs_per_kg? }], datum, locatie.
// Een concept dat meteen ontvangen wordt (winkelaankoop), krijgt ook een besteldatum.
export function ontvang(db, aankoopId, lijnen, { datum = null, locatie = null } = {}) {
  const a = leesAankoop(db, aankoopId);
  if (!a) throw new DomeinFout('Aankoop niet gevonden');
  if (a.status === 'geannuleerd') throw new DomeinFout('Deze aankoop is geannuleerd');
  if (!a.leverancier_id) throw new DomeinFout('Kies eerst een leverancier');
  if (!Array.isArray(lijnen) || !lijnen.length) throw new DomeinFout('Niets om te ontvangen');
  const perId = new Map(a.regels.map(r => [r.id, r]));
  const verslag = [];
  const gezien = new Set();
  for (const l of lijnen) {
    const r = perId.get(Number(l?.regel_id));
    if (!r) throw new DomeinFout('Onbekende regel');
    if (gezien.has(r.id)) throw new DomeinFout(`${r.weergave} staat twee keer in de ontvangst`);
    gezien.add(r.id);
    const n = optioneelGetal(l.aantal);
    if (n === null || n === 0) continue;
    if (Number.isNaN(n) || n < 0) throw new DomeinFout(`${r.weergave}: aantal moet een getal ≥ 0 zijn`);
    if (!r.ontvangbaar) throw new DomeinFout(`${r.weergave}: deze regel heeft geen voorraad`);
    if (n > r.openstaand + 1e-9) throw new DomeinFout(`${r.weergave}: er staat nog maar ${String(r.openstaand).replace('.', ',')} open`);
    const artikelId = r.soort === 'plaatshouder' ? filamentVoorPlaatshouder(db, r, id(l.merk_id), l.nieuwe_prijs_per_kg) : r.artikel_id;
    boekIn(db, { artikelId, aantal: n, prijs: r.prijs_per_eenheid, datum, locatie, reden: 'ontvangst',
      aankoopRegelId: r.id, bronType: 'aankoop', bronId: aankoopId, notitie: a.nummer });
    werkPrijzenBij(db, artikelId, a.leverancier_id, r.prijs_per_eenheid);
    const naam = r.soort === 'plaatshouder'
      ? weergaveNaam(db.prepare(`SELECT a.type, a.naam, m.naam merk, mat.naam materiaal, k.naam kleur FROM artikelen a
          JOIN filament_types ft ON ft.id = a.filament_type_id JOIN filament_merken m ON m.id = ft.merk_id
          JOIN filament_materialen mat ON mat.id = ft.materiaal_id JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.id = ?`).get(artikelId))
      : r.weergave;
    logGebeurtenis(db, 'artikel', artikelId, 'voorraad', `+${String(n).replace('.', ',')} ontvangen via ${a.nummer}`);
    verslag.push(`${String(n).replace('.', ',')} × ${naam}`);
  }
  if (!verslag.length) throw new DomeinFout('Vul bij minstens één regel een aantal in');
  if (!a.besteld_op) db.prepare('UPDATE aankopen SET besteld_op = COALESCE(?, date(\'now\')) WHERE id = ?').run(datum, aankoopId);
  const na = leesAankoop(db, aankoopId);
  logGebeurtenis(db, 'aankoop', aankoopId, 'status', `${na.status === 'ontvangen' ? 'Ontvangen' : 'Deels ontvangen'}: ${verslag.join(', ')}`);
  return na;
}

// "Bestelling maken" vanuit Te bestellen: per voorkeursleverancier één
// conceptaankoop. Artikelen zonder leverancier komen samen in één concept
// zonder leverancier (die kies je dan zelf).
export function bestellingenMaken(db, lijst) {
  if (!Array.isArray(lijst) || !lijst.length) throw new DomeinFout('Kies minstens één artikel');
  const groepen = new Map();
  for (const x of lijst) {
    const artikelId = Number(x?.artikel_id);
    const aantal = optioneelGetal(x?.aantal);
    if (!Number.isInteger(artikelId)) throw new DomeinFout('Ongeldig artikel');
    if (aantal === null || Number.isNaN(aantal) || aantal <= 0) throw new DomeinFout('Aantal moet groter zijn dan 0');
    const art = db.prepare('SELECT id, type, inkoopprijs, gearchiveerd FROM artikelen WHERE id = ?').get(artikelId);
    if (!art || art.type === 'dienst') throw new DomeinFout('Dit artikel kan niet besteld worden');
    const lev = db.prepare('SELECT leverancier_id, laatste_prijs FROM artikel_leveranciers WHERE artikel_id = ? ORDER BY voorkeur DESC, id LIMIT 1').get(artikelId);
    const sleutel = lev?.leverancier_id ?? 0;
    if (!groepen.has(sleutel)) groepen.set(sleutel, []);
    groepen.get(sleutel).push({ artikel_id: artikelId, plaatshouder_materiaal_id: null, plaatshouder_kleur_id: null, omschrijving: null,
      aantal: rond(aantal), prijs_per_eenheid: lev?.laatste_prijs ?? art.inkoopprijs ?? laatstePrijs(db, artikelId) });
  }
  return [...groepen.entries()].map(([lev, regels]) => maakAankoop(db, { leverancier_id: lev || null, datum: null, extern_factuurnummer: null, notities: null }, regels));
}
