// Stap 6b: printopdrachten (wachtrij), runs koppelen, bevestigen, dossierfase
// in productie/klaar, werkbon met gemeten tijd/kWh (enkel geslaagde runs,
// optie A), kWh aanvullen uit de HA-geschiedenis, gemiste run, foutmeldingen.
process.env.HA_URL = 'http://ha.test'; process.env.HA_TOKEN = 'nep';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { vervangHa, oorzaak, haStaten } from '../integraties/homeassistant.js';
import { tik, stopWachter, kwhVanRun } from '../productie/wachter.js';

let server, basis;
let staten = {};
let geschiedenis = {};
before(async () => {
  initDb(':memory:');
  vervangHa(async (pad) => {
    if (pad === 'states') return { json: async () => Object.entries(staten).map(([entity_id, state]) => ({ entity_id, state: String(state), attributes: {} })) };
    if (pad.startsWith('history/period/')) {
      const van = decodeURIComponent(pad.slice('history/period/'.length).split('?')[0]);
      const ent = decodeURIComponent(pad.match(/filter_entity_id=([^&]+)/)[1]);
      const tot = decodeURIComponent(pad.match(/end_time=([^&]+)/)[1]);
      return { json: async () => [(geschiedenis[ent] || []).filter(x => x.last_changed >= van && x.last_changed <= tot)] };
    }
    throw new Error('onverwacht: ' + pad);
  });
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); stopWachter(); vervangHa(null); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const A1 = 'sensor.a1mini_0309_';
const zet = o => Object.assign(staten, o);
const iso = msGeleden => new Date(Date.now() - msGeleden).toISOString();
let mini, a1, pg, klant, dos, regelId;

test('P0. voorbereiding: printers koppelen, dossier met twee printregels', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  a1 = db.prepare(`SELECT id FROM printers WHERE naam <> 'Bambu Lab A1 Mini' ORDER BY id LIMIT 1`).get().id;
  let r = await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 95, koppeling: 'bambu_ha', ha_prefix: 'a1mini_0309_',
    watt_entity: 'sensor.stekker_power', kwh_entity: 'sensor.stekker_energy' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await vraag('PUT', `/printers/${a1}`, { naam: 'Tweede printer', machine_per_uur: 0.3, verbruik_watt: 120 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  pg = (await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 })).data.id;
  klant = (await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Sofie', naam: 'Maes' })).data.id;
  dos = (await vraag('POST', '/dossiers', { titel: 'Sleutelhangers', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Sleutelhanger', printer_id: mini, aantal: 4, tijd_min: 120, materialen: [{ filament_type_id: pg, gram: 40 }] },
    { type: 'printen', omschrijving: 'Doosje', printer_id: mini, aantal: 1, tijd_min: 60, materialen: [{ filament_type_id: pg, gram: 20 }] },
    { type: 'ontwerp', minuten: 30 }] })).data;
  assert.equal(dos.fase, 'nieuw');
  assert.equal(dos.productie.status, 'geen');
  assert.deepEqual(dos.stappen, ['nieuw', 'offerte', 'akkoord', 'productie', 'klaar', 'geleverd', 'afgerekend', 'betaald']);
  regelId = dos.regels[0].id;
});

test('P1. printopdracht maken: validatie, standaardwaarden uit de regel, wachtrij', async () => {
  assert.match((await vraag('POST', '/productie/opdrachten', { naam: 'x' })).data.error, /printer/);
  const ontwerp = dos.regels.find(r => r.type === 'ontwerp').id;
  assert.match((await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: ontwerp })).data.error, /printregel/);
  let r = await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: regelId });
  assert.equal(r.status, 201);
  assert.equal(r.data.naam, 'Sleutelhanger'); assert.equal(r.data.aantal, 4); assert.equal(r.data.soort, 'klant');
  assert.equal(r.data.status, 'gepland'); assert.equal(r.data.dossier_nummer, dos.nummer);
  assert.equal(r.data.materialen.length, 1);
  // losse opdracht (eigen product) en een tweede
  const los = (await vraag('POST', '/productie/opdrachten', { printer_id: mini, naam: 'Demo-vaas', soort: 'eigen', aantal: 2 })).data;
  assert.equal(los.volgorde, 2);
  assert.equal((await vraag('POST', '/productie/opdrachten', { printer_id: mini, naam: 'x', aantal: 0 })).status, 400);
  // volgorde wisselen
  await vraag('POST', `/productie/opdrachten/${los.id}/op`);
  let lijst = (await vraag('GET', `/productie/opdrachten?printer_id=${mini}&open=1`)).data.lijst;
  assert.deepEqual(lijst.map(o => o.naam), ['Demo-vaas', 'Sleutelhanger']);
  await vraag('POST', `/productie/opdrachten/${los.id}/neer`);
  lijst = (await vraag('GET', `/productie/opdrachten?printer_id=${mini}&open=1`)).data.lijst;
  assert.deepEqual(lijst.map(o => o.naam), ['Sleutelhanger', 'Demo-vaas']);
  // dossier = in productie; regel kan niet meer weg, dossier niet verwijderen
  const d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  assert.equal(d.fase, 'productie');
  assert.equal(d.acties.verwijderen, false);
  assert.equal(d.productie.regels[0].gepland, 4);
  const zonder = d.regels.filter(x => x.id !== regelId);
  assert.match((await vraag('PUT', `/dossiers/${dos.id}`, { soort: 'klant', klant_id: klant, titel: 'Sleutelhangers', regels: zonder })).data.error, /printopdrachten en kan niet weg/);
  assert.match((await vraag('DELETE', `/dossiers/${dos.id}`)).data.error, /printopdrachten/);
  // losse opdracht zonder runs mag weg
  assert.equal((await vraag('DELETE', `/productie/opdrachten/${los.id}`)).status, 200);
});

test('P2. run → te koppelen met voorstel; mislukte poging + geslaagde herprint', async () => {
  // run 1: start, mislukt
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'sleutel.3mf', 'sensor.stekker_power': 100, 'sensor.stekker_energy': 5.0 });
  await tik();
  let live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === mini);
  assert.equal(live.te_koppelen, 1);
  assert.equal(live.run.te_koppelen, true);
  assert.equal(live.run.voorstel.naam, 'Sleutelhanger');
  const run1 = live.run.id;
  const opd = live.run.voorstel.id;
  let r = await vraag('POST', `/productie/runs/${run1}/koppel`, { printopdracht_id: opd });
  assert.equal(r.status, 200); assert.equal(r.data.opdracht.naam, 'Sleutelhanger');
  assert.equal((await vraag('GET', `/productie/opdrachten/${opd}`)).data.status, 'bezig');
  assert.match((await vraag('POST', `/productie/opdrachten/${opd}/annuleer`)).data.error, /loopt nog/);
  zet({ [`${A1}printstatus`]: 'failed', 'sensor.stekker_energy': 5.02 }); await tik(); await tik();
  assert.equal((await vraag('GET', `/productie/opdrachten/${opd}`)).data.status, 'mislukt');
  assert.match((await vraag('POST', `/productie/opdrachten/${opd}/bevestig`, { aantal_goed: 4 })).data.error, /geen geslaagde run/);
  // run 2: ander bestand (geen zelfherstel), geslaagd
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'sleutel_v2.3mf', 'sensor.stekker_energy': 5.02 }); await tik();
  live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === mini);
  assert.equal(live.run.voorstel.id, opd, 'voorstel = dezelfde opdracht (herprint)');
  await vraag('POST', `/productie/runs/${live.run.id}/koppel`, { printopdracht_id: opd });
  zet({ [`${A1}printstatus`]: 'finish', 'sensor.stekker_energy': 5.12 }); await tik(); await tik();
  const o = (await vraag('GET', `/productie/opdrachten/${opd}`)).data;
  assert.equal(o.status, 'te_bevestigen');
  assert.equal(o.runs.length, 2);
  // bevestigen: 3 goed van 4 → dossier nog in productie
  r = await vraag('POST', `/productie/opdrachten/${opd}/bevestig`, { aantal_goed: 3 });
  assert.equal(r.data.status, 'voltooid');
  let d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  assert.equal(d.fase, 'productie');
  assert.equal(d.productie.regels[0].goed, 3);
  // werkbon: enkel de geslaagde run telt (optie A); mislukte = kost apart
  const regel = d.regels.find(x => x.id === regelId);
  assert.equal(regel.gemeten.geslaagd.runs, 1);
  assert.equal(regel.gemeten.geslaagd.kwh, 0.1);
  assert.equal(regel.gemeten.mislukt.runs, 1);
  assert.equal(regel.gemeten.mislukt.kwh, 0.02);
  assert.ok(regel.gemeten.mislukt.kost >= 0.007, 'kost mislukte poging = kWh × prijs + machine');
  assert.equal(regel.werkelijk.uren, null, 'zelf ingevulde waarde blijft leeg');
  d = (await vraag('POST', `/dossiers/${dos.id}/werkbon`)).data;
  assert.equal(d.werkbon.basis, 'metingen');
  const wb = d.werkbon.berekening.regels.find(x => x.id === regelId);
  assert.ok(wb._berekend.tijd_u < 0.1, 'werkelijke tijd uit de geslaagde run, niet de schatting van 2 u');
  // koppeling van een run van een bevestigde opdracht niet meer wijzigen
  assert.match((await vraag('POST', `/productie/runs/${run1}/ontkoppel`)).data.error, /Heropen/);
  assert.match((await vraag('POST', `/productie/runs/${run1}/koppel`, { intern: 'test' })).data.error, /Heropen/);
});

test('P3. herprint voor de ontbrekende stuks, run naar een opdracht van een andere printer, intern', async () => {
  // een tweede opdracht voor de ontbrekende sleutelhanger, gepland op een ANDERE printer
  const herprint = (await vraag('POST', '/productie/opdrachten', { printer_id: a1, dossier_regel_id: regelId, aantal: 1, naam: 'Sleutelhanger (herprint)' })).data;
  const doos = (await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: dos.regels[1].id })).data;
  // run op de A1 Mini, gekoppeld aan de herprint → die verhuist naar de A1 Mini
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'herprint.3mf', 'sensor.stekker_energy': 5.2 }); await tik();
  let live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === mini);
  assert.equal(live.run.voorstel.id, doos.id, 'voorstel = eerste open opdracht van deze printer');
  await vraag('POST', `/productie/runs/${live.run.id}/koppel`, { printopdracht_id: herprint.id });
  let h = (await vraag('GET', `/productie/opdrachten/${herprint.id}`)).data;
  assert.equal(h.printer_id, mini, 'verhuisd naar de printer van de run');
  assert.equal(h.status, 'bezig');
  // tweede lopende koppeling aan dezelfde opdracht mag niet
  zet({ [`${A1}printstatus`]: 'finish', 'sensor.stekker_energy': 5.25 }); await tik(); await tik();
  await vraag('POST', `/productie/opdrachten/${herprint.id}/bevestig`, { aantal_goed: 1 });
  // intern (kalibratie)
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'kalibratie.3mf' }); await tik();
  live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === mini);
  let r = await vraag('POST', `/productie/runs/${live.run.id}/koppel`, { intern: 'kalibratie' });
  assert.equal(r.data.intern_label, 'Kalibratie'); assert.equal(r.data.te_koppelen, false);
  assert.equal((await vraag('POST', `/productie/runs/${live.run.id}/koppel`, { intern: 'onzin' })).status, 400);
  zet({ [`${A1}printstatus`]: 'finish' }); await tik(); await tik();
  // doosje: nieuwe run gekoppeld via "nieuw" kan ook — hier gewoon de voorgestelde
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'doos.3mf' }); await tik();
  live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === mini);
  await vraag('POST', `/productie/runs/${live.run.id}/koppel`, { printopdracht_id: live.run.voorstel.id });
  zet({ [`${A1}printstatus`]: 'finish' }); await tik(); await tik();
  await vraag('POST', `/productie/opdrachten/${doos.id}/bevestig`, { aantal_goed: 1 });
  const d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  assert.equal(d.productie.regels[0].goed, 4);
  assert.equal(d.fase, 'klaar', 'alle printregels hebben genoeg goede stuks');
  assert.equal((await vraag('GET', '/productie/runs?te_koppelen=1')).data.length, 0);
  // heropenen → terug in productie
  await vraag('POST', `/productie/opdrachten/${doos.id}/heropen`);
  assert.equal((await vraag('GET', `/dossiers/${dos.id}`)).data.fase, 'productie');
  await vraag('POST', `/productie/opdrachten/${doos.id}/bevestig`, { aantal_goed: 1 });
  assert.equal((await vraag('GET', '/dossiers')).data.find(x => x.id === dos.id).fase, 'klaar', 'ook in de lijst');
});

test('P4. nieuwe opdracht via koppelen, ontkoppelen, dossier annuleren annuleert open opdrachten', async () => {
  const d2 = (await vraag('POST', '/dossiers', { titel: 'Vaasje', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Vaas', printer_id: mini, aantal: 1, tijd_min: 60, materialen: [{ filament_type_id: pg, gram: 20 }] }] })).data;
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'vaas.3mf' }); await tik();
  const live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === mini);
  let r = await vraag('POST', `/productie/runs/${live.run.id}/koppel`, { nieuw: { dossier_regel_id: d2.regels[0].id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.opdracht.dossier_nummer, d2.nummer);
  assert.match((await vraag('POST', `/dossiers/${d2.id}/annuleren`)).data.error, /nog aan het printen/);
  r = await vraag('POST', `/productie/runs/${live.run.id}/ontkoppel`);
  assert.equal(r.data.te_koppelen, true);
  await vraag('POST', `/productie/runs/${live.run.id}/koppel`, { intern: 'test' });
  zet({ [`${A1}printstatus`]: 'finish' }); await tik(); await tik();
  r = await vraag('POST', `/dossiers/${d2.id}/annuleren`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.productie.regels[0].opdrachten[0].status, 'geannuleerd');
  assert.equal((await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: d2.regels[0].id })).status, 400);
});

test('P5. kWh: watt-terugval zolang de meter niet verspringt', () => {
  const db = getDb();
  const id = Number(db.prepare(`INSERT INTO printruns (printer_id, gestart_op, kwh_start, bron) VALUES (?, ?, 7.0, 'automatisch')`).run(mini, iso(600e3)).lastInsertRowid);
  const ins = db.prepare('INSERT INTO wattmetingen (run_id, tijdstip, watt) VALUES (?,?,?)');
  for (let i = 0; i <= 4; i++) ins.run(id, iso(600e3 - i * 60e3), 120);
  const run = db.prepare('SELECT * FROM printruns WHERE id = ?').get(id);
  assert.equal(Math.round(kwhVanRun(db, run, 7.0) * 1000) / 1000, 0.008, 'meter nog 7,0 → 120 W × 4 min');
  assert.equal(kwhVanRun(db, run, 7.05), 0.04999999999999982, 'meter versprongen → verschil');
  db.prepare('DELETE FROM wattmetingen WHERE run_id = ?').run(id);
  db.prepare('DELETE FROM printruns WHERE id = ?').run(id);
});

test('P6. onvolledige run: kWh aangevuld uit de geschiedenis van Home Assistant', async () => {
  zet({ [`${A1}printstatus`]: 'finish' }); await tik(); await tik();
  // de printer print al 40 minuten als de wachter hem ziet
  const start = iso(40 * 60e3);
  geschiedenis['sensor.stekker_energy'] = [
    { state: '6.00', last_changed: iso(3 * 3600e3) },
    { state: '6.10', last_changed: iso(50 * 60e3) },
    { state: 'unavailable', last_changed: iso(45 * 60e3) },
    { state: '6.30', last_changed: iso(5 * 60e3) },
  ];
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'laat.3mf', [`${A1}starttijd`]: start, 'sensor.stekker_energy': 6.30 });
  await tik();
  const db = getDb();
  let run = db.prepare(`SELECT * FROM printruns WHERE bestand = 'laat.3mf'`).get();
  assert.equal(run.gestart_op, start, 'starttijd van de printer');
  assert.equal(run.onvolledig, 0, 'automatisch aangevuld in dezelfde tik');
  assert.equal(run.aangevuld, 1);
  assert.equal(run.kwh_start, 6.10, 'meterstand op het starttijdstip (unavailable genegeerd)');
  // opnieuw aanvullen met de knop kan ook (zelfde resultaat)
  const again = await vraag('POST', `/productie/runs/${run.id}/aanvullen`);
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.kwh, 0.2, 'lopende run: meter 6,30 − 6,10');
  zet({ [`${A1}printstatus`]: 'finish', 'sensor.stekker_energy': 6.35 }); await tik(); await tik();
  run = db.prepare('SELECT * FROM printruns WHERE id = ?').get(run.id);
  assert.equal(run.aangevuld, 1);
  assert.equal(Math.round(run.kwh * 100) / 100, Math.round((6.35 - run.kwh_start) * 100) / 100);
  // geen meterstand → nette melding
  const leeg = Number(db.prepare(`INSERT INTO printruns (printer_id, gestart_op, geeindigd_op, uitkomst, bron, onvolledig) VALUES (?, ?, ?, 'klaar', 'automatisch', 1)`)
    .run(mini, iso(40 * 24 * 3600e3), iso(40 * 24 * 3600e3 - 3600e3)).lastInsertRowid);
  const r = await vraag('POST', `/productie/runs/${leeg}/aanvullen`);
  assert.equal(r.status, 400); assert.match(r.data.error, /Geen meterstand/);
  await vraag('POST', `/productie/runs/${leeg}/koppel`, { intern: 'overig' });
  await vraag('POST', `/productie/runs/${run.id}/koppel`, { intern: 'test' });
});

test('P7. gemiste run met de hand toevoegen (kWh uit de geschiedenis), overlap, verwijderen', async () => {
  geschiedenis['sensor.stekker_energy'] = [
    { state: '4.00', last_changed: iso(30 * 3600e3) },
    { state: '4.25', last_changed: iso(26 * 3600e3) },
  ];
  const van = iso(28 * 3600e3), tot = iso(25 * 3600e3);
  assert.match((await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: tot, geeindigd_op: van })).data.error, /na de start/);
  let r = await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: van, geeindigd_op: tot, uitkomst: 'klaar', bestand: 'nacht.3mf' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.kwh, 0.25); assert.equal(r.data.aangevuld, true); assert.equal(r.data.te_koppelen, true);
  assert.equal(r.data.duur_min, 180);
  assert.match((await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(27 * 3600e3), geeindigd_op: iso(26.5 * 3600e3) })).data.error, /overlappen/);
  // zelf kWh invullen (printer zonder meter)
  const zelf = await vraag('POST', '/productie/runs', { printer_id: a1, gestart_op: van, geeindigd_op: tot, kwh: '0,3' });
  assert.equal(zelf.data.kwh, 0.3); assert.equal(zelf.data.aangevuld, false);
  assert.equal((await vraag('DELETE', `/productie/runs/${zelf.data.id}`)).status, 200);
  const auto = getDb().prepare(`SELECT id FROM printruns WHERE bron = 'automatisch' LIMIT 1`).get().id;
  assert.match((await vraag('DELETE', `/productie/runs/${auto}`)).data.error, /met de hand/);
  await vraag('POST', `/productie/runs/${r.data.id}/koppel`, { intern: 'test' });
});

test('P8. duidelijke foutmelding bij een verkeerd HA-adres', async () => {
  const fout = code => Object.assign(new Error('fetch failed'), { cause: { code } });
  assert.match(oorzaak(fout('ENOTFOUND')), /IP-adres/);
  assert.match(oorzaak(fout('ECONNREFUSED')), /poort/);
  assert.match(oorzaak(fout('ETIMEDOUT')), /./);
  // echte aanroep naar een poort waar niets luistert
  vervangHa(null);
  const leeg = (await import('net')).createServer().listen(0);
  await new Promise(r => leeg.once('listening', r));
  const poort = leeg.address().port; await new Promise(r => leeg.close(r));
  const oud = process.env.HA_URL; process.env.HA_URL = `http://127.0.0.1:${poort}`;
  try {
    await assert.rejects(haStaten(), e => new RegExp(`niet bereikbaar op http://127\\.0\\.0\\.1:${poort}: verbinding geweigerd.*poort`).test(e.message) || assert.fail(e.message));
  } finally { process.env.HA_URL = oud; }
});
