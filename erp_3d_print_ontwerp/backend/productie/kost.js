// ═══════════════════════════════════════════════════════════════════════
// PRODUCTIEKOST van een printopdracht (stap 6c)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (25-09): de ECHTE kost per goed stuk, om bij een eigen product te
// zien of de vaste verkoopprijs genoeg winst geeft. Dus NIET de rekenmotor
// (die rekent verkoopprijzen met marge), maar:
// - filament: gram van de printregel (naar rato van de stuks van deze
//   opdracht) × INKOOPprijs per kg (gemiddelde van de rollen in voorraad,
//   anders de laatst gekende prijs; rolgewicht van de prijsgroep). Een
//   LOSSE opdracht (zonder dossier) heeft sinds 26-09 haar eigen filament
//   (printopdracht_materialen, gram voor de hele opdracht)
// - elektriciteit: gemeten kWh van alle runs (ook mislukte) × kWh-prijs
// - machine: printtijd van alle runs × machinetarief van de printer
// - BMCU/AMS-slijtage: per run
// - arbeid apart: voorbereiding + nabewerking × uurloon (naar rato)
// Gedeeld door het aantal goede stuks. Verloren filament van een mislukte
// poging is niet gekend en telt niet mee.
import { getTarieven } from '../domein/hulp.js';

const rond = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;

// Inkoopprijs per kg van een filament (artikel = kleur) of een prijsgroep.
export function kostPerKg(db, { artikel_id = null, filament_type_id = null }) {
  if (artikel_id) {
    const a = db.prepare(`SELECT a.inkoopprijs, ft.rolgewicht_g FROM artikelen a JOIN filament_types ft ON ft.id = a.filament_type_id WHERE a.id = ?`).get(artikel_id);
    if (!a) return null;
    const gem = db.prepare(`SELECT SUM(aantal_resterend * prijs_per_eenheid) / SUM(aantal_resterend) p FROM voorraad_partijen
      WHERE artikel_id = ? AND aantal_resterend > 0 AND prijs_per_eenheid IS NOT NULL`).get(artikel_id).p;
    const laatste = db.prepare(`SELECT prijs_per_eenheid p FROM voorraad_partijen WHERE artikel_id = ? AND prijs_per_eenheid IS NOT NULL
      ORDER BY ontvangen_op DESC, id DESC LIMIT 1`).get(artikel_id)?.p;
    const rol = gem ?? laatste ?? a.inkoopprijs;
    return rol == null ? null : rol / a.rolgewicht_g * 1000;
  }
  if (filament_type_id) {
    // enkel een prijsgroep gekozen: gemiddelde over alle kleuren van die groep
    const ft = db.prepare('SELECT rolgewicht_g FROM filament_types WHERE id = ?').get(filament_type_id);
    if (!ft) return null;
    const q = extra => db.prepare(`SELECT SUM(p.aantal_ontvangen * p.prijs_per_eenheid) / SUM(p.aantal_ontvangen) p FROM voorraad_partijen p
      JOIN artikelen a ON a.id = p.artikel_id WHERE a.filament_type_id = ? AND p.prijs_per_eenheid IS NOT NULL ${extra}`).get(filament_type_id).p;
    const rol = q('AND p.aantal_resterend > 0') ?? q('')
      ?? db.prepare(`SELECT AVG(inkoopprijs) p FROM artikelen WHERE filament_type_id = ? AND inkoopprijs IS NOT NULL`).get(filament_type_id).p;
    return rol == null ? null : rol / ft.rolgewicht_g * 1000;
  }
  return null;
}

// Leesbare naam voor de melding "inkoopprijs filament …".
function filamentNaam(db, m) {
  const r = m.artikel_id
    ? db.prepare(`SELECT COALESCE(a.naam, fm.naam || ' ' || mat.naam || ' · ' || k.naam) AS naam FROM artikelen a
        LEFT JOIN filament_types ft ON ft.id = a.filament_type_id LEFT JOIN filament_merken fm ON fm.id = ft.merk_id
        LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id LEFT JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.id = ?`).get(m.artikel_id)
    : db.prepare(`SELECT fm.naam || ' ' || mat.naam AS naam FROM filament_types ft JOIN filament_merken fm ON fm.id = ft.merk_id
        JOIN filament_materialen mat ON mat.id = ft.materiaal_id WHERE ft.id = ?`).get(m.filament_type_id);
  return r?.naam || '(onbekend)';
}

const duurU = r => ((r.geeindigd_op ? Date.parse(r.geeindigd_op) : Date.now()) - Date.parse(r.gestart_op)) / 3600e3;

// Arbeid (voorbereiding + nabewerking) van de regel, naar rato van de stuks.
// Leeg = standaard; de standaardvoorbereiding geldt per plaat, net als in de
// rekenmotor (15-10: vroeger maar 1× per regel, wat minder gaf dan de regel).
function arbeidVan(regel, t, deel) {
  const pp = Number(regel?.per_plaat) || 0;
  const platen = pp > 0 ? Math.max(1, Math.ceil((Number(regel.aantal) || 1) / pp - 1e-9)) : 1;
  const voorb = regel?.voorbereiding_min ?? (t.voorbereiding_min ?? 0) * platen;
  const nabew = regel?.nabewerking_min ?? t.nabewerking_min ?? 0;
  return { minuten: (voorb + nabew) * deel, euro: (voorb + nabew) / 60 * (t.arbeid_per_uur ?? 0) * deel };
}

// 15-10: filament per soort (naam), voor de kostenopbouw over een dossier.
function voegFilamentToe(lijst, naam, gram, kost) {
  const f = lijst.find(x => x.naam === naam);
  if (f) { f.gram += gram; f.kost += kost; } else lijst.push({ naam, gram, kost });
}
export const rondFilamenten = l => l.map(f => ({ naam: f.naam, gram: rond(f.gram, 1), kost: rond(f.kost) }));

// ── samen op één plaat (23-10) ────────────────────────────────────────────
// De runs hangen aan de trekker van de groep (plaat_groep); elk lid draagt
// een deel van stroom, machine en slijtage: naar gewicht, anders naar de
// geschatte printtijd, anders gelijk verdeeld. Geannuleerde leden niet.
export function runSleutel(db, o) {
  const g = o.plaat_groep !== undefined ? o.plaat_groep : db.prepare('SELECT plaat_groep FROM printopdrachten WHERE id = ?').get(o.id)?.plaat_groep;
  return g ?? o.id;
}
function maatVan(db, o, soort) {
  const regel = o.dossier_regel_id ? db.prepare('SELECT aantal, tijd_min FROM dossier_regels WHERE id = ?').get(o.dossier_regel_id) : null;
  const deel = regel ? Number(o.aantal) / (Number(regel.aantal) || 1) : 1;
  if (soort === 'tijd') return regel ? (Number(regel.tijd_min) || 0) * deel : 0;
  const g = regel
    ? db.prepare('SELECT COALESCE(SUM(gram), 0) g FROM dossier_regel_materialen WHERE regel_id = ?').get(o.dossier_regel_id).g
    : db.prepare('SELECT COALESCE(SUM(gram), 0) g FROM printopdracht_materialen WHERE printopdracht_id = ?').get(o.id).g;
  return g * deel;
}
export function aandeelInPlaat(db, o) {
  const groep = runSleutel(db, o);
  const leden = db.prepare('SELECT id, dossier_regel_id, aantal FROM printopdrachten WHERE plaat_groep = ? AND geannuleerd_op IS NULL').all(groep);
  if (leden.length <= 1 || !leden.some(l => l.id === o.id)) return 1;
  for (const soort of ['gram', 'tijd']) {
    const m = leden.map(l => maatVan(db, l, soort));
    const tot = m.reduce((t, x) => t + x, 0);
    if (tot > 0) return m[leden.findIndex(l => l.id === o.id)] / tot;
  }
  return 1 / leden.length;
}

// opdracht: { id, dossier_regel_id, aantal, aantal_goed? }; goed = aantal goede stuks
// materialen (optioneel, enkel losse opdracht): nog niet bewaard filament om
// vooraf te rekenen (bevestigvenster), in plaats van wat in de databank staat.
export function productiekost(db, opdracht, goed = opdracht.aantal_goed, { materialen = null } = {}) {
  const t = getTarieven(db);
  const regel = opdracht.dossier_regel_id ? db.prepare('SELECT * FROM dossier_regels WHERE id = ?').get(opdracht.dossier_regel_id) : null;
  const deel = regel ? opdracht.aantal / (Number(regel.aantal) || 1) : 1;
  const ontbreekt = [];
  let filament = 0, gram = 0;
  const filamenten = [];
  const mat = regel
    ? db.prepare('SELECT artikel_id, filament_type_id, gram FROM dossier_regel_materialen WHERE regel_id = ?').all(regel.id)
    : (materialen ?? db.prepare('SELECT artikel_id, filament_type_id, gram FROM printopdracht_materialen WHERE printopdracht_id = ?').all(opdracht.id));
  for (const m of mat) {
    if (!m.gram) continue;
    const kg = kostPerKg(db, m);
    const naam = filamentNaam(db, m);
    gram += m.gram * deel;
    if (kg == null) { ontbreekt.push(`inkoopprijs filament ${naam} (Voorraad → artikel → inkoopprijs)`); voegFilamentToe(filamenten, naam, m.gram * deel, 0); continue; }
    filament += m.gram * deel / 1000 * kg;
    voegFilamentToe(filamenten, naam, m.gram * deel, m.gram * deel / 1000 * kg);
  }
  if (!mat.some(m => m.gram > 0)) {
    ontbreekt.push(regel ? 'gewicht filament (op de printregel van het dossier)'
      : mat.length ? 'gewicht filament (open de printopdracht → Filament)' : 'filament en gewicht (open de printopdracht → Filament)');
  }
  const runs = db.prepare(`SELECT r.*, p.machine_per_uur, p.slijtage_per_print FROM printruns r JOIN printers p ON p.id = r.printer_id
    WHERE r.printopdracht_id = ? AND r.uitkomst <> 'bezig'`).all(runSleutel(db, opdracht));
  const aandeel = aandeelInPlaat(db, opdracht);   // 23-10: deel van een gedeelde plaat
  let energie = 0, machine = 0, kwh = 0, uren = 0;
  for (const r of runs) {
    kwh += r.kwh ?? 0; uren += duurU(r);
    if (r.kwh == null) ontbreekt.push('kWh van een run (open de run → Verbruik aanvullen)'); else if (t.kwh_prijs == null) ontbreekt.push('kWh-prijs (Instellingen → Tarieven)'); else energie += r.kwh * t.kwh_prijs;
    if (r.machine_per_uur == null) ontbreekt.push(`machinetarief ${db.prepare('SELECT naam FROM printers WHERE id = ?').get(r.printer_id)?.naam || ''}`.trim()); else machine += duurU(r) * r.machine_per_uur;
  }
  let bmcu = runs.reduce((s, r) => s + (r.slijtage_per_print ?? t.bmcu_per_job ?? 0), 0);
  energie *= aandeel; machine *= aandeel; bmcu *= aandeel; kwh *= aandeel; uren *= aandeel;
  const arb = arbeidVan(regel, t, deel);
  const arbeid = arb.euro;
  const kost = filament + energie + machine + bmcu;
  const n = Number(goed) || 0;
  return {
    filament: rond(filament), energie: rond(energie), machine: rond(machine), bmcu: rond(bmcu), arbeid: rond(arbeid),
    kost: rond(kost), runs: runs.length, mislukt: runs.filter(r => r.uitkomst !== 'klaar').length, goed: n,
    gram: rond(gram, 1), kwh: rond(kwh), uren: rond(uren), arbeid_min: rond(arb.minuten, 1), filamenten: rondFilamenten(filamenten),
    per_stuk: n > 0 ? rond(kost / n) : null,
    arbeid_stuk: n > 0 ? rond(arbeid / n) : null,
    onvolledig: ontbreekt.length > 0, ontbreekt: [...new Set(ontbreekt)],
  };
}

// ── SCHATTING vooraf van een printopdracht (08-10) ───────────────────────
// Zelfde opbouw als hierboven, maar met de printtijd van de dossierregel
// (naar rato van de stuks) en het verbruik (watt) van de printer i.p.v.
// metingen. Een losse opdracht heeft geen printtijd: enkel het filament.
export function schatOpdracht(db, o) {
  const t = getTarieven(db);
  const regel = o.dossier_regel_id ? db.prepare('SELECT * FROM dossier_regels WHERE id = ?').get(o.dossier_regel_id) : null;
  const deel = regel ? Number(o.aantal) / (Number(regel.aantal) || 1) : 1;
  const ontbreekt = [];
  let filament = 0, gram = 0;
  const filamenten = [];
  for (const m of o.materialen || []) {
    if (!m.gram) continue;
    const kg = kostPerKg(db, m);
    gram += m.gram * deel;
    const f = kg == null ? 0 : m.gram * deel / 1000 * kg;
    if (kg == null) ontbreekt.push(`inkoopprijs filament ${m.naam || ''}`.trim()); else filament += f;
    voegFilamentToe(filamenten, m.naam || '(onbekend)', m.gram * deel, f);
  }
  const p = db.prepare('SELECT naam, machine_per_uur, verbruik_watt, slijtage_per_print FROM printers WHERE id = ?').get(o.printer_id);
  const uren = regel?.tijd_min != null ? Number(regel.tijd_min) * deel / 60 : null;
  let energie = 0, machine = 0, kwh = 0;
  if (uren == null) ontbreekt.push('printtijd');
  else {
    if (p?.verbruik_watt != null) kwh = p.verbruik_watt / 1000 * uren;
    if (p?.verbruik_watt == null || t.kwh_prijs == null) ontbreekt.push('verbruik (watt) of kWh-prijs'); else energie = kwh * t.kwh_prijs;
    if (p?.machine_per_uur == null) ontbreekt.push(`machinetarief ${p?.naam || ''}`.trim()); else machine = uren * p.machine_per_uur;
  }
  const bmcu = p?.slijtage_per_print ?? t.bmcu_per_job ?? 0;
  const arb = arbeidVan(regel, t, deel);
  const arbeid = arb.euro;
  const kost = filament + energie + machine + bmcu;
  const n = Number(o.aantal) || 0;
  return { filament: rond(filament), energie: rond(energie), machine: rond(machine), bmcu: rond(bmcu), arbeid: rond(arbeid), kost: rond(kost),
    gram: rond(gram, 1), kwh: rond(kwh), uren: rond(uren ?? 0), runs: 1, arbeid_min: rond(arb.minuten, 1), filamenten: rondFilamenten(filamenten),
    per_stuk: n > 0 ? rond(kost / n) : null, arbeid_stuk: n > 0 ? rond(arbeid / n) : null, onvolledig: ontbreekt.length > 0, ontbreekt: [...new Set(ontbreekt)] };
}

// ── kost van één run (08-10): stroom (gemeten kWh), machinetijd, BMCU.
// Filament telt niet mee: wat een mislukte poging verbruikte is niet gekend.
export function runKost(db, r, t = getTarieven(db)) {
  if (r.uitkomst === 'bezig' || !r.gestart_op) return null;
  const p = db.prepare('SELECT machine_per_uur, slijtage_per_print FROM printers WHERE id = ?').get(r.printer_id);
  const energie = r.kwh != null && t.kwh_prijs != null ? r.kwh * t.kwh_prijs : null;
  const machine = p?.machine_per_uur != null ? duurU(r) * p.machine_per_uur : null;
  const bmcu = p?.slijtage_per_print ?? t.bmcu_per_job ?? 0;
  return { energie: energie == null ? null : rond(energie), machine: machine == null ? null : rond(machine), bmcu: rond(bmcu),
    kost: rond((energie ?? 0) + (machine ?? 0) + bmcu), onvolledig: energie == null || machine == null };
}

// Optellen: bedragen, hoeveelheden en filament per soort.
export function telOpbouw(lijst) {
  const som = { filament: 0, energie: 0, machine: 0, bmcu: 0, arbeid: 0, onderdelen: 0, kost: 0, gram: 0, kwh: 0, uren: 0, runs: 0, mislukt: 0, arbeid_min: 0, filamenten: [] };
  for (const d of lijst) {
    for (const k of Object.keys(som)) if (k !== 'filamenten') som[k] += Number(d[k]) || 0;
    for (const f of d.filamenten || []) {
      const x = som.filamenten.find(y => y.naam === f.naam);
      if (x) { x.gram += f.gram; x.kost += f.kost; } else som.filamenten.push({ ...f });
    }
  }
  const r = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
  for (const k of Object.keys(som)) if (k !== 'filamenten') som[k] = r(som[k], k === 'gram' || k === 'arbeid_min' ? 1 : k === 'kwh' || k === 'uren' ? 3 : 2);
  som.filamenten = som.filamenten.map(f => ({ naam: f.naam, gram: r(f.gram, 1), kost: r(f.kost) })).sort((a, b) => b.gram - a.gram);
  return som;
}
