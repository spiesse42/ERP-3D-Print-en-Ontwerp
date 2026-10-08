// 06-10: vaste producten — printregel per stuk, stuks per plaat (één
// printopdracht per plaat, BMCU per plaat), printprofiel op het artikel en
// bijprinten volgens het profiel.
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
let mini, zwart, pg, medaillon, klant;

test('P0. voorbereiding', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  ok(await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 95 }));
  pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: db.prepare(`SELECT id FROM filament_kleuren WHERE naam = 'Zwart'`).get().id }), 201).id;
  medaillon = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Medaillon', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 6 }), 201).id;
  klant = ok(await vraag('POST', '/klanten', { type: 'particulier', naam: 'Leijs' }), 201).id;
});

test('P1. per_plaat: BMCU en standaard-voorbereiding per plaat', async () => {
  const regel = { type: 'printen', printer_id: mini, aantal: 22, tijd_min: 22 * 30, materialen: [{ artikel_id: zwart, gram: 22 * 12 }] };
  const een = ok(await vraag('POST', '/bereken', { regels: [regel] })).regels[0]._berekend.detail;
  const drie = ok(await vraag('POST', '/bereken', { regels: [{ ...regel, per_plaat: 8 }] })).regels[0]._berekend.detail;
  assert.equal(een.platen, 1); assert.equal(drie.platen, 3);
  assert.ok(Math.abs(drie.bmcu - 3 * een.bmcu) < 1e-9);
  assert.equal(drie.voorbereiding_min, 3 * een.voorbereiding_min);
  assert.equal(drie.materiaal, een.materiaal, 'materiaal blijft hetzelfde');
});

test('P2. klantdossier 22 stuks, 8 per plaat → printopdrachten 8 + 8 + 6; per_stuk blijft bewaard', async () => {
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Medaillons', regels: [
    { type: 'printen', omschrijving: 'Medaillon', printer_id: mini, aantal: 22, tijd_min: 660, per_stuk: true, per_plaat: 8, materialen: [{ artikel_id: zwart, gram: 264 }] }] }), 201);
  assert.equal(d.regels[0].per_stuk, true); assert.equal(d.regels[0].per_plaat, 8);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  const aantallen = s.productie.regels[0].opdrachten.map(o => o.aantal).sort((a, b) => b - a);
  assert.deepEqual(aantallen, [8, 8, 6]);
  // aantal verhogen naar 30 → aangevuld tot volle platen: 8 + 8 + 8 + 6
  const w = ok(await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Medaillons', regels: [{ ...s.regels[0], aantal: 30, tijd_min: 900, materialen: [{ artikel_id: zwart, gram: 360 }] }] }));
  assert.deepEqual(w.productie.regels[0].opdrachten.map(o => o.aantal).sort((a, b) => b - a), [8, 8, 8, 6]);
});

test('P3. printprofiel bewaren (validatie) en bijprinten volgens profiel', async () => {
  assert.match((await vraag('PUT', `/productie/printprofiel/${zwart}`, { profiel: { tijd_min: 30 } })).data.error, /zelf printen/);
  assert.match((await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: { per_plaat: 8 } })).data.error, /printtijd of het gewicht/);
  const p = ok(await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: { printer_id: mini, tijd_min: 30, per_plaat: 8, voorbereiding_min: 5, nabewerking_min: 1, materialen: [{ artikel_id: zwart, gram: 12 }] } })).profiel;
  assert.equal(p.per_plaat, 8);
  const lijst = ok(await vraag('GET', '/productie/printprofielen'));
  assert.equal(lijst.length, 1); assert.equal(lijst[0].id, medaillon);
  // bijprinten zonder printer: die van het profiel
  const u = ok(await vraag('POST', '/productie/eigen-product', { artikel_id: medaillon, aantal: 22 }), 201);
  assert.equal(u.profiel, true); assert.equal(u.opdrachten, 3);
  const d = ok(await vraag('GET', `/dossiers/${u.dossier_id}`));
  const r = d.regels[0];
  assert.equal(r.tijd_min, 660); assert.equal(r.materialen[0].gram, 264);
  assert.equal(r.voorbereiding_min, 15, '5 min × 3 platen'); assert.equal(r.nabewerking_min, 22);
  assert.equal(r.per_stuk, true); assert.equal(r.artikel_id, medaillon);
  // profiel wissen
  assert.equal(ok(await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: null })).profiel, null);
});

test('P4. volledig geleverde printregel: geplande printopdrachten vervallen; levering ongedaan → komen terug', async () => {
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Geleverd', regels: [
    { type: 'printen', omschrijving: 'Testprint', printer_id: mini, aantal: 1, tijd_min: 30, materialen: [{ artikel_id: zwart, gram: 10 }] }] }), 201);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  assert.equal(s.productie.regels[0].opdrachten.length, 1);
  const na = ok(await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: '2026-10-07', regels: [{ regel_id: s.regels[0].id, aantal: 1 }] }), 201);
  assert.equal(na.productie.regels[0].opdrachten.filter(o => !o.geannuleerd_op).length, 0, 'geplande opdracht weg');
  const lev = getDb().prepare('SELECT id FROM leveringen WHERE dossier_id = ?').get(d.id).id;
  const terug = ok(await vraag('DELETE', `/leveringen/${lev}`));
  assert.equal(terug.productie.regels[0].opdrachten.length, 1, 'levering ongedaan → opdracht terug');
});

test('P5. productiekost (schatting) per printregel, totaal en per geplande printopdracht', async () => {
  getDb().prepare('UPDATE artikelen SET inkoopprijs = 20 WHERE id = ?').run(zwart);   // 20 €/rol van 1 kg
  const regel = { type: 'printen', printer_id: mini, aantal: 2, tijd_min: 120, materialen: [{ artikel_id: zwart, gram: 100 }] };
  const b = ok(await vraag('POST', '/bereken', { regels: [regel] }));
  const k = b.regels[0]._berekend.kost;
  const rolg = getDb().prepare('SELECT rolgewicht_g g FROM filament_types WHERE id = ?').get(pg).g;
  assert.equal(k.filament, Math.round(100 / 1000 * 20 / rolg * 1000 * 10000) / 10000, 'filament aan inkoopprijs, zonder faalfactor');
  assert.equal(k.machine, 0.4, '2 u × 0,20');
  assert.ok(Math.abs(k.kost - (k.filament + k.energie + k.machine + k.bmcu)) < 1e-3);
  assert.ok(Math.abs(k.winst - (b.regels[0]._berekend.eindbedrag - k.kost)) < 1e-3);
  assert.equal(b.productiekost.kost, k.kost);
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Kost', regels: [{ ...regel, omschrijving: 'Kost' }] }), 201);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  const o = s.productie.regels[0].opdrachten[0];
  assert.ok(o.kost_schatting && Math.abs(o.kost_schatting.machine - 0.4) < 1e-3, 'geplande opdracht krijgt een schatting');
});

test('P6. printuurmodel: winst per printuur, materiaal minstens inkoop × opslag, oude berekening ter vergelijking', async () => {
  ok(await vraag('PUT', '/tarieven', { winst_per_printuur: 1, materiaal_opslag_pct: 200, winst_lang_grens_uur: 12, winst_lang_pct: 60 }));
  try {
    getDb().prepare('UPDATE artikelen SET inkoopprijs = 20 WHERE id = ?').run(zwart);
    const regel = { type: 'printen', printer_id: mini, aantal: 1, tijd_min: 20 * 60, materialen: [{ artikel_id: zwart, gram: 100 }] };
    const b = ok(await vraag('POST', '/bereken', { regels: [regel] }));
    const d = b.regels[0]._berekend.detail;
    assert.equal(b.model, 'printuur');
    assert.equal(b.marge_pct, 0);
    assert.ok(Math.abs(d.winst - (12 + 8 * 0.6)) < 1e-9, '12 u × € 1 + 8 u × € 0,60');
    const kg = d.materialen[0].prijs_per_kg;
    assert.ok(kg >= 25 && Math.abs(kg - Math.max(25, 20 / (getDb().prepare('SELECT rolgewicht_g g FROM filament_types WHERE id = ?').get(pg).g / 1000) * 2)) < 0.01, 'max(verkoop, inkoop × 2)');
    assert.ok(b.oud && b.oud.totaal < b.totaal, 'oude berekening lager');
    assert.equal(b.regels[0]._berekend.oud, b.oud.regels[0]);
  } finally {
    ok(await vraag('PUT', '/tarieven', { winst_per_printuur: 0, materiaal_opslag_pct: 0 }));
  }
});
