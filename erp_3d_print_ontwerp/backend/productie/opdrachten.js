// ═══════════════════════════════════════════════════════════════════════
// PRINTOPDRACHTEN + RUNS KOPPELEN (stap 6b)
// ═══════════════════════════════════════════════════════════════════════
// Domeinmodel → "Printopdrachten" (bevestigd 23-09):
// - wachtrij per printer (volgorde); een opdracht kan bij een dossierregel
//   horen, of los bestaan (eigen product, intern)
// - de printerwachter legt runs vast; KOPPELEN GEBEURT ALTIJD DOOR JOU.
//   Voorstel = de eerste geplande opdracht van die printer. Kies je een
//   opdracht uit de wachtrij van een andere printer, dan verhuist die.
// - een opdracht kan meerdere runs hebben (mislukte poging + herprint)
// - status afgeleid: gepland / bezig / te_bevestigen / voltooid / mislukt /
//   geannuleerd
// - werkbon: enkel GESLAAGDE runs (optie A, 25-09); mislukte = kost voor jou
import { DomeinFout } from '../domein/hulp.js';
import { logGebeurtenis } from '../domein/historiek.js';
import { boekIn } from '../domein/voorraad.js';
import { productiekost } from './kost.js';

export const OPDRACHT_STATUS = {
  gepland: 'Gepland', bezig: 'Bezig', te_bevestigen: 'Te bevestigen', voltooid: 'Voltooid', mislukt: 'Mislukt', geannuleerd: 'Geannuleerd',
};
export const INTERN = { kalibratie: 'Kalibratie', test: 'Test', overig: 'Overig (intern)' };

const duurU = r => ((r.geeindigd_op ? Date.parse(r.geeindigd_op) : Date.now()) - Date.parse(r.gestart_op)) / 3600e3;

export function statusVan(o, runs) {
  if (o.geannuleerd_op) return 'geannuleerd';
  if (o.voltooid_op) return 'voltooid';
  if (!runs.length) return 'gepland';
  if (runs.some(r => r.uitkomst === 'bezig')) return 'bezig';
  const laatste = [...runs].sort((a, b) => a.gestart_op.localeCompare(b.gestart_op)).at(-1);
  return laatste.uitkomst === 'klaar' ? 'te_bevestigen' : 'mislukt';
}

// eindproduct: het artikel (zelf geprint) waar de goede stuks naartoe gaan —
// enkel bij een printregel van een dossier "Eigen product" (stap 6c)
const SELECT = `SELECT o.*, p.naam AS printer, r.dossier_id, r.omschrijving AS regel_omschrijving, d.nummer AS dossier_nummer, d.titel AS dossier_titel,
    d.soort AS dossier_soort, d.gestart_op AS dossier_gestart_op, CASE WHEN d.soort = 'eigen' THEN ea.id END AS eindproduct_id, CASE WHEN d.soort = 'eigen' THEN ea.naam END AS eindproduct
  FROM printopdrachten o JOIN printers p ON p.id = o.printer_id
  LEFT JOIN dossier_regels r ON r.id = o.dossier_regel_id LEFT JOIN dossiers d ON d.id = r.dossier_id
  LEFT JOIN artikelen ea ON ea.id = r.artikel_id AND r.type = 'printen'`;

function metRuns(db, lijst) {
  const runsVan = db.prepare('SELECT * FROM printruns WHERE printopdracht_id = ? ORDER BY gestart_op');
  const mat = db.prepare(`SELECT m.gram, COALESCE(a.id, NULL) AS artikel_id,
      COALESCE(fm.naam || ' ' || fmat.naam || ' · ' || k.naam, gm.naam || ' ' || gmat.naam) AS naam,
      (SELECT COALESCE(SUM(aantal_resterend), 0) FROM voorraad_partijen vp WHERE vp.artikel_id = a.id) AS voorraad
    FROM dossier_regel_materialen m
    LEFT JOIN artikelen a ON a.id = m.artikel_id
    LEFT JOIN filament_types ft ON ft.id = a.filament_type_id LEFT JOIN filament_merken fm ON fm.id = ft.merk_id
    LEFT JOIN filament_materialen fmat ON fmat.id = ft.materiaal_id LEFT JOIN filament_kleuren k ON k.id = a.kleur_id
    LEFT JOIN filament_types g ON g.id = m.filament_type_id LEFT JOIN filament_merken gm ON gm.id = g.merk_id
    LEFT JOIN filament_materialen gmat ON gmat.id = g.materiaal_id
    WHERE m.regel_id = ? ORDER BY m.volgorde`);
  return lijst.map(o => {
    const runs = runsVan.all(o.id);
    return { ...o, status: statusVan(o, runs), runs: runs.map(r => ({ id: r.id, uitkomst: r.uitkomst, gestart_op: r.gestart_op, geeindigd_op: r.geeindigd_op, kwh: r.kwh, printer_id: r.printer_id })),
      materialen: o.dossier_regel_id ? mat.all(o.dossier_regel_id) : [] };
  });
}

export function leesOpdrachten(db, { printer_id = null, dossier_id = null, open = false, id = null } = {}) {
  const waar = [], par = [];
  if (id) { waar.push('o.id = ?'); par.push(id); }
  if (printer_id) { waar.push('o.printer_id = ?'); par.push(printer_id); }
  if (dossier_id) { waar.push('r.dossier_id = ?'); par.push(dossier_id); }
  if (open) waar.push('o.voltooid_op IS NULL AND o.geannuleerd_op IS NULL');
  const rijen = db.prepare(`${SELECT} ${waar.length ? `WHERE ${waar.join(' AND ')}` : ''} ORDER BY o.printer_id, o.volgorde, o.id`).all(...par);
  return metRuns(db, rijen);
}
export function leesOpdracht(db, id) { return leesOpdrachten(db, { id })[0] || null; }

const getal = (v, wat, { min = 0, strikt = false } = {}) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || (strikt && n <= min)) throw new DomeinFout(`${wat} moet een getal ${strikt ? 'groter dan' : 'vanaf'} ${min} zijn`);
  return n;
};
function volgendeVolgorde(db, printerId) {
  return (db.prepare('SELECT MAX(volgorde) m FROM printopdrachten WHERE printer_id = ?').get(printerId).m ?? 0) + 1;
}

export function maakOpdracht(db, body) {
  const printer = db.prepare('SELECT id, naam FROM printers WHERE id = ? AND actief = 1').get(Number(body?.printer_id));
  if (!printer) throw new DomeinFout('Kies een (actieve) printer');
  let regel = null;
  if (body?.dossier_regel_id) {
    regel = db.prepare(`SELECT r.*, d.soort AS dossier_soort, d.nummer, d.afgerekend_op, d.geannuleerd_op FROM dossier_regels r JOIN dossiers d ON d.id = r.dossier_id WHERE r.id = ?`).get(Number(body.dossier_regel_id));
    if (!regel || regel.type !== 'printen') throw new DomeinFout('Enkel een printregel van een dossier krijgt een printopdracht');
    if (regel.geannuleerd_op) throw new DomeinFout('Het dossier is geannuleerd');
  }
  const soort = regel ? (regel.dossier_soort === 'klant' ? 'klant' : regel.dossier_soort) : (body?.soort || 'intern');
  if (!['klant', 'eigen', 'intern'].includes(soort)) throw new DomeinFout('Onbekend soort printopdracht');
  const naam = String(body?.naam ?? regel?.omschrijving ?? '').trim() || (regel ? `Printwerk ${regel.nummer}` : '');
  if (!naam) throw new DomeinFout('Geef de printopdracht een naam');
  const aantal = getal(body?.aantal ?? regel?.aantal ?? 1, 'Aantal stuks', { strikt: true });
  const id = Number(db.prepare(`INSERT INTO printopdrachten (printer_id, dossier_regel_id, soort, naam, aantal, volgorde, notities) VALUES (?,?,?,?,?,?,?)`)
    .run(printer.id, regel?.id ?? null, soort, naam, aantal, volgendeVolgorde(db, printer.id), String(body?.notities || '').trim() || null).lastInsertRowid);
  if (regel) logGebeurtenis(db, 'dossier', regel.dossier_id, 'status', `Printopdracht "${naam}" gepland op ${printer.naam}`);
  return id;
}

export function wijzigOpdracht(db, o, body) {
  if (o.status === 'voltooid' || o.status === 'geannuleerd') throw new DomeinFout('Deze printopdracht is afgesloten');
  const naam = String(body?.naam ?? o.naam).trim();
  if (!naam) throw new DomeinFout('Geef de printopdracht een naam');
  const aantal = getal(body?.aantal ?? o.aantal, 'Aantal stuks', { strikt: true });
  let printerId = o.printer_id;
  if (body?.printer_id && Number(body.printer_id) !== o.printer_id) {
    if (o.status === 'bezig') throw new DomeinFout('Een opdracht die bezig is, kan niet naar een andere printer');
    const p = db.prepare('SELECT id FROM printers WHERE id = ? AND actief = 1').get(Number(body.printer_id));
    if (!p) throw new DomeinFout('Onbekende printer');
    printerId = p.id;
  }
  db.prepare('UPDATE printopdrachten SET naam = ?, aantal = ?, printer_id = ?, volgorde = CASE WHEN printer_id = ? THEN volgorde ELSE ? END, notities = ? WHERE id = ?')
    .run(naam, aantal, printerId, printerId, volgendeVolgorde(db, printerId), body?.notities !== undefined ? (String(body.notities).trim() || null) : o.notities, o.id);
}

// Eén plaats omhoog of omlaag in de wachtrij van dezelfde printer.
export function verschuif(db, o, richting) {
  const open = leesOpdrachten(db, { printer_id: o.printer_id, open: true });
  const i = open.findIndex(x => x.id === o.id);
  const j = richting === 'op' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= open.length) return;
  const [a, b] = [open[i], open[j]];
  const upd = db.prepare('UPDATE printopdrachten SET volgorde = ? WHERE id = ?');
  upd.run(b.volgorde, a.id); upd.run(a.volgorde === b.volgorde ? a.volgorde + (richting === 'op' ? 1 : -1) : a.volgorde, b.id);
}

export function bevestig(db, o, aantalGoed) {
  if (!['te_bevestigen', 'mislukt'].includes(o.status)) throw new DomeinFout(o.status === 'bezig' ? 'De print loopt nog.' : 'Er is nog geen geslaagde run om te bevestigen.');
  if (!o.runs.some(r => r.uitkomst === 'klaar')) throw new DomeinFout('Er is geen geslaagde run. Koppel eerst een herprint of annuleer de opdracht.');
  const n = getal(aantalGoed, 'Aantal goede stuks');
  // productiekost per goed stuk vastleggen (stap 6c): echte kost + arbeid apart
  const pk = productiekost(db, o, n);
  db.prepare(`UPDATE printopdrachten SET aantal_goed = ?, voltooid_op = datetime('now'), productiekost_stuk = ?, arbeid_stuk = ?, kost_onvolledig = ? WHERE id = ?`)
    .run(n, pk.per_stuk, pk.arbeid_stuk, pk.onvolledig ? 1 : 0, o.id);
  const nl = v => String(v).replace('.', ',');
  let extra = '';
  // eigen product → goede stuks in voorraad (reden productie), aan de productiekost
  if (o.eindproduct_id && n > 0) {
    boekIn(db, { artikelId: o.eindproduct_id, aantal: n, prijs: pk.per_stuk != null ? Math.round(pk.per_stuk * 10000) / 10000 : null, reden: 'productie',
      bronType: 'printopdracht', bronId: o.id, notitie: `Printopdracht "${o.naam}"${o.dossier_nummer ? ` (dossier ${o.dossier_nummer})` : ''}` });
    extra = `; ${nl(n)} × ${o.eindproduct} in voorraad`;
  }
  if (o.dossier_id) logGebeurtenis(db, 'dossier', o.dossier_id, 'status', `Printopdracht "${o.naam}" voltooid: ${nl(n)} goede stuks${extra}`);
}

// Wat deze printopdracht in voorraad boekte (en nog niet teruggedraaid is).
function geboekt(db, opdrachtId) {
  return db.prepare(`SELECT COALESCE(SUM(aantal), 0) n FROM voorraad_mutaties WHERE bron_type = 'printopdracht' AND bron_id = ?`).get(opdrachtId).n;
}
// Heropenen: de geboekte eindproducten terug uit voorraad, maar enkel als
// die partij nog volledig op voorraad ligt (anders eerst corrigeren).
function draaiBoekingTerug(db, o) {
  if (geboekt(db, o.id) <= 1e-9) return;
  const partijen = db.prepare(`SELECT p.* FROM voorraad_partijen p JOIN voorraad_mutaties m ON m.partij_id = p.id
    WHERE m.bron_type = 'printopdracht' AND m.bron_id = ? AND m.reden = 'productie' AND m.aantal > 0 AND p.aantal_resterend > 0`).all(o.id);
  const nog = partijen.reduce((t, p) => t + p.aantal_resterend, 0);
  if (nog + 1e-9 < geboekt(db, o.id)) {
    throw new DomeinFout('De stuks van deze printopdracht zijn al (deels) verkocht of gebruikt. Corrigeer eerst de voorraad (Voorraad → artikel) als je ze wilt heropenen.');
  }
  const zet = db.prepare('UPDATE voorraad_partijen SET aantal_resterend = 0 WHERE id = ?');
  const mut = db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden, bron_type, bron_id, notitie) VALUES (?,?,?,?,?,?,?)`);
  for (const p of partijen) {
    zet.run(p.id);
    mut.run(p.artikel_id, p.id, -p.aantal_resterend, 'correctie', 'printopdracht', o.id, `Printopdracht "${o.naam}" heropend`);
  }
}
export function heropen(db, o) {
  if (o.status !== 'voltooid' && o.status !== 'geannuleerd') throw new DomeinFout('Deze printopdracht is niet afgesloten');
  draaiBoekingTerug(db, o);
  db.prepare('UPDATE printopdrachten SET aantal_goed = NULL, voltooid_op = NULL, geannuleerd_op = NULL, productiekost_stuk = NULL, arbeid_stuk = NULL, kost_onvolledig = 0, volgorde = ? WHERE id = ?')
    .run(volgendeVolgorde(db, o.printer_id), o.id);
}
// Een geplande opdracht (nog niets geprint) van een gestart dossier volgt de
// regel: annuleren of verwijderen zou ze meteen terug laten komen.
function volgtRegel(db, o) {
  if (!o.dossier_id || o.runs.length || o.voltooid_op) return;
  const d = db.prepare('SELECT gestart_op FROM dossiers WHERE id = ?').get(o.dossier_id);
  if (d?.gestart_op) {
    throw new DomeinFout(`Deze printopdracht volgt de regel van dossier ${o.dossier_nummer}. Verlaag het aantal op die regel of verwijder de regel; de printopdracht past zich dan aan.`);
  }
}
export function annuleer(db, o) {
  if (o.status === 'voltooid' || o.status === 'geannuleerd') throw new DomeinFout('Deze printopdracht is al afgesloten');
  volgtRegel(db, o);
  if (o.status === 'bezig') throw new DomeinFout('De print loopt nog. Annuleer eerst de print op de printer.');
  db.prepare(`UPDATE printopdrachten SET geannuleerd_op = datetime('now') WHERE id = ?`).run(o.id);
  if (o.dossier_id) logGebeurtenis(db, 'dossier', o.dossier_id, 'status', `Printopdracht "${o.naam}" geannuleerd`);
}
export function verwijder(db, o) {
  volgtRegel(db, o);
  if (o.runs.length) throw new DomeinFout('Er zijn al runs aan gekoppeld: annuleer de opdracht in plaats van ze te verwijderen.');
  db.prepare('DELETE FROM printopdrachten WHERE id = ?').run(o.id);
}

// ── runs koppelen ───────────────────────────────────────────────────────
// Een opdracht die op "te bevestigen" staat (laatste run geslaagd) is klaar
// om te bevestigen, niet om opnieuw te printen: geen voorstel en geen
// "volgende" (25-09). Na een MISLUKTE poging blijft ze wel voorgesteld.
export const NIET_TE_BEVESTIGEN = `COALESCE((SELECT x.uitkomst FROM printruns x WHERE x.printopdracht_id = o.id ORDER BY x.gestart_op DESC, x.id DESC LIMIT 1), '') <> 'klaar'`;
export function volgendeOpdracht(db, printerId) {
  return db.prepare(`SELECT o.id, o.naam FROM printopdrachten o WHERE o.printer_id = ? AND o.voltooid_op IS NULL AND o.geannuleerd_op IS NULL
    AND ${NIET_TE_BEVESTIGEN} ORDER BY o.volgorde, o.id LIMIT 1`).get(printerId) || null;
}
export function voorstelVoorRun(db, run) {
  return db.prepare(`SELECT o.id, o.naam FROM printopdrachten o WHERE o.printer_id = ? AND o.voltooid_op IS NULL AND o.geannuleerd_op IS NULL
    AND NOT EXISTS (SELECT 1 FROM printruns r WHERE r.printopdracht_id = o.id AND r.uitkomst = 'bezig' AND r.id <> ?)
    AND ${NIET_TE_BEVESTIGEN} ORDER BY o.volgorde, o.id LIMIT 1`).get(run.printer_id, run.id) || null;
}

// keuze: { printopdracht_id } | { nieuw: { naam, aantal, soort } } | { intern: 'kalibratie'|'test'|'overig' }
export function koppelRun(db, run, keuze) {
  if (run.printopdracht_id && leesOpdracht(db, run.printopdracht_id)?.status === 'voltooid') {
    throw new DomeinFout('Deze run hoort bij een bevestigde printopdracht. Heropen die eerst.');
  }
  if (keuze?.intern) {
    if (!INTERN[keuze.intern]) throw new DomeinFout('Onbekende interne soort');
    db.prepare('UPDATE printruns SET printopdracht_id = NULL, intern = ? WHERE id = ?').run(keuze.intern, run.id);
    return;
  }
  let opdrachtId = keuze?.printopdracht_id ? Number(keuze.printopdracht_id) : null;
  if (!opdrachtId && keuze?.nieuw) opdrachtId = maakOpdracht(db, { ...keuze.nieuw, printer_id: run.printer_id });
  const o = opdrachtId ? leesOpdracht(db, opdrachtId) : null;
  if (!o) throw new DomeinFout('Kies een printopdracht, maak een nieuwe of markeer de run als intern');
  if (o.status === 'voltooid' || o.status === 'geannuleerd') throw new DomeinFout('Deze printopdracht is afgesloten');
  if (o.runs.some(r => r.uitkomst === 'bezig' && r.id !== run.id)) throw new DomeinFout('Aan deze printopdracht hangt al een lopende print');
  // opdracht uit de wachtrij van een andere printer → verhuist naar deze printer
  if (o.printer_id !== run.printer_id) {
    db.prepare('UPDATE printopdrachten SET printer_id = ?, volgorde = ? WHERE id = ?').run(run.printer_id, volgendeVolgorde(db, run.printer_id), o.id);
  }
  db.prepare('UPDATE printruns SET printopdracht_id = ?, intern = NULL WHERE id = ?').run(o.id, run.id);
  if (o.dossier_id) logGebeurtenis(db, 'dossier', o.dossier_id, 'status', `Run gekoppeld aan printopdracht "${o.naam}"${run.bestand ? ` (${run.bestand})` : ''}`);
}
export function ontkoppelRun(db, run) {
  if (run.printopdracht_id) {
    const o = leesOpdracht(db, run.printopdracht_id);
    if (o?.status === 'voltooid') throw new DomeinFout('De printopdracht is al bevestigd. Heropen ze eerst.');
  }
  db.prepare('UPDATE printruns SET printopdracht_id = NULL, intern = NULL WHERE id = ?').run(run.id);
}

// ── werkelijke tijd en kWh per dossierregel (werkbon) ────────────────────
// Geslaagd = runs met uitkomst "klaar"; mislukt/geannuleerd = kost voor jou.
// Kost van een mislukte poging = elektriciteit + machinetarief van de printer
// waarop ze liep (verloren filament is niet gekend en telt niet mee).
export function metingenPerRegel(db, dossierId) {
  const runs = db.prepare(`SELECT r.*, o.dossier_regel_id, p.machine_per_uur FROM printruns r JOIN printopdrachten o ON o.id = r.printopdracht_id
    JOIN dossier_regels dr ON dr.id = o.dossier_regel_id JOIN printers p ON p.id = r.printer_id
    WHERE dr.dossier_id = ? AND r.uitkomst <> 'bezig'`).all(dossierId);
  const kwhPrijs = db.prepare(`SELECT waarde FROM tarieven WHERE sleutel = 'kwh_prijs'`).get()?.waarde ?? null;
  const leeg = () => ({ runs: 0, uren: 0, kwh: 0, kwh_onbekend: false, kost: 0, kost_onvolledig: false });
  const per = new Map();
  for (const r of runs) {
    const x = per.get(r.dossier_regel_id) || { geslaagd: leeg(), mislukt: leeg() };
    const doel = r.uitkomst === 'klaar' ? x.geslaagd : x.mislukt;
    const u = duurU(r);
    doel.runs += 1; doel.uren += u;
    if (r.kwh == null) doel.kwh_onbekend = true; else doel.kwh += r.kwh;
    if (r.kwh == null || kwhPrijs == null || r.machine_per_uur == null) doel.kost_onvolledig = true;
    doel.kost += (r.kwh ?? 0) * (kwhPrijs ?? 0) + u * (r.machine_per_uur ?? 0);
    per.set(r.dossier_regel_id, x);
  }
  const rond = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
  for (const x of per.values()) for (const k of ['geslaagd', 'mislukt']) {
    x[k].uren = rond(x[k].uren, 4); x[k].kwh = rond(x[k].kwh, 4); x[k].kost = rond(x[k].kost, 2);
  }
  return per;
}

// ── productie van een dossier ────────────────────────────────────────────
// 'geen' (nog geen printopdracht) | 'productie' | 'klaar' | null (geen printregels).
// Klaar = elke printregel heeft genoeg goede stuks uit voltooide opdrachten.
function goedPerRegel(ops) {
  const m = new Map();
  for (const o of ops) if (o.voltooid_op) m.set(o.dossier_regel_id, (m.get(o.dossier_regel_id) || 0) + (o.aantal_goed || 0));
  return m;
}
function statusUit(printregels, ops) {
  if (!printregels.length) return null;
  if (!ops.some(o => !o.geannuleerd_op)) return 'geen';
  const goed = goedPerRegel(ops);
  return printregels.every(r => (goed.get(r.id) || 0) >= Number(r.aantal ?? 1) - 1e-9) ? 'klaar' : 'productie';
}
export function productieVan(db, dossierId) {
  const printregels = db.prepare(`SELECT id, aantal FROM dossier_regels WHERE dossier_id = ? AND type = 'printen'`).all(dossierId);
  if (!printregels.length) return null;
  const ops = db.prepare(`SELECT o.dossier_regel_id, o.aantal_goed, o.voltooid_op, o.geannuleerd_op FROM printopdrachten o
    JOIN dossier_regels r ON r.id = o.dossier_regel_id WHERE r.dossier_id = ?`).all(dossierId);
  return statusUit(printregels, ops);
}

// Voor het Productie-tabblad van een dossier: per printregel besteld, gepland,
// goed en de opdrachten zelf.
export function productieOverzicht(db, dossierId, regels) {
  const printregels = regels.filter(r => r.type === 'printen');
  const ops = leesOpdrachten(db, { dossier_id: dossierId });
  const goed = goedPerRegel(ops);
  return {
    status: statusUit(printregels, ops),
    aantal_opdrachten: ops.length,
    te_koppelen_runs: teKoppelenVoorDossier(db, dossierId, ops),
    regels: printregels.map(r => {
      const eigen = ops.filter(o => o.dossier_regel_id === r.id);
      const open = eigen.filter(o => !o.voltooid_op && !o.geannuleerd_op);
      const eindproduct = r.artikel_id ? db.prepare('SELECT id, naam FROM artikelen WHERE id = ?').get(r.artikel_id) : null;
      // automatische flow: nog te plannen (regel zonder printer) of te veel geprint
      const v = verdeling(r, ops);
      const teVeel = Math.max(0, v.bijdrage - v.besteld);
      return { regel_id: r.id, omschrijving: r.omschrijving, printer_id: r.printer_id, besteld: Number(r.aantal ?? 1), eindproduct,
        goed: goed.get(r.id) || 0, gepland: open.reduce((t, o) => t + o.aantal, 0), opdrachten: eigen,
        te_plannen: v.tekort > EPS ? Math.round(v.tekort * 1000) / 1000 : 0, te_veel: teVeel > EPS ? Math.round(teVeel * 1000) / 1000 : 0 };
    }),
  };
}

// Runs die nog niet gekoppeld zijn, op de printers van de OPEN
// printopdrachten van dit dossier, van de laatste 48 u (25-09: koppelen
// vanuit het dossier). Voorstel = de opdracht van dit dossier op die printer
// waar nog geen andere print op loopt. Koppelen blijft altijd jouw keuze.
export function teKoppelenVoorDossier(db, dossierId, ops) {
  const open = ops.filter(o => !o.voltooid_op && !o.geannuleerd_op);
  if (!open.length) return [];
  const printers = [...new Set(open.map(o => o.printer_id))];
  const grens = new Date(Date.now() - 48 * 3600e3).toISOString();
  const runs = db.prepare(`SELECT r.*, p.naam AS printer FROM printruns r JOIN printers p ON p.id = r.printer_id
    WHERE r.printopdracht_id IS NULL AND r.intern IS NULL AND r.gestart_op >= ? AND r.printer_id IN (${printers.map(() => '?').join(',')})
    ORDER BY r.gestart_op`).all(grens, ...printers);
  return runs.map(r => {
    const kandidaat = open.find(o => o.printer_id === r.printer_id && !o.runs.some(x => x.uitkomst === 'bezig') && o.status !== 'te_bevestigen');
    const einde = r.geeindigd_op ? Date.parse(r.geeindigd_op) : Date.now();
    return { id: r.id, printer_id: r.printer_id, printer: r.printer, bestand: r.bestand, gestart_op: r.gestart_op, geeindigd_op: r.geeindigd_op,
      uitkomst: r.uitkomst, duur_min: Math.round((einde - Date.parse(r.gestart_op)) / 60000),
      voorstel: kandidaat ? { id: kandidaat.id, naam: kandidaat.naam, uitleg: 'opdracht van dit dossier op deze printer' } : null };
  });
}

// Een printregel met printopdrachten: weg of van soort wisselen kan enkel
// als er op geen enkele opdracht al geprint is (runs) en geen voltooid is;
// die opdrachten verdwijnen dan mee (automatische flow, 25-09). Geeft de
// regel-id's terug waarvan de opdrachten gewist moeten worden.
// (gebruikt door bewaarRegels, zoals controleerGeleverd)
export function controleerPrintopdrachten(db, dossierId, nieuweRegels) {
  const rijen = db.prepare(`SELECT r.id, r.omschrijving, COUNT(o.id) n,
      SUM(CASE WHEN o.voltooid_op IS NOT NULL OR EXISTS (SELECT 1 FROM printruns x WHERE x.printopdracht_id = o.id) THEN 1 ELSE 0 END) AS geprint
    FROM dossier_regels r JOIN printopdrachten o ON o.dossier_regel_id = r.id
    WHERE r.dossier_id = ? GROUP BY r.id`).all(dossierId);
  const wissen = [];
  for (const x of rijen) {
    const nieuw = nieuweRegels.find(r => r.id === x.id);
    const naam = `"${x.omschrijving || 'Printwerk'}"`;
    if (!nieuw || nieuw.type !== 'printen') {
      if (x.geprint) throw new DomeinFout(!nieuw
        ? `Regel ${naam} is al (deels) geprint en kan niet weg. Annuleer eerst de printopdrachten (Productie).`
        : `Regel ${naam} is al (deels) geprint: het blijft een printregel.`);
      wissen.push(x.id);
      continue;
    }
    const oud = db.prepare('SELECT artikel_id FROM dossier_regels WHERE id = ?').get(x.id).artikel_id;
    const geboektIets = db.prepare(`SELECT 1 FROM voorraad_mutaties m JOIN printopdrachten o ON o.id = m.bron_id
      WHERE m.bron_type = 'printopdracht' AND o.dossier_regel_id = ? GROUP BY m.bron_id HAVING SUM(m.aantal) > 0`).get(x.id);
    if (geboektIets && (nieuw.artikel_id ?? null) !== (oud ?? null)) {
      throw new DomeinFout(`Regel ${naam}: er staan al stuks in voorraad van dit eindproduct. Het artikel kan niet meer wijzigen (heropen eerst de printopdracht).`);
    }
  }
  return wissen;
}

// Dossier geannuleerd → open printopdrachten mee annuleren (niet als er een
// print loopt: die moet eerst stoppen).
export function annuleerVoorDossier(db, dossierId) {
  const open = leesOpdrachten(db, { dossier_id: dossierId, open: true });
  const bezig = open.find(o => o.status === 'bezig');
  if (bezig) throw new DomeinFout(`Printopdracht "${bezig.naam}" is nog aan het printen. Wacht tot de print klaar is of stop ze eerst.`);
  const upd = db.prepare(`UPDATE printopdrachten SET geannuleerd_op = datetime('now') WHERE id = ?`);
  for (const o of open) upd.run(o.id);
  return open.length;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTOMATISCHE FLOW (25-09): printopdrachten volgen de regels
// ═══════════════════════════════════════════════════════════════════════
// Enkel voor een GESTART dossier (knop Starten of offerte aanvaard). Per
// printregel:
// - "vast" = opdrachten waar al op geprint is (runs) of die voltooid zijn:
//   die raakt de flow nooit aan. Ze tellen mee voor hun aantal (voltooid:
//   het aantal goede stuks).
// - "gepland" = open opdrachten zonder runs: die volgen de regel (aantal;
//   printer en naam enkel als jij ze niet zelf veranderd hebt).
// - te weinig → de eerste geplande opdracht wordt groter, of er komt een
//   extra opdracht voor het verschil (op de printer van de regel)
// - te veel → geplande opdrachten worden kleiner of verdwijnen; is er al
//   meer geprint dan nodig, dan enkel een melding (productieOverzicht)
// - printregel zonder printer → geen nieuwe opdracht (melding)
const EPS = 1e-9;
const naamVanRegel = (r, nummer) => String(r.omschrijving || '').trim() || `Printwerk ${nummer}`;

// Verdeling van de opdrachten van één printregel (ook voor het overzicht).
export function verdeling(r, ops) {
  const eigen = ops.filter(o => o.dossier_regel_id === r.id);
  const heeftRuns = o => (o.aantal_runs ?? o.runs?.length ?? 0) > 0;
  const vast = eigen.filter(o => !o.geannuleerd_op && (o.voltooid_op || heeftRuns(o)));
  const gepland = eigen.filter(o => !o.geannuleerd_op && !o.voltooid_op && !heeftRuns(o));
  const bijdrage = vast.reduce((t, o) => t + (o.voltooid_op ? Number(o.aantal_goed || 0) : Number(o.aantal)), 0);
  const inGepland = gepland.reduce((t, o) => t + Number(o.aantal), 0);
  const besteld = Number(r.aantal ?? 1);
  return { vast, gepland, bijdrage, inGepland, besteld, tekort: besteld - bijdrage - inGepland };
}

// behoud = een opdracht die je net zelf maakte of wijzigde: die blijft zoals
// ze is zolang het kan (de andere geplande opdrachten passen zich aan).
export function synchroniseer(db, dossierId, { oudeRegels = null, behoud = null } = {}) {
  const d = db.prepare('SELECT id, nummer, gestart_op, geannuleerd_op FROM dossiers WHERE id = ?').get(dossierId);
  if (!d?.gestart_op || d.geannuleerd_op) return;
  const regels = db.prepare(`SELECT id, omschrijving, aantal, printer_id FROM dossier_regels WHERE dossier_id = ? AND type = 'printen' ORDER BY volgorde, id`).all(dossierId);
  const ops = db.prepare(`SELECT o.*, (SELECT COUNT(*) FROM printruns x WHERE x.printopdracht_id = o.id) AS aantal_runs
    FROM printopdrachten o JOIN dossier_regels r ON r.id = o.dossier_regel_id WHERE r.dossier_id = ? ORDER BY o.volgorde, o.id`).all(dossierId);
  const oud = new Map((oudeRegels || []).map(r => [r.id, r]));
  const zetAantal = db.prepare('UPDATE printopdrachten SET aantal = ? WHERE id = ?');
  const wis = db.prepare('DELETE FROM printopdrachten WHERE id = ?');
  const nl = v => String(Math.round(v * 1000) / 1000).replace('.', ',');
  const logboek = [];
  for (const r of regels) {
    const v = verdeling(r, ops);
    const o0 = oud.get(r.id);
    // printer / naam van geplande opdrachten volgen een wijziging op de regel,
    // tenzij je die opdracht zelf anders zette
    for (const o of v.gepland) {
      if (o0 && r.printer_id && o0.printer_id !== r.printer_id && o.printer_id === o0.printer_id
        && db.prepare('SELECT 1 FROM printers WHERE id = ? AND actief = 1').get(r.printer_id)) {
        db.prepare('UPDATE printopdrachten SET printer_id = ?, volgorde = ? WHERE id = ?').run(r.printer_id, volgendeVolgorde(db, r.printer_id), o.id);
      }
      if (o0 && naamVanRegel(o0, d.nummer) !== naamVanRegel(r, d.nummer) && o.naam === naamVanRegel(o0, d.nummer)) {
        db.prepare('UPDATE printopdrachten SET naam = ? WHERE id = ?').run(naamVanRegel(r, d.nummer), o.id);
      }
    }
    if (v.tekort > EPS) {
      const groei = v.gepland.find(o => o.id !== behoud);
      if (groei) {
        zetAantal.run(Number(groei.aantal) + v.tekort, groei.id);
      } else if (r.printer_id && db.prepare('SELECT 1 FROM printers WHERE id = ? AND actief = 1').get(r.printer_id)) {
        const extra = v.vast.length > 0;
        maakOpdracht(db, { printer_id: r.printer_id, dossier_regel_id: r.id, aantal: v.tekort, naam: naamVanRegel(r, d.nummer) });
        if (extra) logboek.push(`extra printopdracht voor ${nl(v.tekort)} stuk${v.tekort === 1 ? '' : 's'} van "${naamVanRegel(r, d.nummer)}"`);
      }
    } else if (v.tekort < -EPS) {
      let teVeel = -v.tekort;
      const volgorde = [...v.gepland.filter(o => o.id !== behoud).reverse(), ...v.gepland.filter(o => o.id === behoud)];
      for (const o of volgorde) {
        if (teVeel <= EPS) break;
        const af = Math.min(teVeel, Number(o.aantal));
        if (Number(o.aantal) - af <= EPS) { wis.run(o.id); logboek.push(`printopdracht "${o.naam}" vervallen`); }
        else zetAantal.run(Number(o.aantal) - af, o.id);
        teVeel -= af;
      }
    }
  }
  if (logboek.length) logGebeurtenis(db, 'dossier', dossierId, 'status', `Automatisch: ${logboek.join('; ')}`);
}

// Opdrachten die bij een regel horen die weg gaat (of geen printregel meer
// is): enkel toegelaten als er nog niets op geprint is — die verdwijnen mee.
export function wisOpdrachtenVanRegels(db, regelIds) {
  const del = db.prepare('DELETE FROM printopdrachten WHERE dossier_regel_id = ?');
  for (const id of regelIds) del.run(id);
}
