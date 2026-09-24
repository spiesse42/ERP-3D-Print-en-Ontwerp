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
import { weergaveNaam } from '../domein/artikelen.js';
import { volgendNummer } from '../domein/nummering.js';
import { logGebeurtenis } from '../domein/historiek.js';
import { maakOpdracht } from './opdrachten.js';

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
  const opdracht = run ? db.prepare('SELECT dossier_regel_id FROM printopdrachten WHERE id = ?').get(run.printopdracht_id) : null;
  const regelMat = opdracht?.dossier_regel_id
    ? db.prepare('SELECT artikel_id, filament_type_id FROM dossier_regel_materialen WHERE regel_id = ? ORDER BY volgorde').all(opdracht.dossier_regel_id) : [];
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
export function maakEigenProduct(db, { artikel_id, aantal, printer_id }) {
  const a = db.prepare(`SELECT id, naam FROM artikelen WHERE id = ? AND type = 'artikel' AND zelf_geprint = 1`).get(Number(artikel_id));
  if (!a) throw new DomeinFout('Enkel een artikel dat we zelf printen');
  const n = typeof aantal === 'number' ? aantal : parseFloat(String(aantal ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new DomeinFout('Aantal stuks moet groter dan 0 zijn');
  const printer = db.prepare('SELECT id, naam FROM printers WHERE id = ? AND actief = 1').get(Number(printer_id));
  if (!printer) throw new DomeinFout('Kies een (actieve) printer');
  const sjabloon = db.prepare(`SELECT r.* FROM dossier_regels r JOIN dossiers d ON d.id = r.dossier_id
    WHERE r.type = 'printen' AND r.artikel_id = ? AND d.soort = 'eigen' ORDER BY r.id DESC LIMIT 1`).get(a.id);
  const factor = sjabloon ? n / (Number(sjabloon.aantal) || 1) : 1;
  const nummer = volgendNummer(db, 'D');
  const dossierId = Number(db.prepare('INSERT INTO dossiers (nummer, soort, titel) VALUES (?,?,?)').run(nummer, 'eigen', `Voorraad: ${a.naam}`).lastInsertRowid);
  const regelId = Number(db.prepare(`INSERT INTO dossier_regels (dossier_id, volgorde, type, omschrijving, aantal, printer_id, tijd_min, voorbereiding_min, nabewerking_min, artikel_id)
    VALUES (?, 0, 'printen', ?, ?, ?, ?, ?, ?, ?)`).run(dossierId, a.naam, n, printer.id,
    sjabloon ? Math.round((sjabloon.tijd_min || 0) * factor * 100) / 100 : 0, sjabloon?.voorbereiding_min ?? null, sjabloon?.nabewerking_min ?? null, a.id).lastInsertRowid);
  if (sjabloon) {
    const ins = db.prepare('INSERT INTO dossier_regel_materialen (regel_id, volgorde, artikel_id, filament_type_id, gram) VALUES (?,?,?,?,?)');
    db.prepare('SELECT * FROM dossier_regel_materialen WHERE regel_id = ? ORDER BY volgorde').all(sjabloon.id)
      .forEach((m, i) => ins.run(regelId, i, m.artikel_id, m.filament_type_id, Math.round(m.gram * factor * 100) / 100));
  }
  logGebeurtenis(db, 'dossier', dossierId, 'aangemaakt', `Vanuit Te bestellen: ${String(n).replace('.', ',')} × ${a.naam}${sjabloon ? ' (printregel overgenomen van de vorige keer)' : ''}`);
  const opdrachtId = maakOpdracht(db, { printer_id: printer.id, dossier_regel_id: regelId });
  return { dossier_id: dossierId, nummer, opdracht_id: opdrachtId, sjabloon: !!sjabloon };
}
