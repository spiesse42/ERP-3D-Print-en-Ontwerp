// ═══════════════════════════════════════════════════════════════════════
// VOORRAAD VANUIT PRODUCTIE (stap 6c)
// ═══════════════════════════════════════════════════════════════════════
// - Rol leegmelden bij de printerkaart: −1 rol van dat filament, FIFO
//   (oudste partij eerst), reden "gebruik", bron "printer" (domeinmodel:
//   "UIT/leegmelden = −1 op de oudste partij"). Ongedaan maken zet de rol
//   terug op dezelfde partij(en).
// - Te bestellen → "Printopdracht maken" voor een zelf geprint artikel:
//   maakt een dossier "Eigen product" met een printregel (eindproduct = dat
//   artikel) en plant meteen de printopdracht.
import { DomeinFout } from '../domein/hulp.js';
import { boekUit, voorraadVan } from '../domein/voorraad.js';
import { weergaveNaam, maakArtikel } from '../domein/artikelen.js';
import { volgendNummer } from '../domein/nummering.js';
import { logGebeurtenis } from '../domein/historiek.js';
import { maakOpdracht } from './opdrachten.js';
import { artikelMetProfiel, regelsUitProfiel, platenVan, bewaarProfiel } from './printprofiel.js';
import { start } from '../domein/uitvoering.js';
import { leesRegels, bewaarRegels } from '../domein/dossiers.js';

const FILAMENT = `SELECT a.id, a.type, a.filament_type_id, m.naam AS merk, mat.naam AS materiaal, k.naam AS kleur,
    (SELECT COALESCE(SUM(aantal_resterend), 0) FROM voorraad_partijen p WHERE p.artikel_id = a.id) AS voorraad
  FROM artikelen a JOIN filament_types ft ON ft.id = a.filament_type_id
  JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id
  JOIN filament_kleuren k ON k.id = a.kleur_id
  WHERE a.type = 'filament'`;
const metNaam = a => ({ id: a.id, naam: weergaveNaam(a), voorraad: Math.round(a.voorraad * 1000) / 1000 });

// Welke rollen kan je hier leegmelden: eerst het filament van de print die
// nu loopt (of de laatste), dan alles met voorraad.
export function filamentVoorPrinter(db, printerId) {
  const run = db.prepare(`SELECT printopdracht_id FROM printruns WHERE printer_id = ? AND printopdracht_id IS NOT NULL ORDER BY (uitkomst = 'bezig') DESC, id DESC LIMIT 1`).get(printerId);
  const opdracht = run ? db.prepare('SELECT id, dossier_regel_id FROM printopdrachten WHERE id = ?').get(run.printopdracht_id) : null;
  const regelMat = opdracht?.dossier_regel_id
    ? db.prepare('SELECT artikel_id, filament_type_id FROM dossier_regel_materialen WHERE regel_id = ? ORDER BY volgorde').all(opdracht.dossier_regel_id)
    : opdracht ? db.prepare('SELECT artikel_id, filament_type_id FROM printopdracht_materialen WHERE printopdracht_id = ? ORDER BY volgorde').all(opdracht.id) : [];
  const alle = db.prepare(`${FILAMENT} ORDER BY m.naam, mat.naam, k.naam`).all();
  const voorstelIds = new Set();
  for (const m of regelMat) {
    if (m.artikel_id) voorstelIds.add(m.artikel_id);
    // enkel een prijsgroep: de kleuren van die groep met voorraad
    else alle.filter(a => a.filament_type_id === m.filament_type_id && a.voorraad > 0).forEach(a => voorstelIds.add(a.id));
  }
  return {
    voorstel: alle.filter(a => voorstelIds.has(a.id)).map(metNaam),
    filament: alle.filter(a => a.voorraad > 0 && !voorstelIds.has(a.id)).map(metNaam),
    recent: recenteRolLeeg(db, printerId),
  };
}

// Laatste leegmeldingen op deze printer (één melding kan over twee partijen
// lopen, bv. na een correctie; die worden samen getoond).
export function recenteRolLeeg(db, printerId, limiet = 5) {
  const rijen = db.prepare(`SELECT g.*, EXISTS (SELECT 1 FROM voorraad_mutaties t WHERE t.bron_type = 'rol_leeg_ongedaan' AND t.bron_id = g.id) ongedaan
    FROM (SELECT MIN(m.id) id, m.artikel_id, m.tijdstip, -SUM(m.aantal) aantal
      FROM voorraad_mutaties m WHERE m.bron_type = 'printer' AND m.bron_id = ? AND m.reden = 'gebruik'
      GROUP BY m.artikel_id, m.tijdstip) g ORDER BY g.tijdstip DESC, g.id DESC LIMIT ?`).all(printerId, limiet);
  const art = db.prepare(`${FILAMENT} AND a.id = ?`);
  return rijen.map(r => ({ id: r.id, tijdstip: r.tijdstip, aantal: r.aantal, ongedaan: !!r.ongedaan, filament: (a => (a ? weergaveNaam(a) : '?'))(art.get(r.artikel_id)) }));
}

export function rolLeeg(db, printer, artikelId) {
  const a = db.prepare(`${FILAMENT} AND a.id = ?`).get(Number(artikelId));
  if (!a) throw new DomeinFout('Kies het filament (kleur) van de lege rol');
  if (voorraadVan(db, a.id) < 1 - 1e-9) {
    throw new DomeinFout(`Er staat geen volle rol ${weergaveNaam(a)} in voorraad (${String(voorraadVan(db, a.id)).replace('.', ',')}). Boek eerst de ontvangst of corrigeer de voorraad.`);
  }
  boekUit(db, { artikelId: a.id, aantal: 1, reden: 'gebruik', bronType: 'printer', bronId: printer.id, notitie: `Rol leeggemeld op ${printer.naam}` });
  return { filament: weergaveNaam(a), voorraad: voorraadVan(db, a.id) };
}

// Een leegmelding ongedaan maken: terug op dezelfde partij(en).
export function rolLeegOngedaan(db, mutatieId) {
  const eerste = db.prepare(`SELECT * FROM voorraad_mutaties WHERE id = ? AND bron_type = 'printer' AND reden = 'gebruik'`).get(Number(mutatieId));
  if (!eerste) throw new DomeinFout('Leegmelding niet gevonden');
  if (db.prepare(`SELECT 1 FROM voorraad_mutaties WHERE bron_type = 'rol_leeg_ongedaan' AND bron_id = ?`).get(eerste.id)) throw new DomeinFout('Deze leegmelding is al ongedaan gemaakt');
  const groep = db.prepare(`SELECT * FROM voorraad_mutaties WHERE bron_type = 'printer' AND bron_id = ? AND reden = 'gebruik' AND artikel_id = ? AND tijdstip = ?`)
    .all(eerste.bron_id, eerste.artikel_id, eerste.tijdstip);
  const terug = db.prepare('UPDATE voorraad_partijen SET aantal_resterend = aantal_resterend + ? WHERE id = ?');
  const mut = db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden, bron_type, bron_id, notitie) VALUES (?,?,?,?,?,?,?)`);
  for (const m of groep) {
    if (m.partij_id) terug.run(-m.aantal, m.partij_id);
    mut.run(m.artikel_id, m.partij_id, -m.aantal, 'correctie', 'rol_leeg_ongedaan', eerste.id, 'Leegmelding ongedaan gemaakt');
  }
}

// Te bestellen → Printopdracht maken (zelf geprint artikel).
// Sjabloon = de laatste printregel met dit eindproduct (printer, tijd,
// filament, voorbereiding), herschaald naar het gevraagde aantal. Zonder
// sjabloon: een lege printregel die je in het dossier aanvult.
// 06-10: met een printprofiel (tijd en gram per stuk, stuks per plaat) komt
// de printregel uit het profiel en wordt het dossier meteen gestart: één
// printopdracht per plaat. Zonder profiel: de printregel van de vorige keer.
// 18-10: personalisatie (bv. 'Naam: "Lotte" · Lettertype: Lobster' uit een
// webshopbestelling) komt in de titel, de printregel en dus de printopdracht.
export function maakEigenProduct(db, { artikel_id, aantal, printer_id, personalisatie = null }) {
  const a0 = db.prepare(`SELECT id, naam FROM artikelen WHERE id = ? AND type = 'artikel' AND zelf_geprint = 1`).get(Number(artikel_id));
  if (!a0) throw new DomeinFout('Enkel een artikel dat we zelf printen');
  const extra = String(personalisatie ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const a = { ...a0, naam: extra ? `${a0.naam} — ${extra}` : a0.naam };
  const n = typeof aantal === 'number' ? aantal : parseFloat(String(aantal ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new DomeinFout('Aantal stuks moet groter dan 0 zijn');
  const profiel = artikelMetProfiel(db, a.id).profiel;
  const printer = db.prepare('SELECT id, naam FROM printers WHERE id = ? AND actief = 1').get(Number(printer_id || platenVan(profiel)[0]?.printer_id));
  if (!printer) throw new DomeinFout('Kies een (actieve) printer');
  const sjabloon = profiel ? null : db.prepare(`SELECT r.* FROM dossier_regels r JOIN dossiers d ON d.id = r.dossier_id
    WHERE r.type = 'printen' AND r.artikel_id = ? AND d.soort = 'eigen' ORDER BY r.id DESC LIMIT 1`).get(a.id);
  const factor = sjabloon ? n / (Number(sjabloon.aantal) || 1) : 1;
  const nummer = volgendNummer(db, 'D');
  const dossierId = Number(db.prepare('INSERT INTO dossiers (nummer, soort, titel) VALUES (?,?,?)').run(nummer, 'eigen', `Voorraad: ${a.naam}`).lastInsertRowid);
  const ins = db.prepare('INSERT INTO dossier_regel_materialen (regel_id, volgorde, artikel_id, filament_type_id, gram) VALUES (?,?,?,?,?)');
  const insRegel = db.prepare(`INSERT INTO dossier_regels (dossier_id, volgorde, type, omschrijving, aantal, printer_id, tijd_min, voorbereiding_min, nabewerking_min, artikel_id, per_stuk, per_plaat, plaat_van)
    VALUES (?, ?, 'printen', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const regelIds = [];
  if (profiel) {
    // 21-10: één printregel per plaat (eigen printer als de plaat er een heeft);
    // enkel de laatste plaat boekt de stuks in voorraad (het stuk is dan af)
    regelsUitProfiel(profiel, n, a.naam).forEach((r, k) => {
      const pr = r.printer_id && db.prepare('SELECT 1 FROM printers WHERE id = ? AND actief = 1').get(r.printer_id) ? r.printer_id : printer.id;
      const id = Number(insRegel.run(dossierId, k, r.omschrijving, n, pr, r.tijd_min, r.voorbereiding_min, r.nabewerking_min, r.laatste ? a.id : null, 1, r.per_plaat, r.laatste ? null : a.id).lastInsertRowid);
      r.materialen.forEach((m, i) => ins.run(id, i, m.artikel_id, m.filament_type_id, m.gram));
      regelIds.push(id);
    });
  } else {
    regelIds.push(Number(insRegel.run(dossierId, 0, a.naam, n, printer.id,
      sjabloon ? Math.round((sjabloon.tijd_min || 0) * factor * 100) / 100 : 0, sjabloon?.voorbereiding_min ?? null, sjabloon?.nabewerking_min ?? null, a.id, 0, null, null).lastInsertRowid));
    if (sjabloon) {
      db.prepare('SELECT * FROM dossier_regel_materialen WHERE regel_id = ? ORDER BY volgorde').all(sjabloon.id)
        .forEach((m, i) => ins.run(regelIds[0], i, m.artikel_id, m.filament_type_id, Math.round(m.gram * factor * 100) / 100));
    }
  }
  logGebeurtenis(db, 'dossier', dossierId, 'aangemaakt', `Bijprinten: ${String(n).replace('.', ',')} × ${a.naam}${profiel ? ' (volgens het printprofiel)' : sjabloon ? ' (printregel overgenomen van de vorige keer)' : ''}`);
  let opdrachtId;
  if (profiel) {
    start(db, dossierId, { waarom: 'bijprinten' });
    opdrachtId = db.prepare('SELECT id FROM printopdrachten WHERE dossier_regel_id = ? ORDER BY id LIMIT 1').get(regelIds[0])?.id ?? null;
  } else {
    opdrachtId = maakOpdracht(db, { printer_id: printer.id, dossier_regel_id: regelIds[0] });
  }
  const opdrachten = db.prepare(`SELECT COUNT(*) n FROM printopdrachten WHERE dossier_regel_id IN (${regelIds.map(() => '?').join(',')})`).get(...regelIds).n;
  return { dossier_id: dossierId, nummer, opdracht_id: opdrachtId, opdrachten, sjabloon: !!sjabloon, profiel: !!profiel };
}

// ── Nieuw product uit een run (25-10) ─────────────────────────────────────
// Een bestand dat naar de printer gestuurd werd en nog geen product is:
// artikel (zelf geprint, verkocht) + printprofiel uit deze plaat (printer
// van de run, printtijd en filament ÷ stuks op de plaat) + een dossier
// Voorraad met de printopdracht. De run wordt daaraan gekoppeld; bij het
// bevestigen gaan de goede stuks in voorraad aan de gemeten kost.
export function nieuwProductUitRun(db, run, b) {
  const naam = String(b?.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!naam) throw new DomeinFout('Geef het product een naam');
  if (db.prepare('SELECT 1 FROM artikelen WHERE naam = ? COLLATE NOCASE').get(naam)) throw new DomeinFout(`Er bestaat al een artikel "${naam}". Kies een andere naam, of koppel de run aan een printopdracht van dat artikel.`);
  const n = Number(String(b?.aantal ?? 1).replace(',', '.'));
  if (!Number.isInteger(n) || n <= 0) throw new DomeinFout('Stuks op de plaat: een heel getal groter dan 0');
  const tijd = Number(String(b?.tijd_min ?? '').replace(',', '.'));
  const prijs = b?.verkoopprijs === '' || b?.verkoopprijs == null ? null : Number(String(b.verkoopprijs).replace(',', '.'));
  if (prijs !== null && (!Number.isFinite(prijs) || prijs < 0)) throw new DomeinFout('Verkoopprijs: een getal vanaf 0');
  const r4 = v => Math.round(v * 10000) / 10000;
  const artikelId = maakArtikel(db, { type: 'artikel', wordt_gekocht: 0, wordt_verkocht: 1, zelf_geprint: 1, categorie_id: b?.categorie_id ? Number(b.categorie_id) : null, naam,
    filament_type_id: null, kleur_id: null, eenheid: 'stuks', verkoopprijs: prijs, inkoopprijs: null, marge_pct: null, productieprijs: null,
    vaste_prijs: 0, min_voorraad: null, max_voorraad: null, locatie: null, notities: run.bestand ? `Bestand: ${run.bestand}` : null }, `Aangemaakt uit een run op de printer${run.bestand ? ` (${run.bestand})` : ''}`);
  bewaarProfiel(db, artikelId, {
    printer_id: run.printer_id, tijd_min: Number.isFinite(tijd) && tijd > 0 ? r4(tijd / n) : 0, per_plaat: n,
    materialen: (Array.isArray(b?.materialen) ? b.materialen : []).map(m => ({ ...m, gram: r4((Number(String(m.gram ?? 0).replace(',', '.')) || 0) / n) })),
  });
  const p = maakEigenProduct(db, { artikel_id: artikelId, aantal: n, printer_id: run.printer_id });
  return { artikel_id: artikelId, ...p };
}

// ── Nieuw klantdossier uit een run (30-10) ────────────────────────────────
// Een print voor een klant die nog geen dossier heeft: klantdossier met één
// printregel uit deze plaat (printer van de run, printtijd en filament van
// de hele plaat), meteen gestart (werkbon + printopdracht). De route koppelt
// daarna de run; bij het bevestigen tellen de goede stuks voor het dossier.
// Optioneel een bestaand product (onderdelen en prijsafspraak tellen mee)
// en een eindbedrag (anders berekend).
export function klantdossierUitRun(db, run, b) {
  const klant = db.prepare('SELECT id, familie FROM klanten WHERE id = ?').get(Number(b?.klant_id));
  if (!klant) throw new DomeinFout('Kies een klant (of maak er een)');
  const art = b?.artikel_id ? db.prepare(`SELECT id, naam FROM artikelen WHERE id = ? AND type = 'artikel'`).get(Number(b.artikel_id)) : null;
  if (b?.artikel_id && !art) throw new DomeinFout('Product niet gevonden');
  const omschrijving = String(b?.omschrijving ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || art?.naam || '';
  if (!omschrijving) throw new DomeinFout('Wat werd er geprint? Vul een omschrijving in of kies een product');
  const getal = v => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
  const n = getal(b?.aantal ?? 1);
  if (!Number.isFinite(n) || n <= 0) throw new DomeinFout('Stuks op deze plaat: een getal groter dan 0');
  const tijd = getal(b?.tijd_min);
  if (tijd !== null && (!Number.isFinite(tijd) || tijd < 0)) throw new DomeinFout('Printtijd: een getal vanaf 0');
  const prijs = getal(b?.prijs);
  if (prijs !== null && (!Number.isFinite(prijs) || prijs < 0)) throw new DomeinFout('Prijs: een getal vanaf 0');
  const titel = String(b?.titel ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || omschrijving;
  const nummer = volgendNummer(db, 'D');
  const dossierId = Number(db.prepare('INSERT INTO dossiers (nummer, soort, klant_id, titel, notities, filament_inkoop) VALUES (?,?,?,?,?,?)')
    .run(nummer, 'klant', klant.id, titel, run.bestand ? `Bestand: ${run.bestand}` : null, klant.familie ? 1 : 0).lastInsertRowid);
  bewaarRegels(db, dossierId, leesRegels([{ type: 'printen', omschrijving, aantal: n, printer_id: run.printer_id, tijd_min: tijd ?? 0,
    artikel_id: art?.id ?? null, handmatig_bedrag: prijs, materialen: Array.isArray(b?.materialen) ? b.materialen : [] }]));
  logGebeurtenis(db, 'dossier', dossierId, 'aangemaakt', `Uit een run op de printer${run.bestand ? ` (${run.bestand})` : ''}`);
  start(db, dossierId, { waarom: 'uit een run' });
  const opdracht = db.prepare(`SELECT o.id FROM printopdrachten o JOIN dossier_regels r ON r.id = o.dossier_regel_id
    WHERE r.dossier_id = ? ORDER BY o.id LIMIT 1`).get(dossierId);
  return { dossier_id: dossierId, nummer, opdracht_id: opdracht?.id ?? null };
}
