// ═══════════════════════════════════════════════════════════════════════
// /api/productie — live printers, runs, bediening (stap 6a),
// printopdrachten + runs koppelen (stap 6b), voorraad vanuit productie (6c)
// ═══════════════════════════════════════════════════════════════════════
// De frontend leest ENKEL deze routes; de printerwachter (productie/wachter.js)
// praat met Home Assistant. Het token komt nooit in de browser.
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { haStaten, haDienst, haCameraBeeld, haIngesteld, HaFout, meterOp } from '../integraties/homeassistant.js';
import { leesPrinter, entiteitenVan, KOPPELINGEN } from '../productie/adapters.js';
import { liveCache, openRun, kwhVanRun, kwhUitMetingen, startRun, sluitRun, tik, INTERVAL_MS, vulAan } from '../productie/wachter.js';
import { OPDRACHT_STATUS, INTERN, leesOpdrachten, leesOpdracht, maakOpdracht, wijzigOpdracht, verschuif, bevestig, heropen, annuleer, verwijder,
  voorstelVoorRun, koppelRun, ontkoppelRun, synchroniseer } from '../productie/opdrachten.js';
import { filamentVoorPrinter, rolLeeg, rolLeegOngedaan, maakEigenProduct } from '../productie/materiaal.js';

const r = Router();
function metFouten(fn) {
  return async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof DomeinFout || e instanceof HaFout) return res.status(e.status || 400).json({ error: e.message });
      console.error('[productie]', e);
      res.status(500).json({ error: e.message });
    }
  };
}
function printer(db, id) {
  const p = db.prepare('SELECT * FROM printers WHERE id = ?').get(Number(id));
  if (!p) throw Object.assign(new DomeinFout('Printer niet gevonden'), { status: 404 });
  return p;
}
const r4 = x => (x == null ? null : Math.round(x * 10000) / 10000);

// Een run is "te koppelen" zolang hij niet aan een printopdracht hangt en
// niet als intern gemarkeerd is.
const OPDRACHT_VAN_RUN = `SELECT o.id, o.naam, o.voltooid_op, d.nummer AS dossier_nummer, d.id AS dossier_id FROM printopdrachten o
  LEFT JOIN dossier_regels r ON r.id = o.dossier_regel_id LEFT JOIN dossiers d ON d.id = r.dossier_id WHERE o.id = ?`;
function runInfo(db, run, lezing) {
  if (!run) return null;
  const einde = run.geeindigd_op ? Date.parse(run.geeindigd_op) : Date.now();
  const opdracht = run.printopdracht_id ? db.prepare(OPDRACHT_VAN_RUN).get(run.printopdracht_id) : null;
  const te_koppelen = !run.printopdracht_id && !run.intern;
  return { id: run.id, gestart_op: run.gestart_op, geeindigd_op: run.geeindigd_op, uitkomst: run.uitkomst, bestand: run.bestand,
    duur_min: Math.round((einde - Date.parse(run.gestart_op)) / 60000), bron: run.bron, onvolledig: !!run.onvolledig, aangevuld: !!run.aangevuld,
    gewicht_g: run.gewicht_g, kwh: r4(run.kwh ?? kwhVanRun(db, run, lezing?.kwh_meter ?? null)),
    opdracht, intern: run.intern, intern_label: run.intern ? INTERN[run.intern] : null, te_koppelen,
    voorstel: te_koppelen ? voorstelVoorRun(db, run) : null };
}
function run(db, id) {
  const x = db.prepare('SELECT * FROM printruns WHERE id = ?').get(Number(id));
  if (!x) throw Object.assign(new DomeinFout('Run niet gevonden'), { status: 404 });
  return x;
}
function opdracht(db, id) {
  const o = leesOpdracht(db, Number(id));
  if (!o) throw Object.assign(new DomeinFout('Printopdracht niet gevonden'), { status: 404 });
  return o;
}

r.get('/live', metFouten((req, res) => {
  const db = getDb();
  const printers = db.prepare('SELECT * FROM printers WHERE actief = 1 ORDER BY naam COLLATE NOCASE').all();
  res.json({
    ha: haIngesteld(), interval_s: INTERVAL_MS() / 1000,
    printers: printers.map(p => {
      const c = liveCache().get(p.id) || {};
      const run = openRun(db, p.id);
      const laatste = db.prepare(`SELECT * FROM printruns WHERE printer_id = ? AND uitkomst <> 'bezig' ORDER BY id DESC LIMIT 1`).get(p.id);
      return { id: p.id, naam: p.naam, koppeling: p.koppeling, koppeling_label: KOPPELINGEN[p.koppeling],
        camera: !!p.camera_entity, knoppen: { pauze: !!p.pauze_entity, hervat: !!p.hervat_entity, annuleer: !!p.annuleer_entity },
        lezing: c.lezing || null, bijgewerkt_op: c.bijgewerkt_op || null, fout: c.fout || null,
        run: runInfo(db, run, c.lezing), vorige_run: runInfo(db, laatste, null),
        te_koppelen: db.prepare(`SELECT COUNT(*) n FROM printruns WHERE printer_id = ? AND printopdracht_id IS NULL AND intern IS NULL`).get(p.id).n,
        volgende: db.prepare(`SELECT id, naam FROM printopdrachten WHERE printer_id = ? AND voltooid_op IS NULL AND geannuleerd_op IS NULL ORDER BY volgorde, id LIMIT 1`).get(p.id) || null };
    }),
  });
}));

r.get('/runs', metFouten((req, res) => {
  const db = getDb();
  const waar = req.query.te_koppelen === '1' ? 'WHERE r.printopdracht_id IS NULL AND r.intern IS NULL' : '';
  const lijst = db.prepare(`SELECT r.*, p.naam AS printer FROM printruns r JOIN printers p ON p.id = r.printer_id ${waar} ORDER BY r.gestart_op DESC LIMIT 500`).all();
  res.json(lijst.map(x => ({ ...runInfo(db, x, liveCache().get(x.printer_id)?.lezing), printer_id: x.printer_id, printer: x.printer })));
}));
r.get('/runs/:id', metFouten((req, res) => {
  const db = getDb();
  const x = run(db, req.params.id);
  res.json({ ...runInfo(db, x, liveCache().get(x.printer_id)?.lezing), printer_id: x.printer_id });
}));

// Run koppelen: aan een printopdracht (voorstel, andere of nieuwe) of intern.
r.post('/runs/:id/koppel', metFouten((req, res) => {
  const db = getDb();
  const x = run(db, req.params.id);
  db.transaction(() => koppelRun(db, x, req.body || {}))();
  res.json(runInfo(db, run(db, x.id), null));
}));
r.post('/runs/:id/ontkoppel', metFouten((req, res) => {
  const db = getDb();
  const x = run(db, req.params.id);
  db.transaction(() => ontkoppelRun(db, x))();
  res.json(runInfo(db, run(db, x.id), null));
}));

// Uitkomst en/of starttijd van een run corrigeren (25-09): de printer meldt
// niet altijd juist hoe een print eindigde, en een al lopende print kan een
// verkeerde starttijd krijgen. Niet meer als de printopdracht bevestigd is.
r.put('/runs/:id', metFouten(async (req, res) => {
  const db = getDb();
  const x = run(db, req.params.id);
  const b = req.body || {};
  if (x.printopdracht_id && db.prepare('SELECT voltooid_op FROM printopdrachten WHERE id = ?').get(x.printopdracht_id)?.voltooid_op) {
    throw new DomeinFout('De printopdracht van deze run is al bevestigd. Heropen ze eerst (Productie → Printopdrachten).');
  }
  const wijz = {};
  if (b.uitkomst !== undefined && b.uitkomst !== x.uitkomst) {
    if (!['klaar', 'mislukt', 'geannuleerd'].includes(b.uitkomst)) throw new DomeinFout('Kies geslaagd, mislukt of geannuleerd');
    if (x.uitkomst === 'bezig') throw new DomeinFout('Deze print loopt nog: de uitkomst kan pas na het einde.');
    wijz.uitkomst = b.uitkomst;
  }
  if (b.gestart_op !== undefined) {
    const van = isoOf(b.gestart_op, 'het starttijdstip');
    if (van !== new Date(x.gestart_op).toISOString()) {
      const tot = x.geeindigd_op || new Date().toISOString();
      if (van >= tot) throw new DomeinFout(x.geeindigd_op ? 'De start moet vóór het einde van de run liggen' : 'De start ligt in de toekomst');
      const overlap = db.prepare(`SELECT id FROM printruns WHERE printer_id = ? AND id <> ? AND gestart_op < ? AND COALESCE(geeindigd_op, '9999') > ?`).get(x.printer_id, x.id, tot, van);
      if (overlap) throw new DomeinFout('Met deze starttijd overlapt de run met een andere run op dezelfde printer.');
      wijz.gestart_op = van;
    }
  }
  if (!Object.keys(wijz).length) return res.json(runInfo(db, x, liveCache().get(x.printer_id)?.lezing));
  db.prepare(`UPDATE printruns SET ${Object.keys(wijz).map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(wijz), x.id);
  let melding = null;
  if (wijz.gestart_op) {
    // verbruik opnieuw: meterstand op de nieuwe start uit HA, anders de wattmetingen vanaf de nieuwe start
    const p = printer(db, x.printer_id);
    let gelukt = false;
    if (p.kwh_entity && haIngesteld()) {
      try { const u = await vulAan(db, x.id); gelukt = u.ok; if (!u.ok) melding = `Verbruik niet aangevuld: ${u.reden}`; }
      catch (e) { melding = `Verbruik niet aangevuld: ${e.message}`; }
    }
    if (!gelukt && x.geeindigd_op) {
      db.prepare('UPDATE printruns SET kwh = ? WHERE id = ?').run(r4(kwhUitMetingen(db, x.id)), x.id);
    }
  }
  res.json({ ...runInfo(db, run(db, x.id), liveCache().get(x.printer_id)?.lezing), melding });
}));

// kWh van een onvolledige of gemiste run aanvullen uit de geschiedenis van de
// kWh-meter in Home Assistant.
r.post('/runs/:id/aanvullen', metFouten(async (req, res) => {
  const db = getDb();
  const x = run(db, req.params.id);
  if (!haIngesteld()) throw new DomeinFout('Home Assistant is niet ingesteld (HA_URL en HA_TOKEN, of de add-on).');
  const u = await vulAan(db, x.id);
  if (!u.ok) throw new DomeinFout(u.reden);
  res.json(runInfo(db, run(db, x.id), liveCache().get(x.printer_id)?.lezing));
}));

// Gemiste run met de hand toevoegen (bv. de backend stond uit). Met een
// kWh-meter in Home Assistant wordt het verbruik uit de geschiedenis gehaald;
// anders vul je het zelf in (of blijft het leeg).
const isoOf = (v, wat) => {
  const t = Date.parse(String(v || ''));
  if (!v || Number.isNaN(t)) throw new DomeinFout(`Vul ${wat} in`);
  return new Date(t).toISOString();
};
r.post('/runs', metFouten(async (req, res) => {
  const db = getDb();
  const p = printer(db, req.body?.printer_id);
  const van = isoOf(req.body?.gestart_op, 'het starttijdstip'), tot = isoOf(req.body?.geeindigd_op, 'het eindtijdstip');
  if (tot <= van) throw new DomeinFout('Het einde moet na de start liggen');
  if (Date.parse(tot) > Date.now() + 60e3) throw new DomeinFout('Het einde ligt in de toekomst');
  if (Date.parse(tot) - Date.parse(van) > 7 * 24 * 3600e3) throw new DomeinFout('Een run van meer dan 7 dagen? Kijk de tijdstippen na.');
  const uitkomst = ['klaar', 'mislukt', 'geannuleerd'].includes(req.body?.uitkomst) ? req.body.uitkomst : 'klaar';
  const overlap = db.prepare(`SELECT id FROM printruns WHERE printer_id = ? AND gestart_op < ? AND COALESCE(geeindigd_op, '9999') > ?`).get(p.id, tot, van);
  if (overlap) throw new DomeinFout(`Deze tijden overlappen met een andere run op ${p.naam}.`);
  let kwh = null, kwhStart = null, kwhEind = null, aangevuld = 0, melding = null;
  const zelf = req.body?.kwh;
  if (zelf !== undefined && zelf !== null && zelf !== '') {
    kwh = parseFloat(String(zelf).replace(',', '.'));
    if (!Number.isFinite(kwh) || kwh < 0) throw new DomeinFout('kWh moet een getal ≥ 0 zijn');
  } else if (p.kwh_entity && haIngesteld()) {
    try {
      kwhStart = await meterOp(p.kwh_entity, van); kwhEind = await meterOp(p.kwh_entity, tot);
      if (kwhStart != null && kwhEind != null && kwhEind >= kwhStart) { kwh = r4(kwhEind - kwhStart); aangevuld = 1; }
      else melding = 'Geen meterstanden gevonden in de geschiedenis van Home Assistant: kWh blijft leeg.';
    } catch (e) { melding = `Verbruik niet opgehaald: ${e.message}`; }
  }
  const id = Number(db.prepare(`INSERT INTO printruns (printer_id, gestart_op, geeindigd_op, uitkomst, bestand, kwh_start, kwh_eind, kwh, bron, aangevuld)
    VALUES (?,?,?,?,?,?,?,?, 'manueel', ?)`).run(p.id, van, tot, uitkomst, String(req.body?.bestand || '').trim() || null, kwhStart, kwhEind, kwh, aangevuld).lastInsertRowid);
  res.status(201).json({ ...runInfo(db, run(db, id), null), melding });
}));
// Enkel een met de hand toegevoegde run kan weg (vergissing).
r.delete('/runs/:id', metFouten((req, res) => {
  const db = getDb();
  const x = run(db, req.params.id);
  if (x.bron !== 'manueel' || x.uitkomst === 'bezig') throw new DomeinFout('Enkel een met de hand toegevoegde, afgelopen run kan verwijderd worden.');
  if (x.printopdracht_id) throw new DomeinFout('Ontkoppel de run eerst van de printopdracht.');
  db.transaction(() => { db.prepare('DELETE FROM wattmetingen WHERE run_id = ?').run(x.id); db.prepare('DELETE FROM printruns WHERE id = ?').run(x.id); })();
  res.json({ ok: true });
}));

// ── printopdrachten (wachtrij per printer) ──────────────────────────────
r.get('/opdrachten', metFouten((req, res) => {
  const db = getDb();
  const n = v => (v ? Number(v) : null);
  res.json({ statussen: OPDRACHT_STATUS, intern: INTERN,
    lijst: leesOpdrachten(db, { printer_id: n(req.query.printer_id), dossier_id: n(req.query.dossier_id), open: req.query.open === '1' }) });
}));
r.get('/opdrachten/:id', metFouten((req, res) => res.json(opdracht(getDb(), req.params.id))));
r.post('/opdrachten', metFouten((req, res) => {
  const db = getDb();
  const id = db.transaction(() => {
    const n = maakOpdracht(db, req.body || {});
    const dId = leesOpdracht(db, n).dossier_id;
    if (dId) synchroniseer(db, dId, { behoud: n });     // gestart dossier: de rest past zich aan
    if (!leesOpdracht(db, n)) throw new DomeinFout('Voor deze regel is al genoeg geprint of gepland. Verhoog eerst het aantal op de regel van het dossier.');
    return n;
  })();
  res.status(201).json(leesOpdracht(db, id));
}));
r.put('/opdrachten/:id', metFouten((req, res) => {
  const db = getDb();
  const o = opdracht(db, req.params.id);
  db.transaction(() => { wijzigOpdracht(db, o, req.body || {}); if (o.dossier_id) synchroniseer(db, o.dossier_id, { behoud: o.id }); })();
  res.json(leesOpdracht(db, o.id));
}));
r.post('/opdrachten/:id/:richting(op|neer)', metFouten((req, res) => {
  const db = getDb();
  const o = opdracht(db, req.params.id);
  db.transaction(() => verschuif(db, o, req.params.richting))();
  res.json({ ok: true });
}));
r.post('/opdrachten/:id/bevestig', metFouten((req, res) => {
  const db = getDb();
  const o = opdracht(db, req.params.id);
  db.transaction(() => { bevestig(db, o, req.body?.aantal_goed); if (o.dossier_id) synchroniseer(db, o.dossier_id); })();
  res.json(leesOpdracht(db, o.id));
}));
r.post('/opdrachten/:id/heropen', metFouten((req, res) => {
  const db = getDb();
  const o = opdracht(db, req.params.id);
  db.transaction(() => { heropen(db, o); if (o.dossier_id) synchroniseer(db, o.dossier_id); })();
  res.json(leesOpdracht(db, o.id));
}));
r.post('/opdrachten/:id/annuleer', metFouten((req, res) => {
  const db = getDb();
  const o = opdracht(db, req.params.id);
  db.transaction(() => { annuleer(db, o); if (o.dossier_id) synchroniseer(db, o.dossier_id); })();
  res.json(leesOpdracht(db, o.id));
}));
r.delete('/opdrachten/:id', metFouten((req, res) => {
  const db = getDb();
  const o = opdracht(db, req.params.id);
  db.transaction(() => verwijder(db, o))();
  res.json({ ok: true });
}));

// Bediening via de knoppen van de printer in Home Assistant.
const KNOP = { pauze: 'pauze_entity', hervat: 'hervat_entity', annuleer: 'annuleer_entity' };
r.post('/printers/:id/:actie(pauze|hervat|annuleer)', metFouten(async (req, res) => {
  const db = getDb();
  const p = printer(db, req.params.id);
  const entity = p[KNOP[req.params.actie]];
  if (!entity) throw new DomeinFout(`Geen ${req.params.actie}knop ingesteld voor ${p.naam} (Instellingen → Printers).`);
  await haDienst(entity.split('.')[0], 'press', { entity_id: entity });
  res.json({ ok: true });
}));

// Manuele printer: een run starten en stoppen met de knop.
r.post('/printers/:id/start', metFouten(async (req, res) => {
  const db = getDb();
  const p = printer(db, req.params.id);
  if (p.koppeling !== 'manueel') throw new DomeinFout('Deze printer wordt automatisch gevolgd via Home Assistant.');
  if (openRun(db, p.id)) throw new DomeinFout('Er loopt al een print op deze printer.');
  let kwh = null;
  if (p.kwh_entity && haIngesteld()) { try { kwh = parseFloat((await haStaten()).get(p.kwh_entity)?.state); if (!Number.isFinite(kwh)) kwh = null; } catch { kwh = null; } }
  startRun(db, p, { bestand: String(req.body?.bestand || '').trim() || null, kwh, bron: 'manueel' });
  res.status(201).json({ ok: true });
}));
r.post('/printers/:id/stop', metFouten(async (req, res) => {
  const db = getDb();
  const p = printer(db, req.params.id);
  const run = openRun(db, p.id);
  if (!run || run.bron !== 'manueel') throw new DomeinFout('Er loopt geen manueel gestarte print op deze printer.');
  const uitkomst = ['klaar', 'mislukt', 'geannuleerd'].includes(req.body?.uitkomst) ? req.body.uitkomst : 'klaar';
  let kwh = null;
  if (p.kwh_entity && haIngesteld()) { try { kwh = parseFloat((await haStaten()).get(p.kwh_entity)?.state); if (!Number.isFinite(kwh)) kwh = null; } catch { kwh = null; } }
  sluitRun(db, run, uitkomst, kwh);
  res.json({ ok: true });
}));

// Camerabeeld (momentopname) via de backend: het HA-token blijft verborgen.
r.get('/printers/:id/camera', metFouten(async (req, res) => {
  const p = printer(getDb(), req.params.id);
  if (!p.camera_entity) throw new DomeinFout('Geen camera ingesteld');
  const b = await haCameraBeeld(p.camera_entity);
  res.set({ 'Content-Type': b.type, 'Cache-Control': 'no-store' }).send(b.data);
}));

// Koppeling testen (Instellingen → Printers): welke entiteiten bestaan en
// wat de printer nu meldt. Werkt ook op niet-opgeslagen invoer (body).
r.post('/koppeling-testen', metFouten(async (req, res) => {
  if (!haIngesteld()) throw new DomeinFout('Home Assistant is niet ingesteld (HA_URL en HA_TOKEN, of de add-on).');
  const p = { koppeling: req.body?.koppeling || 'manueel', ha_prefix: req.body?.ha_prefix, watt_entity: req.body?.watt_entity, kwh_entity: req.body?.kwh_entity };
  const staten = await haStaten();
  const e = entiteitenVan(p);
  const extra = ['camera_entity', 'pauze_entity', 'hervat_entity', 'annuleer_entity'].map(k => req.body?.[k]).filter(Boolean);
  const lezing = leesPrinter(p, staten);
  res.json({
    gevonden: [...Object.values(e), ...extra].filter(id => staten.has(id)),
    ontbrekend: [...Object.values(e), ...extra].filter(id => !staten.has(id)),
    lezing: { status: lezing.status, ruwe_status: lezing.ruwe_status, watt: lezing.watt, kwh_meter: lezing.kwh_meter, bestand: lezing.bestand },
    // hulp bij het invullen: entiteiten die met het opgegeven begin starten
    suggesties: req.body?.ha_prefix ? [...staten.keys()].filter(k => k.startsWith(String(req.body.ha_prefix).includes('.') ? req.body.ha_prefix : `sensor.${req.body.ha_prefix}`)).slice(0, 60) : [],
  });
}));

// Meteen opnieuw uitlezen (knop "Vernieuwen"), zonder op de volgende tik te wachten.
r.post('/vernieuwen', metFouten(async (req, res) => { await tik(); res.json({ ok: true }); }));

// ── voorraad vanuit productie (stap 6c) ─────────────────────────────────
r.get('/printers/:id/filament', metFouten((req, res) => {
  const db = getDb();
  res.json(filamentVoorPrinter(db, printer(db, req.params.id).id));
}));
r.post('/printers/:id/rol-leeg', metFouten((req, res) => {
  const db = getDb();
  const p = printer(db, req.params.id);
  const uit = db.transaction(() => rolLeeg(db, p, req.body?.artikel_id))();
  res.json({ ...uit, recent: filamentVoorPrinter(db, p.id).recent });
}));
r.post('/rol-leeg/:mutatie/ongedaan', metFouten((req, res) => {
  const db = getDb();
  db.transaction(() => rolLeegOngedaan(db, req.params.mutatie))();
  res.json({ ok: true });
}));
// Te bestellen → Printopdracht maken (dossier "Eigen product" + opdracht)
r.post('/eigen-product', metFouten((req, res) => {
  const db = getDb();
  res.status(201).json(db.transaction(() => maakEigenProduct(db, req.body || {}))());
}));
// Productiekost van een eigen product (artikelformulier): per voltooide
// printopdracht de echte kost per stuk en de arbeid apart.
r.get('/productiekost/:artikel', metFouten((req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT id, naam, verkoopprijs, productieprijs FROM artikelen WHERE id = ?').get(Number(req.params.artikel));
  if (!a) throw Object.assign(new DomeinFout('Artikel niet gevonden'), { status: 404 });
  const lijst = db.prepare(`SELECT o.id, o.naam, o.aantal_goed, o.voltooid_op, o.productiekost_stuk, o.arbeid_stuk, o.kost_onvolledig, d.id AS dossier_id, d.nummer AS dossier_nummer
    FROM printopdrachten o JOIN dossier_regels r ON r.id = o.dossier_regel_id JOIN dossiers d ON d.id = r.dossier_id
    WHERE r.artikel_id = ? AND d.soort = 'eigen' AND o.voltooid_op IS NOT NULL AND o.aantal_goed > 0 AND o.productiekost_stuk IS NOT NULL
    ORDER BY o.voltooid_op DESC, o.id DESC`).all(a.id);
  const stuks = lijst.reduce((t, o) => t + o.aantal_goed, 0);
  const gem = k => (stuks ? Math.round(lijst.reduce((t, o) => t + (o[k] ?? 0) * o.aantal_goed, 0) / stuks * 10000) / 10000 : null);
  res.json({ verkoopprijs: a.verkoopprijs, productieprijs: a.productieprijs, laatste: lijst[0] || null,
    gemiddeld: stuks ? { per_stuk: gem('productiekost_stuk'), arbeid_stuk: gem('arbeid_stuk'), stuks, opdrachten: lijst.length } : null,
    historiek: lijst.slice(0, 10) });
}));

export default r;
