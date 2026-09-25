// Stap 6a: printerkoppeling, printerwachter (runs, debounce, zelfherstel,
// kWh), live, bediening. Home Assistant wordt nagebootst.
process.env.HA_URL = 'http://ha.test'; process.env.HA_TOKEN = 'nep';
process.env.PRINTERWACHTER_EINDE_S = '0';   // tests: einde na 2 metingen, zonder wachttijd
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { vervangHa } from '../integraties/homeassistant.js';
import { tik, stopWachter, kwhUitMetingen } from '../productie/wachter.js';
import { leesPrinter } from '../productie/adapters.js';

let server, basis;
let staten = {};
const diensten = [];
before(async () => {
  initDb(':memory:');
  vervangHa(async (pad, opties) => {
    if (pad === 'states') return { json: async () => Object.entries(staten).map(([entity_id, state]) => ({ entity_id, state: String(state), attributes: {} })) };
    if (pad.startsWith('services/')) { diensten.push({ pad, body: JSON.parse(opties.body) }); return {}; }
    if (pad.startsWith('camera_proxy/')) return { headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer };
    throw new Error('onverwacht: ' + pad);
  });
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); stopWachter(); vervangHa(null); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  if ((res.headers.get('content-type') || '').startsWith('image/')) return { status: res.status, beeld: Buffer.from(await res.arrayBuffer()) };
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const runs = () => getDb().prepare('SELECT * FROM printruns ORDER BY id').all();
const A1 = 'sensor.a1mini_0309_';
const zet = (o) => Object.assign(staten, o);

test('H1. printer koppelen: validatie en opslaan', async () => {
  let r = await vraag('PUT', '/printers/1', { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95, koppeling: 'bambu_ha' });
  assert.match(r.data.error, /begin van de entiteitsnamen/);
  r = await vraag('PUT', '/printers/1', { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95, koppeling: 'bambu_ha', ha_prefix: 'a1mini_0309_', pauze_entity: 'a1mini_pauze' });
  assert.match(r.data.error, /volledige entiteit/);
  r = await vraag('PUT', '/printers/1', { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95, koppeling: 'bambu_ha', ha_prefix: 'a1mini_0309_',
    watt_entity: 'stekker_a1mini_power', kwh_entity: 'sensor.stekker_a1mini_energy', pauze_entity: 'button.a1mini_pauze', annuleer_entity: 'button.a1mini_stop', camera_entity: 'camera.a1mini' });
  assert.equal(r.status, 200);
  const p = getDb().prepare('SELECT * FROM printers WHERE id = 1').get();
  assert.equal(p.ha_prefix, A1, 'domein aangevuld');
  assert.equal(p.watt_entity, 'sensor.stekker_a1mini_power');
  assert.equal((await vraag('PUT', '/printers/2', { naam: 'Bambu Lab A1', koppeling: 'fout' })).status, 400);
});

test('H2. koppeling testen: gevonden, ontbrekend, suggesties', async () => {
  zet({ [`${A1}printstatus`]: 'idle', [`${A1}printvoortgang`]: 0, 'sensor.stekker_a1mini_power': 3, 'sensor.stekker_a1mini_energy': 10, [`${A1}nozzle_temperatuur`]: 25 });
  const r = await vraag('POST', '/productie/koppeling-testen', { koppeling: 'bambu_ha', ha_prefix: 'a1mini_0309_', watt_entity: 'sensor.stekker_a1mini_power', kwh_entity: 'sensor.stekker_a1mini_energy', pauze_entity: 'button.a1mini_pauze' });
  assert.ok(r.data.gevonden.includes(`${A1}printstatus`));
  assert.ok(r.data.ontbrekend.includes('button.a1mini_pauze'));
  assert.equal(r.data.lezing.status, 'vrij');
  assert.ok(r.data.suggesties.includes(`${A1}nozzle_temperatuur`));
});

test('H3. wachter: start → run, pauze, debounce bij einde, kWh uit de meter', async () => {
  await tik();
  assert.equal(runs().length, 0, 'idle = geen run');
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'hond.3mf', 'sensor.stekker_a1mini_power': 110, 'sensor.stekker_a1mini_energy': 10.0, [`${A1}gewicht_van_print`]: 12.5 });
  await tik();
  let r = runs();
  assert.equal(r.length, 1); assert.equal(r[0].uitkomst, 'bezig'); assert.equal(r[0].bestand, 'hond.3mf'); assert.equal(r[0].kwh_start, 10);
  zet({ [`${A1}printstatus`]: 'pause' }); await tik();
  zet({ [`${A1}printstatus`]: 'failed' }); await tik();
  assert.equal(runs()[0].uitkomst, 'bezig', 'één keer "failed" = nog geen einde (debounce)');
  zet({ [`${A1}printstatus`]: 'running' }); await tik();
  zet({ [`${A1}printstatus`]: 'finish', 'sensor.stekker_a1mini_energy': 10.08 }); await tik();
  assert.equal(runs()[0].uitkomst, 'bezig');
  await tik();
  r = runs()[0];
  assert.equal(r.uitkomst, 'klaar');
  assert.equal(r.kwh, 0.08, 'kWh = verschil van de meter');
  assert.equal(r.gewicht_g, 12.5);
  assert.ok(getDb().prepare('SELECT COUNT(*) n FROM wattmetingen WHERE run_id = ?').get(r.id).n >= 4);
  await tik();
  assert.equal(runs().length, 1, 'na afloop geen nieuwe run');
});

test('H4. valse annulatie herstelt zichzelf; echte annulatie niet', async () => {
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'kat.3mf' }); await tik();
  const id = runs().at(-1).id;
  zet({ [`${A1}printstatus`]: 'cancelled' }); await tik(); await tik();
  assert.equal(runs().at(-1).uitkomst, 'geannuleerd');
  zet({ [`${A1}printstatus`]: 'running' }); await tik();
  assert.equal(runs().length, 2, 'geen nieuwe run');
  assert.equal(runs().at(-1).id, id); assert.equal(runs().at(-1).uitkomst, 'bezig', 'zelfde run loopt verder');
  zet({ [`${A1}printstatus`]: 'cancelled' }); await tik(); await tik();
  zet({ [`${A1}printstatus`]: 'running', [`${A1}taaknaam`]: 'ander.3mf' }); await tik();
  assert.equal(runs().length, 3, 'ander bestand = nieuwe run');
  zet({ [`${A1}printstatus`]: 'idle' }); await tik(); await tik();
  assert.equal(runs().at(-1).uitkomst, 'klaar');
});

test('H5. Kobra (Anycubic S1 MQTT Bridge): printer_state is leidend', () => {
  const p = { koppeling: 'anycubic_ha', ha_prefix: 'sensor.kobra_' };
  const s = o => new Map(Object.entries(o).map(([k, v]) => [`sensor.kobra_${k}`, { state: v }]));
  assert.equal(leesPrinter(p, s({ printer_state: 'busy', print_state: 'done' })).status, 'bezig', 'wisselvallige print_state negeren');
  assert.equal(leesPrinter(p, s({ printer_state: 'free', print_state: 'finished' })).status, 'klaar');
  assert.equal(leesPrinter(p, s({ printer_state: 'free', print_state: 'failed' })).status, 'mislukt');
  // 25-09 (live vastgesteld): Stopping/Stoped = gestopt; Done is geen einde; oude Stoped bij busy negeren
  assert.equal(leesPrinter(p, s({ printer_state: 'free', print_state: 'stoped' })).status, 'geannuleerd');
  assert.equal(leesPrinter(p, s({ printer_state: 'busy', print_state: 'stopping' })).status, 'geannuleerd');
  assert.equal(leesPrinter(p, s({ printer_state: 'free', print_state: 'done' })).status, 'vrij');
  assert.equal(leesPrinter(p, s({ printer_state: 'busy', print_state: 'stoped' })).status, 'bezig');
  assert.equal(leesPrinter(p, s({ printer_state: 'busy', print_state: 'finished' })).status, 'bezig');
  assert.equal(leesPrinter(p, s({ printer_state: 'busy', print_state: 'preheating' })).status, 'bezig');
  const l = leesPrinter(p, s({ printer_state: 'busy', print_layer: '120 / 300', print_time_elapsed: '45' }));
  assert.equal(l.laag, 120); assert.equal(l.lagen, 300); assert.equal(l.verstreken_min, 45);
});

test('H5b. Bambu: resterende tijd in uren (standaard), of volgens de eenheid van HA', () => {
  const p = { koppeling: 'bambu_ha', ha_prefix: 'sensor.a1_' };
  const m = (state, unit) => new Map([['sensor.a1_printstatus', { state: 'running' }], ['sensor.a1_resterende_tijd', { state, attributes: unit ? { unit_of_measurement: unit } : {} }]]);
  assert.equal(leesPrinter(p, m('2', null)).resterend_min, 120, '2 u zonder eenheid = uren');
  assert.equal(leesPrinter(p, m('1.5', 'h')).resterend_min, 90);
  assert.equal(leesPrinter(p, m('45', 'min')).resterend_min, 45);
});

test('H6. kWh via trapeziumregel als er geen kWh-meter is (gaten > 120 s tellen niet)', () => {
  const db = getDb();
  const id = db.prepare(`INSERT INTO printruns (printer_id, gestart_op, uitkomst, geeindigd_op) VALUES (1, '2026-09-25T10:00:00Z', 'klaar', '2026-09-25T11:00:00Z')`).run().lastInsertRowid;
  const ins = db.prepare('INSERT INTO wattmetingen (run_id, tijdstip, watt) VALUES (?,?,?)');
  ins.run(id, '2026-09-25T10:00:00.000Z', 100); ins.run(id, '2026-09-25T10:00:30.000Z', 100); ins.run(id, '2026-09-25T10:30:30.000Z', 100);
  // 30 s + (gat van 30 min → 120 s) aan 100 W = 150 s × 100 W = 15 000 J
  assert.equal(Math.round(kwhUitMetingen(db, id) * 1e6) / 1e6, Math.round(15000 / 3.6e6 * 1e6) / 1e6);
  db.prepare('DELETE FROM printruns WHERE id = ?').run(id);
});

test('H7. live, bediening, camera, manuele printer', async () => {
  let r = await vraag('GET', '/productie/live');
  const a1 = r.data.printers.find(p => p.id === 1);
  assert.equal(a1.lezing.status, 'vrij');
  assert.equal(a1.vorige_run.uitkomst, 'klaar');
  assert.deepEqual(a1.knoppen, { pauze: true, hervat: false, annuleer: true });
  r = await vraag('POST', '/productie/printers/1/pauze');
  assert.equal(r.status, 200);
  assert.deepEqual(diensten.at(-1), { pad: 'services/button/press', body: { entity_id: 'button.a1mini_pauze' } });
  assert.match((await vraag('POST', '/productie/printers/1/hervat')).data.error, /Geen hervatknop/);
  r = await vraag('GET', '/productie/printers/1/camera');
  assert.equal(r.beeld[0], 255);
  // manuele printer (Bambu Lab A1 blijft manueel in deze test)
  assert.equal((await vraag('POST', '/productie/printers/2/start', { bestand: 'test.gcode' })).status, 201);
  assert.match((await vraag('POST', '/productie/printers/2/start')).data.error, /loopt al/);
  assert.equal((await vraag('POST', '/productie/printers/2/stop', { uitkomst: 'mislukt' })).status, 200);
  assert.equal(runs().at(-1).uitkomst, 'mislukt'); assert.equal(runs().at(-1).bron, 'manueel');
  assert.match((await vraag('POST', '/productie/printers/1/start')).data.error, /automatisch gevolgd/);
  r = await vraag('GET', '/productie/runs');
  assert.ok(r.data.length >= 4 && r.data[0].printer);
});

test('H8. Home Assistant weg: melding bij ontbrekende gegevens, geen crash', async () => {
  const oud = [process.env.HA_URL, process.env.HA_TOKEN];
  delete process.env.HA_URL; delete process.env.HA_TOKEN;
  await tik();
  const c = (await vraag('GET', '/controles')).data;
  assert.ok(c.some(x => /Home Assistant niet ingesteld: Bambu Lab A1 Mini/.test(x.tekst)));
  const l = (await vraag('GET', '/productie/live')).data;
  assert.equal(l.ha, false);
  assert.match(l.printers.find(p => p.id === 1).fout, /niet ingesteld/);
  [process.env.HA_URL, process.env.HA_TOKEN] = oud;
});
