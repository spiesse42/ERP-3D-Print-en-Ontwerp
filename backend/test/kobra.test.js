// Kobra S1 (Anycubic MQTT Bridge), live vastgesteld 25-09-2026:
// - Finished = klaar; Stopping → Done → Stoped = gestopt; Done komt ook
//   tussendoor (multicolor) en is geen einde
// - een einde telt pas na een wachttijd (hier 0,2 s i.p.v. 120 s)
// - starttijd van een run nooit vóór "laatst vrij" of het einde van de
//   vorige run (de Kobra gaf nog de verstreken tijd van de vorige print)
// - uitkomst en starttijd van een run corrigeren
process.env.HA_URL = 'http://ha.test'; process.env.HA_TOKEN = 'nep';
process.env.PRINTERWACHTER_EINDE_S = '0.2';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { vervangHa } from '../integraties/homeassistant.js';
import { tik, stopWachter } from '../productie/wachter.js';

let server, basis;
const staten = {};
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
const K = 'sensor.kobra_';
const zet = (hoofd, print, extra = {}) => Object.assign(staten, { [`${K}printer_state`]: hoofd, [`${K}print_state`]: print, ...extra });
const wacht = ms => new Promise(r => setTimeout(r, ms));
const iso = msGeleden => new Date(Date.now() - msGeleden).toISOString();
let kobra;
const runs = () => getDb().prepare('SELECT * FROM printruns WHERE printer_id = ? ORDER BY id').all(kobra);

test('K0. Kobra koppelen', async () => {
  kobra = getDb().prepare(`SELECT id FROM printers WHERE naam LIKE '%Kobra%'`).get().id;
  const r = await vraag('PUT', `/printers/${kobra}`, { naam: 'AnyCubic Kobra S1', machine_per_uur: 0.3, verbruik_watt: 150, koppeling: 'anycubic_ha', ha_prefix: 'kobra_', kwh_entity: 'sensor.kobra_kwh' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  zet('free', 'finished', { [`${K}kwh`]: 10 });
  await tik(); await tik();
  assert.equal(runs().length, 0);
});

test('K1. start: oude verstreken tijd telt niet (starttijd ≥ laatst vrij), geen "onvolledig"', async () => {
  zet('busy', 'preheating', { [`${K}print_time_elapsed`]: '110', [`${K}print_filename`]: 'plate-1.gcode.3mf', [`${K}kwh`]: 10 });
  await tik();
  const [r] = runs();
  assert.equal(r.uitkomst, 'bezig');
  assert.ok(Date.now() - Date.parse(r.gestart_op) < 60e3, `start ${r.gestart_op} is niet 110 min terug`);
  assert.equal(r.onvolledig, 0);
});

test('K2. multicolor: Done tussendoor en een kort "free" breken de run niet', async () => {
  zet('busy', 'done'); await tik();
  zet('busy', 'printing'); await tik();
  zet('free', 'done'); await tik(); await tik();          // 2 metingen, maar nog geen 0,2 s
  zet('busy', 'printing'); await tik();
  assert.equal(runs().length, 1);
  assert.equal(runs()[0].uitkomst, 'bezig');
});

test('K3. zelf gestopt: Stopping → Done → Stoped = geannuleerd', async () => {
  zet('busy', 'stopping', { [`${K}kwh`]: 10.1 }); await tik();
  zet('free', 'done'); await tik();
  await wacht(250);
  zet('free', 'stoped'); await tik();
  const [r] = runs();
  assert.equal(r.uitkomst, 'geannuleerd');
  assert.ok(r.geeindigd_op);
});

test('K4. nieuwe print met oude verstreken tijd: start ≥ einde vorige run; geen overlap', async () => {
  zet('busy', 'stoped', { [`${K}print_time_elapsed`]: '110', [`${K}print_filename`]: 'plate-2.gcode.3mf' });   // oude Stoped bij busy = bezig
  await tik();
  const [a, b] = runs();
  assert.equal(b.uitkomst, 'bezig');
  assert.ok(b.gestart_op >= a.geeindigd_op, `${b.gestart_op} ≥ ${a.geeindigd_op}`);
  zet('busy', 'printing', { [`${K}kwh`]: 10.2 }); await tik();
  zet('free', 'finished', { [`${K}kwh`]: 10.3 }); await tik();
  await wacht(250); await tik();
  assert.equal(runs()[1].uitkomst, 'klaar');
});

test('K5. valse annulatie herstelt enkel binnen 5 min; een herprint later krijgt een eigen run', async () => {
  const db = getDb();
  const b = runs()[1];
  db.prepare('UPDATE printruns SET uitkomst = ?, geeindigd_op = ? WHERE id = ?').run('mislukt', iso(10 * 60e3), b.id);
  zet('busy', 'printing', { [`${K}print_filename`]: 'plate-2.gcode.3mf' }); await tik();
  assert.equal(runs().length, 3, 'herprint na 10 min = nieuwe run');
  zet('free', 'finished'); await tik(); await wacht(250); await tik();
});

test('K6. uitkomst en starttijd corrigeren; verbruik opnieuw uit HA; niet na bevestigen', async () => {
  const [a] = runs();
  // uitkomst
  let r = await vraag('PUT', `/productie/runs/${a.id}`, { uitkomst: 'mislukt' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.uitkomst, 'mislukt');
  assert.match((await vraag('PUT', `/productie/runs/${a.id}`, { uitkomst: 'onzin' })).data.error, /geslaagd, mislukt of geannuleerd/);
  // starttijd: overlap met een andere run geweigerd, na het einde geweigerd
  const b = runs()[2];
  assert.match((await vraag('PUT', `/productie/runs/${b.id}`, { gestart_op: new Date(Date.parse(a.geeindigd_op) - 50).toISOString() })).data.error, /overlapt/);
  assert.match((await vraag('PUT', `/productie/runs/${a.id}`, { gestart_op: new Date(Date.parse(a.geeindigd_op) + 1000).toISOString() })).data.error, /vóór het einde/);
  // starttijd vroeger zetten → meterstand op de nieuwe start uit de HA-geschiedenis
  const nieuw = new Date(Date.parse(a.gestart_op) - 20 * 60e3).toISOString();
  geschiedenis['sensor.kobra_kwh'] = [{ state: '9.90', last_changed: new Date(Date.parse(nieuw) - 60e3).toISOString() }];
  r = await vraag('PUT', `/productie/runs/${a.id}`, { gestart_op: nieuw });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.gestart_op, nieuw);
  assert.equal(r.data.aangevuld, true);
  assert.equal(Math.round(r.data.kwh * 1000) / 1000, Math.round((10.1 - 9.9) * 1000) / 1000, 'eindstand 10,1 − 9,9');
  // lopende run: uitkomst nog niet
  zet('busy', 'printing', { [`${K}print_filename`]: 'plate-3.gcode.3mf' }); await tik();
  const c = runs().at(-1);
  assert.match((await vraag('PUT', `/productie/runs/${c.id}`, { uitkomst: 'klaar' })).data.error, /loopt nog/);
  zet('free', 'finished'); await tik(); await wacht(250); await tik();
  // na bevestigen van de opdracht: geweigerd
  const o = (await vraag('POST', '/productie/opdrachten', { printer_id: kobra, naam: 'Test', soort: 'intern' })).data;
  await vraag('POST', `/productie/runs/${c.id}/koppel`, { printopdracht_id: o.id });
  assert.equal((await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 1 })).status, 200);
  assert.match((await vraag('PUT', `/productie/runs/${c.id}`, { uitkomst: 'mislukt' })).data.error, /al bevestigd/);
});

test('K7. opdracht op "te bevestigen": geen voorstel en geen "volgende"; na een mislukte poging wel', async () => {
  const db = getDb();
  const o = (await vraag('POST', '/productie/opdrachten', { printer_id: kobra, naam: 'Draakje', soort: 'eigen' })).data;
  let live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === kobra);
  assert.equal(live.volgende?.id, o.id);
  zet('busy', 'printing', { [`${K}print_filename`]: 'draak.gcode.3mf' }); await tik();
  let run = runs().at(-1);
  await vraag('POST', `/productie/runs/${run.id}/koppel`, { printopdracht_id: o.id });
  zet('free', 'finished'); await tik(); await wacht(250); await tik();
  assert.equal((await vraag('GET', `/productie/opdrachten/${o.id}`)).data.status, 'te_bevestigen');
  live = (await vraag('GET', '/productie/live')).data.printers.find(p => p.id === kobra);
  assert.equal(live.volgende, null, 'te bevestigen = niet de volgende');
  zet('busy', 'printing', { [`${K}print_filename`]: 'iets-anders.gcode.3mf' }); await tik();
  run = runs().at(-1);
  assert.equal((await vraag('GET', `/productie/runs/${run.id}`)).data.voorstel, null);
  // laatste poging mislukt → wel weer voorgesteld (herprint)
  db.prepare(`UPDATE printruns SET uitkomst = 'mislukt' WHERE printopdracht_id = ?`).run(o.id);
  assert.equal((await vraag('GET', `/productie/runs/${run.id}`)).data.voorstel?.id, o.id);
  zet('free', 'finished'); await tik(); await wacht(250); await tik();
});
