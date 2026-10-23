// 23-10: samen op één plaat — meerdere producten (printopdrachten) delen één
// run; per product bevestigen; wat mislukte samen opnieuw plannen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); stopWachter(); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };

test('G1. drie producten op één plaat: één run voor allemaal, kost naar gewicht, per product bevestigen, mislukte samen herprinten', async () => {
  const db = getDb();
  const mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  ok(await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.3, verbruik_watt: 95 }));
  const pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  const zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: db.prepare(`SELECT id FROM filament_kleuren WHERE naam = 'Zwart'`).get().id }), 201).id;
  const a = [], namen = ['Kat', 'Hond', 'Uil'], gram = [10, 20, 30];
  for (const n of namen) a.push(ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: n, zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 5 }), 201).id);
  const d = ok(await vraag('POST', '/dossiers', { soort: 'eigen', titel: 'Plaat met figuren', regels: a.map((id, i) => (
    { type: 'printen', omschrijving: namen[i], printer_id: mini, aantal: 1, tijd_min: 60, artikel_id: id, materialen: [{ artikel_id: zwart, gram: gram[i] }] })) }), 201);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  const ops = s.productie.regels.map(r => r.opdrachten[0]);
  assert.equal(ops.length, 3);
  const { groep } = ok(await vraag('POST', '/productie/plaat', { opdracht_ids: ops.map(o => o.id) }), 201);
  assert.equal(groep, Math.min(...ops.map(o => o.id)));
  // één run, gekoppeld aan het tweede lid → hangt aan de trekker en geldt voor alle drie
  const run = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: new Date(Date.now() - 3 * 3600e3).toISOString(), geeindigd_op: new Date(Date.now() - 3600e3).toISOString(), uitkomst: 'klaar', kwh: 0.3 }), 201);
  ok(await vraag('POST', `/productie/runs/${run.id}/koppel`, { printopdracht_id: ops[1].id }));
  assert.equal(db.prepare('SELECT printopdracht_id p FROM printruns WHERE id = ?').get(run.id).p, groep);
  for (const o of ops) assert.equal(ok(await vraag('GET', `/productie/opdrachten/${o.id}`)).status, 'te_bevestigen', o.naam);
  const l = ok(await vraag('GET', `/productie/opdrachten/${ops[2].id}`));
  assert.equal(l.plaat.leden.length, 3); assert.ok(Math.abs(l.plaat.aandeel - 0.5) < 1e-3, 'uil = 30 van 60 g');
  // losmaken kan niet meer na het printen
  assert.equal((await vraag('POST', `/productie/opdrachten/${ops[0].id}/los`)).status, 400);
  // kat goed, hond en uil mislukt → samen opnieuw op één plaat
  const b = ok(await vraag('POST', `/productie/plaat/${groep}/bevestig`, { aantallen: { [ops[0].id]: 1, [ops[1].id]: 0, [ops[2].id]: 0 }, herprint_samen: true }));
  assert.equal(b.tekort, 2); assert.ok(b.herprint_groep, 'nieuwe plaat voor hond en uil');
  const na = db.prepare('SELECT id, dossier_regel_id, plaat_groep, voltooid_op, kost_detail FROM printopdrachten ORDER BY id').all();
  const nieuw = na.filter(o => !o.voltooid_op);
  assert.equal(nieuw.length, 2); assert.ok(nieuw.every(o => o.plaat_groep === b.herprint_groep));
  // stroom en machine verdeeld naar gewicht: samen = de hele run
  const det = na.filter(o => o.voltooid_op).map(o => JSON.parse(o.kost_detail));
  const machine = det.reduce((t, x) => t + x.machine, 0), kwh = det.reduce((t, x) => t + x.kwh, 0);
  assert.ok(Math.abs(machine - 2 * 0.3) < 0.01, `machine ${machine}`); assert.ok(Math.abs(kwh - 0.3) < 1e-3);
  assert.ok(Math.abs(det[2].kwh - 0.15) < 1e-3, 'uil draagt de helft');
  // kat in voorraad, de andere niet
  const voorraad = id => db.prepare('SELECT COALESCE(SUM(aantal_resterend), 0) n FROM voorraad_partijen WHERE artikel_id = ?').get(id).n;
  assert.deepEqual(a.map(voorraad), [1, 0, 0]);
});

test('G2. samenvoegen en weer losmaken (zonder runs); een groep van één verdwijnt', async () => {
  const db = getDb();
  const open = db.prepare('SELECT id, plaat_groep FROM printopdrachten WHERE voltooid_op IS NULL').all();
  assert.equal(open.length, 2);
  ok(await vraag('POST', `/productie/opdrachten/${open[1].id}/los`));
  assert.ok(db.prepare('SELECT plaat_groep FROM printopdrachten WHERE id IN (?, ?)').all(open[0].id, open[1].id).every(x => x.plaat_groep === null), 'groep van één opgeheven');
  assert.equal((await vraag('POST', '/productie/plaat', { opdracht_ids: [open[0].id] })).status, 400);
});
