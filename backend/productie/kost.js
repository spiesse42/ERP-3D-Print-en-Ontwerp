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

// opdracht: { id, dossier_regel_id, aantal, aantal_goed? }; goed = aantal goede stuks
// materialen (optioneel, enkel losse opdracht): nog niet bewaard filament om
// vooraf te rekenen (bevestigvenster), in plaats van wat in de databank staat.
export function productiekost(db, opdracht, goed = opdracht.aantal_goed, { materialen = null } = {}) {
  const t = getTarieven(db);
  const regel = opdracht.dossier_regel_id ? db.prepare('SELECT * FROM dossier_regels WHERE id = ?').get(opdracht.dossier_regel_id) : null;
  const deel = regel ? opdracht.aantal / (Number(regel.aantal) || 1) : 1;
  const ontbreekt = [];
  let filament = 0;
  const mat = regel
    ? db.prepare('SELECT artikel_id, filament_type_id, gram FROM dossier_regel_materialen WHERE regel_id = ?').all(regel.id)
    : (materialen ?? db.prepare('SELECT artikel_id, filament_type_id, gram FROM printopdracht_materialen WHERE printopdracht_id = ?').all(opdracht.id));
  for (const m of mat) {
    if (!m.gram) continue;
    const kg = kostPerKg(db, m);
    if (kg == null) { ontbreekt.push(`inkoopprijs filament ${filamentNaam(db, m)} (Voorraad → artikel → inkoopprijs)`); continue; }
    filament += m.gram * deel / 1000 * kg;
  }
  if (!mat.some(m => m.gram > 0)) {
    ontbreekt.push(regel ? 'gewicht filament (op de printregel van het dossier)'
      : mat.length ? 'gewicht filament (open de printopdracht → Filament)' : 'filament en gewicht (open de printopdracht → Filament)');
  }
  const runs = db.prepare(`SELECT r.*, p.machine_per_uur FROM printruns r JOIN printers p ON p.id = r.printer_id
    WHERE r.printopdracht_id = ? AND r.uitkomst <> 'bezig'`).all(opdracht.id);
  let energie = 0, machine = 0;
  for (const r of runs) {
    if (r.kwh == null) ontbreekt.push('kWh van een run (open de run → Verbruik aanvullen)'); else if (t.kwh_prijs == null) ontbreekt.push('kWh-prijs (Instellingen → Tarieven)'); else energie += r.kwh * t.kwh_prijs;
    if (r.machine_per_uur == null) ontbreekt.push(`machinetarief ${db.prepare('SELECT naam FROM printers WHERE id = ?').get(r.printer_id)?.naam || ''}`.trim()); else machine += duurU(r) * r.machine_per_uur;
  }
  const bmcu = runs.length * (t.bmcu_per_job ?? 0);
  const voorb = regel?.voorbereiding_min ?? t.voorbereiding_min ?? 0;
  const nabew = regel?.nabewerking_min ?? t.nabewerking_min ?? 0;
  const arbeid = (voorb + nabew) / 60 * (t.arbeid_per_uur ?? 0) * deel;
  const kost = filament + energie + machine + bmcu;
  const n = Number(goed) || 0;
  return {
    filament: rond(filament), energie: rond(energie), machine: rond(machine), bmcu: rond(bmcu), arbeid: rond(arbeid),
    kost: rond(kost), runs: runs.length, goed: n,
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
  let filament = 0;
  for (const m of o.materialen || []) {
    if (!m.gram) continue;
    const kg = kostPerKg(db, m);
    if (kg == null) ontbreekt.push(`inkoopprijs filament ${m.naam || ''}`.trim()); else filament += m.gram * deel / 1000 * kg;
  }
  const p = db.prepare('SELECT naam, machine_per_uur, verbruik_watt FROM printers WHERE id = ?').get(o.printer_id);
  const uren = regel?.tijd_min != null ? Number(regel.tijd_min) * deel / 60 : null;
  let energie = 0, machine = 0;
  if (uren == null) ontbreekt.push('printtijd');
  else {
    if (p?.verbruik_watt == null || t.kwh_prijs == null) ontbreekt.push('verbruik (watt) of kWh-prijs'); else energie = p.verbruik_watt / 1000 * uren * t.kwh_prijs;
    if (p?.machine_per_uur == null) ontbreekt.push(`machinetarief ${p?.naam || ''}`.trim()); else machine = uren * p.machine_per_uur;
  }
  const bmcu = t.bmcu_per_job ?? 0;
  const voorb = regel?.voorbereiding_min ?? t.voorbereiding_min ?? 0;
  const nabew = regel?.nabewerking_min ?? t.nabewerking_min ?? 0;
  const arbeid = (voorb + nabew) / 60 * (t.arbeid_per_uur ?? 0) * deel;
  const kost = filament + energie + machine + bmcu;
  const n = Number(o.aantal) || 0;
  return { filament: rond(filament), energie: rond(energie), machine: rond(machine), bmcu: rond(bmcu), arbeid: rond(arbeid), kost: rond(kost),
    per_stuk: n > 0 ? rond(kost / n) : null, arbeid_stuk: n > 0 ? rond(arbeid / n) : null, onvolledig: ontbreekt.length > 0, ontbreekt: [...new Set(ontbreekt)] };
}

// ── kost van één run (08-10): stroom (gemeten kWh), machinetijd, BMCU.
// Filament telt niet mee: wat een mislukte poging verbruikte is niet gekend.
export function runKost(db, r, t = getTarieven(db)) {
  if (r.uitkomst === 'bezig' || !r.gestart_op) return null;
  const p = db.prepare('SELECT machine_per_uur FROM printers WHERE id = ?').get(r.printer_id);
  const energie = r.kwh != null && t.kwh_prijs != null ? r.kwh * t.kwh_prijs : null;
  const machine = p?.machine_per_uur != null ? duurU(r) * p.machine_per_uur : null;
  const bmcu = t.bmcu_per_job ?? 0;
  return { energie: energie == null ? null : rond(energie), machine: machine == null ? null : rond(machine), bmcu: rond(bmcu),
    kost: rond((energie ?? 0) + (machine ?? 0) + bmcu), onvolledig: energie == null || machine == null };
}
