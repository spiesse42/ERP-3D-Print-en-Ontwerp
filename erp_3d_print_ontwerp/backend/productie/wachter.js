// ═══════════════════════════════════════════════════════════════════════
// PRINTERWACHTER — één lus in de backend (stap 6a)
// ═══════════════════════════════════════════════════════════════════════
// Vervangt de logica van usePrinterData.js (browser) en sampler.js uit het
// oude pakket: werkt dus ook zonder open tabblad en zonder dubbele acties
// vanaf gsm + pc (domeinmodel → "Printerwachter").
// - leest elke PRINTERWACHTER_MS (standaard 15 s) alle gekoppelde printers
//   in één Home Assistant-aanroep
// - start van een print → nieuwe PRINTRUN; einde → run afsluiten
// - lessen uit het oude pakket: een einde (klaar/mislukt/geannuleerd) telt
//   pas na 2 opeenvolgende metingen (debounce), en een valse annulatie
//   herstelt zichzelf (zelfde bestand binnen 15 min opnieuw bezig → dezelfde
//   run loopt verder)
// - wattmeting bij elke tik; kWh = verschil van de kWh-meter, anders de
//   trapeziumregel over de wattmetingen (gaten > 120 s tellen niet mee)
import { getDb } from '../db/index.js';
import { haStaten, haIngesteld, meterOp } from '../integraties/homeassistant.js';
import { leesPrinter } from './adapters.js';

export const INTERVAL_MS = () => Number(process.env.PRINTERWACHTER_MS) || 15000;
const MAX_GAT_S = 120;
const HERSTEL_MIN = 15;
const EINDE_NA = 2;

const cache = new Map();      // printer_id → { lezing, bijgewerkt_op, fout }
const eindTeller = new Map(); // printer_id → aantal opeenvolgende "einde"-metingen
const aanTeVullen = new Set(); // onvolledige runs: kWh aanvullen uit de HA-geschiedenis
export const liveCache = () => cache;

const nu = () => new Date().toISOString();

export function kwhUitMetingen(db, runId) {
  const m = db.prepare('SELECT watt, tijdstip FROM wattmetingen WHERE run_id = ? ORDER BY tijdstip').all(runId);
  let joule = 0;
  for (let i = 1; i < m.length; i++) {
    const dt = Math.min((Date.parse(m[i].tijdstip) - Date.parse(m[i - 1].tijdstip)) / 1000, MAX_GAT_S);
    if (dt > 0) joule += ((m[i].watt + m[i - 1].watt) / 2) * dt;
  }
  return joule / 3.6e6;
}

// kWh van een run: verschil van de kWh-meter als die al versprongen is;
// zolang de meter niet verspringt (stekkers werken hun stand soms maar af
// en toe of in grote stappen bij) de wattmetingen (stap 6b).
export function kwhVanRun(db, run, kwhMeterNu = null) {
  const eind = run.kwh_eind ?? kwhMeterNu;
  if (run.kwh_start != null && eind != null && eind - run.kwh_start > 0) return eind - run.kwh_start;
  return kwhUitMetingen(db, run.id);
}

// Onvolledige run (gestart vóór de wachter hem zag): de meterstand op het
// starttijdstip opvragen in de geschiedenis van Home Assistant (stap 6b).
export async function vulAan(db, runId) {
  const run = db.prepare('SELECT r.*, p.kwh_entity FROM printruns r JOIN printers p ON p.id = r.printer_id WHERE r.id = ?').get(runId);
  if (!run?.kwh_entity) return { ok: false, reden: 'Geen kWh-meter ingesteld voor deze printer' };
  const start = await meterOp(run.kwh_entity, run.gestart_op);
  if (start == null) return { ok: false, reden: 'Geen meterstand gevonden in de geschiedenis van Home Assistant rond het starttijdstip' };
  let eind = run.kwh_eind;
  if (run.geeindigd_op && eind == null) eind = await meterOp(run.kwh_entity, run.geeindigd_op);
  db.prepare('UPDATE printruns SET kwh_start = ?, kwh_eind = COALESCE(?, kwh_eind), onvolledig = 0, aangevuld = 1 WHERE id = ?').run(start, eind, run.id);
  if (run.geeindigd_op) {
    const na = db.prepare('SELECT * FROM printruns WHERE id = ?').get(run.id);
    db.prepare('UPDATE printruns SET kwh = ? WHERE id = ?').run(Math.round(kwhVanRun(db, na) * 10000) / 10000, run.id);
  }
  return { ok: true, kwh_start: start };
}

export function openRun(db, printerId) {
  return db.prepare(`SELECT * FROM printruns WHERE printer_id = ? AND uitkomst = 'bezig' ORDER BY id DESC LIMIT 1`).get(printerId) || null;
}

export function startRun(db, printer, { bestand = null, kwh = null, gestart_op = null, bron = 'automatisch', onvolledig = false } = {}) {
  const id = db.prepare(`INSERT INTO printruns (printer_id, gestart_op, bestand, kwh_start, bron, onvolledig) VALUES (?,?,?,?,?,?)`)
    .run(printer.id, gestart_op || nu(), bestand, kwh, bron, onvolledig ? 1 : 0).lastInsertRowid;
  return Number(id);
}

export function sluitRun(db, run, uitkomst, kwhMeter = null) {
  const kwhEind = kwhMeter ?? null;
  const kwh = kwhVanRun(db, { ...run, kwh_eind: kwhEind });
  db.prepare(`UPDATE printruns SET uitkomst = ?, geeindigd_op = ?, kwh_eind = ?, kwh = ? WHERE id = ?`)
    .run(uitkomst, nu(), kwhEind, Math.round(kwh * 10000) / 10000, run.id);
}

function verwerk(db, printer, lezing) {
  const run = openRun(db, printer.id);
  const actief = lezing.status === 'bezig' || lezing.status === 'pauze';
  const einde = ['klaar', 'vrij', 'mislukt', 'geannuleerd'].includes(lezing.status);
  let runId = run?.id ?? null;

  if (actief) {
    eindTeller.set(printer.id, 0);
    if (!run) {
      // valse annulatie? zelfde bestand kort na een mislukte/geannuleerde run
      const vorige = db.prepare(`SELECT * FROM printruns WHERE printer_id = ? ORDER BY id DESC LIMIT 1`).get(printer.id);
      const recent = vorige?.geeindigd_op && (Date.now() - Date.parse(vorige.geeindigd_op)) < HERSTEL_MIN * 60000;
      if (vorige && recent && ['mislukt', 'geannuleerd'].includes(vorige.uitkomst) && (vorige.bestand || null) === (lezing.bestand || null)) {
        db.prepare(`UPDATE printruns SET uitkomst = 'bezig', geeindigd_op = NULL, kwh_eind = NULL, kwh = NULL WHERE id = ?`).run(vorige.id);
        runId = vorige.id;
      } else {
        // Gestart terwijl de wachter niet liep? Starttijd van de printer gebruiken
        // en de run als onvolledig markeren (kWh van vóór de detectie ontbreekt).
        let gestart = null;
        if (lezing.gestart_op && Date.parse(lezing.gestart_op) < Date.now() && Date.now() - Date.parse(lezing.gestart_op) < 48 * 3600e3) gestart = lezing.gestart_op;
        else if (lezing.verstreken_min > 0) gestart = new Date(Date.now() - lezing.verstreken_min * 60000).toISOString();
        const gemist = gestart && Date.now() - Date.parse(gestart) > 3 * INTERVAL_MS();
        runId = startRun(db, printer, { bestand: lezing.bestand, kwh: lezing.kwh_meter, gestart_op: gestart, onvolledig: gemist });
        if (gemist && printer.kwh_entity) aanTeVullen.add(runId);
      }
    }
    if (lezing.bestand) db.prepare('UPDATE printruns SET bestand = COALESCE(bestand, ?) WHERE id = ?').run(lezing.bestand, runId);
    if (lezing.gewicht_g != null) db.prepare('UPDATE printruns SET gewicht_g = ? WHERE id = ?').run(lezing.gewicht_g, runId);
  } else if (einde && run) {
    const n = (eindTeller.get(printer.id) || 0) + 1;
    eindTeller.set(printer.id, n);
    if (n >= EINDE_NA) {
      const uitkomst = lezing.status === 'mislukt' || lezing.status === 'geannuleerd' ? lezing.status : 'klaar';
      if (lezing.gewicht_g != null) db.prepare('UPDATE printruns SET gewicht_g = ? WHERE id = ?').run(lezing.gewicht_g, run.id);
      sluitRun(db, run, uitkomst, lezing.kwh_meter);
      eindTeller.set(printer.id, 0);
      runId = null;
    }
  }
  // wattmeting bij een lopende run (ook een manueel gestarte)
  if (runId && lezing.watt != null && lezing.watt >= 0) {
    db.prepare('INSERT INTO wattmetingen (run_id, tijdstip, watt) VALUES (?,?,?)').run(runId, nu(), lezing.watt);
  }
}

export async function tik() {
  const db = getDb();
  const printers = db.prepare(`SELECT * FROM printers WHERE actief = 1`).all()
    .filter(p => p.koppeling !== 'manueel' || p.watt_entity || p.kwh_entity);
  if (!printers.length) return;
  if (!haIngesteld()) {
    for (const p of printers) cache.set(p.id, { lezing: null, bijgewerkt_op: nu(), fout: 'Home Assistant is niet ingesteld' });
    return;
  }
  let staten;
  try { staten = await haStaten(); } catch (e) {
    for (const p of printers) cache.set(p.id, { ...(cache.get(p.id) || {}), bijgewerkt_op: nu(), fout: e.message });
    return;
  }
  for (const p of printers) {
    try {
      const lezing = leesPrinter(p, staten);
      if (p.koppeling === 'manueel') {
        // enkel meters; start/stop gebeurt met de knop
        lezing.status = openRun(db, p.id) ? 'bezig' : 'vrij';
        const run = openRun(db, p.id);
        if (run && lezing.watt != null) db.prepare('INSERT INTO wattmetingen (run_id, tijdstip, watt) VALUES (?,?,?)').run(run.id, nu(), lezing.watt);
      } else {
        db.transaction(() => verwerk(db, p, lezing))();
      }
      cache.set(p.id, { lezing, bijgewerkt_op: nu(), fout: null });
      for (const id of [...aanTeVullen]) {
        aanTeVullen.delete(id);
        try { await vulAan(db, id); } catch (e) { console.error('[printerwachter] aanvullen', e.message); }
      }
    } catch (e) {
      console.error('[printerwachter]', p.naam, e.message);
      cache.set(p.id, { ...(cache.get(p.id) || {}), bijgewerkt_op: nu(), fout: e.message });
    }
  }
}

let timer = null;
export function startWachter() {
  if (timer) return;
  const lus = () => tik().catch(e => console.error('[printerwachter]', e.message));
  lus();
  timer = setInterval(lus, INTERVAL_MS());
  console.log(`Printerwachter gestart (elke ${INTERVAL_MS() / 1000} s)`);
}
export function stopWachter() { if (timer) clearInterval(timer); timer = null; cache.clear(); eindTeller.clear(); }
