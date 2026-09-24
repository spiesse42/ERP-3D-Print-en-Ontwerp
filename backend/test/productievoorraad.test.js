// Stap 6c: rol leegmelden (FIFO, ongedaan), eindproducten naar voorraad bij
// bevestigen met productiekost (echte kost + arbeid apart), heropenen,
// Te bestellen → printopdracht (dossier "Eigen product").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';
import { boekUit } from '../domein/voorraad.js';

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
const iso = u => new Date(Date.now() - u * 3600e3).toISOString();
const voorraad = id => getDb().prepare('SELECT COALESCE(SUM(aantal_resterend),0) v FROM voorraad_partijen WHERE artikel_id = ?').get(id).v;
let mini, zwart, wit, hond, kat, dos, regel, opd, klant;

test('V0. voorbereiding: printer, filament met twee partijen, eindproduct', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  ok(await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 95 }));
  const pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  const kl = n => db.prepare('SELECT id FROM filament_kleuren WHERE naam = ?').get(n).id;
  zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: kl('Zwart') }), 201).id;
  wit = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: kl('Wit') }), 201).id;
  ok(await vraag('POST', `/voorraad/artikelen/${zwart}/boeking`, { richting: 'in', aantal: 1, prijs_per_eenheid: 20, datum: '2026-09-01' }));
  ok(await vraag('POST', `/voorraad/artikelen/${zwart}/boeking`, { richting: 'in', aantal: 2, prijs_per_eenheid: 24, datum: '2026-09-10' }));
  hond = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelhanger hond', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 4, min_voorraad: 10 }), 201).id;
  kat = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelhanger kat', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 4 }), 201).id;
  klant = ok(await vraag('POST', '/klanten', { type: 'particulier', naam: 'Maes' }), 201).id;
});

test('V1. rol leegmelden: voorstel uit de lopende opdracht, FIFO, ongedaan op dezelfde partij', async () => {
  const printregel = { type: 'printen', omschrijving: 'Hond', printer_id: mini, aantal: 4, tijd_min: 120, voorbereiding_min: 10, nabewerking_min: 5,
    materialen: [{ artikel_id: zwart, gram: 50 }], artikel_id: hond };
  // eindproduct enkel bij een eigen product; een niet-zelf-geprint artikel kan niet
  assert.match((await vraag('POST', '/dossiers', { soort: 'eigen', titel: 'x', regels: [{ ...printregel, artikel_id: zwart }] })).data.error, /zelf printen/);
  const kd = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Klant', regels: [printregel] }), 201);
  assert.equal(kd.regels[0].artikel_id, null, 'klantopdracht: geen eindproduct');
  dos = ok(await vraag('POST', '/dossiers', { soort: 'eigen', titel: 'Hondjes', regels: [printregel] }), 201);
  regel = dos.regels[0];
  assert.equal(regel.artikel_id, hond);
  opd = ok(await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: regel.id }), 201);
  assert.equal(opd.eindproduct_id, hond); assert.equal(opd.eindproduct, 'Sleutelhanger hond');
  // twee runs: een mislukte en een geslaagde
  const r1 = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(5), geeindigd_op: iso(4), uitkomst: 'mislukt', kwh: 0.05 }), 201);
  const r2 = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(3), geeindigd_op: iso(1), uitkomst: 'klaar', kwh: 0.2 }), 201);
  ok(await vraag('POST', `/productie/runs/${r1.id}/koppel`, { printopdracht_id: opd.id }));
  ok(await vraag('POST', `/productie/runs/${r2.id}/koppel`, { printopdracht_id: opd.id }));
  const f = ok(await vraag('GET', `/productie/printers/${mini}/filament`));
  assert.deepEqual(f.voorstel.map(x => x.naam), ['Bambu Lab PLA · Zwart']);
  assert.equal(f.voorstel[0].voorraad, 3);
  assert.ok(!f.filament.some(x => x.id === wit), 'geen voorraad = niet in de lijst');
  // leegmelden: oudste partij eerst
  const uit = ok(await vraag('POST', `/productie/printers/${mini}/rol-leeg`, { artikel_id: zwart }));
  assert.equal(uit.voorraad, 2);
  const partijen = getDb().prepare('SELECT aantal_resterend FROM voorraad_partijen WHERE artikel_id = ? ORDER BY ontvangen_op').all(zwart).map(p => p.aantal_resterend);
  assert.deepEqual(partijen, [0, 2]);
  assert.equal(uit.recent[0].filament, 'Bambu Lab PLA · Zwart');
  const m = getDb().prepare(`SELECT * FROM voorraad_mutaties WHERE artikel_id = ? AND reden = 'gebruik'`).get(zwart);
  assert.equal(m.bron_type, 'printer'); assert.match(m.notitie, /Rol leeggemeld op Bambu Lab A1 Mini/);
  // ongedaan → terug op dezelfde partij, niet twee keer
  ok(await vraag('POST', `/productie/rol-leeg/${uit.recent[0].id}/ongedaan`));
  assert.deepEqual(getDb().prepare('SELECT aantal_resterend FROM voorraad_partijen WHERE artikel_id = ? ORDER BY ontvangen_op').all(zwart).map(p => p.aantal_resterend), [1, 2]);
  assert.match((await vraag('POST', `/productie/rol-leeg/${uit.recent[0].id}/ongedaan`)).data.error, /al ongedaan/);
  assert.equal(ok(await vraag('GET', `/productie/printers/${mini}/filament`)).recent[0].ongedaan, true);
  assert.match((await vraag('POST', `/productie/printers/${mini}/rol-leeg`, { artikel_id: wit })).data.error, /geen volle rol/);
  assert.match((await vraag('POST', `/productie/printers/${mini}/rol-leeg`, { artikel_id: hond })).data.error, /Kies het filament/);
});

test('V2. bevestigen → goede stuks in voorraad aan de productiekost; arbeid apart', async () => {
  const o = ok(await vraag('POST', `/productie/opdrachten/${opd.id}/bevestig`, { aantal_goed: 4 }));
  assert.equal(voorraad(hond), 4);
  const t = Object.fromEntries(getDb().prepare('SELECT sleutel, waarde FROM tarieven').all().map(x => [x.sleutel, x.waarde]));
  const perKg = (1 * 20 + 2 * 24) / 3;          // gemiddelde van de rollen in voorraad, 1000 g
  const kost = 50 / 1000 * perKg + 0.25 * t.kwh_prijs + 3 * 0.2 + 2 * t.bmcu_per_job;   // 2 runs (ook de mislukte)
  assert.ok(Math.abs(o.productiekost_stuk - kost / 4) < 0.002, `${o.productiekost_stuk} ≠ ${kost / 4}`);
  assert.ok(Math.abs(o.arbeid_stuk - 15 / 60 * t.arbeid_per_uur / 4) < 0.001);
  assert.equal(o.kost_onvolledig, 0);
  const p = getDb().prepare(`SELECT * FROM voorraad_partijen WHERE artikel_id = ?`).get(hond);
  assert.ok(Math.abs(p.prijs_per_eenheid - kost / 4) < 0.002, 'partij aan de kost zonder arbeid');
  const m = getDb().prepare(`SELECT * FROM voorraad_mutaties WHERE artikel_id = ?`).get(hond);
  assert.equal(m.reden, 'productie'); assert.equal(m.bron_type, 'printopdracht');
  const pk = ok(await vraag('GET', `/productie/productiekost/${hond}`));
  assert.equal(pk.verkoopprijs, 4); assert.equal(pk.laatste.id, opd.id); assert.equal(pk.gemiddeld.stuks, 4);
  // het eindproduct van de regel kan niet meer wijzigen
  const d = ok(await vraag('GET', `/dossiers/${dos.id}`));
  assert.match((await vraag('PUT', `/dossiers/${dos.id}`, { soort: 'eigen', titel: 'Hondjes', regels: [{ ...d.regels[0], artikel_id: kat }] })).data.error, /niet meer wijzigen/);
  assert.equal(d.productie.regels[0].eindproduct.naam, 'Sleutelhanger hond');
});

test('V3. heropenen draait de boeking terug; niet als er al stuks weg zijn', async () => {
  ok(await vraag('POST', `/productie/opdrachten/${opd.id}/heropen`));
  assert.equal(voorraad(hond), 0);
  const o = ok(await vraag('POST', `/productie/opdrachten/${opd.id}/bevestig`, { aantal_goed: 3 }));
  assert.equal(voorraad(hond), 3);
  assert.ok(o.productiekost_stuk > 0);
  // wijzigen van het eindproduct kan terug zodra niets meer geboekt is? nee: er is opnieuw geboekt
  getDb().transaction(() => boekUit(getDb(), { artikelId: hond, aantal: 1, reden: 'gebruik' }))();
  assert.match((await vraag('POST', `/productie/opdrachten/${opd.id}/heropen`)).data.error, /al \(deels\) verkocht of gebruikt/);
  assert.equal(voorraad(hond), 2);
  // 0 goede stuks = niets geboekt
  const o2 = ok(await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: regel.id, aantal: 1 }), 201);
  const r = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(0.9), geeindigd_op: iso(0.5), uitkomst: 'klaar', kwh: 0.01 }), 201);
  ok(await vraag('POST', `/productie/runs/${r.id}/koppel`, { printopdracht_id: o2.id }));
  ok(await vraag('POST', `/productie/opdrachten/${o2.id}/bevestig`, { aantal_goed: 0 }));
  assert.equal(voorraad(hond), 2);
});

test('V4. Te bestellen → printopdracht: dossier "Eigen product" met de vorige printregel herschaald', async () => {
  const tb = ok(await vraag('GET', '/voorraad/te-bestellen'));
  const h = tb.find(x => x.id === hond);
  assert.equal(h.actie, 'produceren');
  const u = ok(await vraag('POST', '/productie/eigen-product', { artikel_id: hond, aantal: 8, printer_id: mini }), 201);
  assert.equal(u.sjabloon, true);
  const d = ok(await vraag('GET', `/dossiers/${u.dossier_id}`));
  assert.equal(d.soort, 'eigen'); assert.equal(d.titel, 'Voorraad: Sleutelhanger hond');
  const rg = d.regels[0];
  assert.deepEqual([rg.aantal, rg.tijd_min, rg.materialen[0].gram, rg.artikel_id, rg.voorbereiding_min], [8, 240, 100, hond, 10]);
  assert.equal(d.productie.regels[0].opdrachten[0].status, 'gepland');
  assert.equal(d.fase, 'productie');
  // de geplande stuks tellen mee: hond (min 10) had 2 in voorraad, + 8 in productie = op peil
  assert.ok(!ok(await vraag('GET', '/voorraad/te-bestellen')).some(x => x.id === hond));
  const art = ok(await vraag('GET', `/voorraad/artikelen/${hond}`));
  assert.deepEqual([art.in_productie, art.status], [8, 'in_productie']);
  assert.equal(ok(await vraag('GET', `/voorraad/artikelen/${hond}/partijen`)).find(x => x.productie_dossier_nummer).productie_dossier_id, dos.id);
  // zonder vorige printregel: lege regel die je aanvult
  const k = ok(await vraag('POST', '/productie/eigen-product', { artikel_id: kat, aantal: 5, printer_id: mini }), 201);
  assert.equal(k.sjabloon, false);
  const dk = ok(await vraag('GET', `/dossiers/${k.dossier_id}`));
  assert.deepEqual([dk.regels[0].aantal, dk.regels[0].tijd_min, dk.regels[0].materialen.length], [5, 0, 0]);
  assert.match((await vraag('POST', '/productie/eigen-product', { artikel_id: zwart, aantal: 1, printer_id: mini })).data.error, /zelf printen/);
  assert.match((await vraag('POST', '/productie/eigen-product', { artikel_id: kat, aantal: 0, printer_id: mini })).data.error, /groter dan 0/);
});

test('V5. productiekost onvolledig zonder inkoopprijs filament', async () => {
  const d = ok(await vraag('POST', '/dossiers', { soort: 'eigen', titel: 'Wit', regels: [{ type: 'printen', printer_id: mini, aantal: 1, tijd_min: 30,
    materialen: [{ artikel_id: wit, gram: 10 }], artikel_id: kat }] }), 201);
  const o = ok(await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: d.regels[0].id }), 201);
  const r = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(0.4), geeindigd_op: iso(0.2), uitkomst: 'klaar', kwh: 0.02 }), 201);
  ok(await vraag('POST', `/productie/runs/${r.id}/koppel`, { printopdracht_id: o.id }));
  const b = ok(await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 1 }));
  assert.equal(b.kost_onvolledig, 1);
  assert.equal(voorraad(kat), 1);
});
