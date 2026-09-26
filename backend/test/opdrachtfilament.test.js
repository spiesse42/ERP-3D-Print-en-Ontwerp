// 26-09 (optie A): filament van een LOSSE printopdracht (zonder dossier).
// Vroeger bleef de productiekost van zo'n opdracht altijd onvolledig
// ("printregel (filament)"), want filament stond enkel op een dossierregel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';
import { kostPerKg } from '../productie/kost.js';
import { MIGRATIES } from '../db/migraties/index.js';

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
const fout = (r, patroon) => { assert.equal(r.status, 400, JSON.stringify(r.data)); assert.match(r.data.error, patroon); };
const iso = u => new Date(Date.now() - u * 3600e3).toISOString();
const filamentKost = (artikel, gram) => gram / 1000 * kostPerKg(getDb(), { artikel_id: artikel });
const FILAMENT_ONTBREEKT = /filament|gewicht/;
let mini, zwart, pg, bureau, uur = 60;

// Elke run een eigen tijdvak (runs op dezelfde printer mogen niet overlappen).
async function geslaagdeRun(extra = {}) {
  uur -= 2;
  return ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(uur + 1), geeindigd_op: iso(uur), uitkomst: 'klaar', kwh: 0.1, ...extra }), 201);
}

test('F0. voorbereiding: printer met tarief, filament met inkoopprijs, een gewoon artikel', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  ok(await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 95 }));
  pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  const kl = db.prepare(`SELECT id FROM filament_kleuren WHERE naam = 'Zwart'`).get().id;
  zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: kl }), 201).id;
  ok(await vraag('POST', `/voorraad/artikelen/${zwart}/boeking`, { richting: 'in', aantal: 2, prijs_per_eenheid: 20, datum: '2026-09-01' }));
  bureau = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Schroefjes', wordt_gekocht: true }), 201).id;
  assert.ok(kostPerKg(db, { artikel_id: zwart }) > 0, 'filament heeft een inkoopprijs per kg');
  assert.ok(db.pragma('user_version', { simple: true }) >= 16);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIES.at(-1).versie);
});

test('F1. run koppelen als NIEUWE opdracht mét filament: bewaard, zichtbaar, kost volledig voor het filament', async () => {
  const run = await geslaagdeRun({ bestand: 'rolhouder.gcode.3mf' });
  ok(await vraag('POST', `/productie/runs/${run.id}/koppel`, { nieuw: { naam: 'Rolhouder', aantal: 2, soort: 'intern', materialen: [{ artikel_id: zwart, gram: 80 }] } }));
  const lijst = ok(await vraag('GET', '/productie/opdrachten')).lijst;
  const o = lijst.find(x => x.naam === 'Rolhouder');
  assert.equal(o.dossier_regel_id, null);
  assert.equal(o.materialen.length, 1);
  assert.equal(o.materialen[0].artikel_id, zwart); assert.equal(o.materialen[0].gram, 80);
  assert.match(o.materialen[0].naam, /Zwart/);
  const vb = ok(await vraag('GET', `/productie/opdrachten/${o.id}/kost-voorbeeld?aantal_goed=2`));
  assert.ok(!vb.ontbreekt.some(t => FILAMENT_ONTBREEKT.test(t)), vb.ontbreekt.join('; '));
  assert.ok(Math.abs(vb.filament - filamentKost(zwart, 80)) < 1e-3, `filament ${vb.filament}`);
  // bevestigen: kost bewaard zonder filament-melding
  const b = ok(await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 2 }));
  assert.equal(b.status, 'voltooid');
  assert.ok(!String(b.kost_ontbreekt ?? '').match(FILAMENT_ONTBREEKT), b.kost_ontbreekt);
});

test('F2. zonder filament: duidelijke melding; voorbeeld met filament uit het venster rekent zonder te bewaren', async () => {
  const run = await geslaagdeRun();
  ok(await vraag('POST', `/productie/runs/${run.id}/koppel`, { nieuw: { naam: 'Kabelclip', aantal: 1, soort: 'intern' } }));
  const o = ok(await vraag('GET', '/productie/opdrachten')).lijst.find(x => x.naam === 'Kabelclip');
  const leeg = ok(await vraag('GET', `/productie/opdrachten/${o.id}/kost-voorbeeld?aantal_goed=1`));
  assert.equal(leeg.onvolledig, true);
  assert.ok(leeg.ontbreekt.includes('filament en gewicht (open de printopdracht → Filament)'), leeg.ontbreekt.join('; '));
  assert.ok(!leeg.ontbreekt.some(t => /printregel/.test(t)), 'geen verwijzing meer naar een printregel');
  const mat = encodeURIComponent(JSON.stringify([{ artikel_id: zwart, gram: 12 }]));
  const vb = ok(await vraag('GET', `/productie/opdrachten/${o.id}/kost-voorbeeld?aantal_goed=1&materialen=${mat}`));
  assert.ok(!vb.ontbreekt.some(t => FILAMENT_ONTBREEKT.test(t)));
  assert.ok(Math.abs(vb.filament - filamentKost(zwart, 12)) < 1e-3);
  assert.equal(ok(await vraag('GET', `/productie/opdrachten/${o.id}`)).materialen.length, 0, 'voorbeeld bewaart niets');
  // gekozen maar zonder gewicht
  const zonderGram = encodeURIComponent(JSON.stringify([{ artikel_id: zwart, gram: '' }]));
  const vg = ok(await vraag('GET', `/productie/opdrachten/${o.id}/kost-voorbeeld?aantal_goed=1&materialen=${zonderGram}`));
  assert.ok(vg.ontbreekt.includes('gewicht filament (open de printopdracht → Filament)'), vg.ontbreekt.join('; '));
  fout(await vraag('GET', `/productie/opdrachten/${o.id}/kost-voorbeeld?aantal_goed=1&materialen=nietjson`), /Ongeldige filamentlijst/);
});

test('F3. bevestigen MET filament uit het venster: in één keer bewaard en volledig', async () => {
  const o = ok(await vraag('GET', '/productie/opdrachten')).lijst.find(x => x.naam === 'Kabelclip');
  const b = ok(await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 1, materialen: [{ artikel_id: zwart, gram: 12 }, { filament_type_id: pg, gram: 3 }] }));
  assert.equal(b.status, 'voltooid');
  assert.equal(b.materialen.length, 2);
  assert.ok(!String(b.kost_ontbreekt ?? '').match(FILAMENT_ONTBREEKT), b.kost_ontbreekt);
  // een fout in het filament → er wordt NIETS bevestigd (één transactie)
  const run = await geslaagdeRun();
  ok(await vraag('POST', `/productie/runs/${run.id}/koppel`, { nieuw: { naam: 'Haakje', aantal: 1, soort: 'intern' } }));
  const h = ok(await vraag('GET', '/productie/opdrachten')).lijst.find(x => x.naam === 'Haakje');
  fout(await vraag('POST', `/productie/opdrachten/${h.id}/bevestig`, { aantal_goed: 1, materialen: [{ artikel_id: bureau, gram: 5 }] }), /onbekend filament/);
  assert.equal(ok(await vraag('GET', `/productie/opdrachten/${h.id}`)).status, 'te_bevestigen');
});

test('F4. al bevestigd zonder filament (zoals vandaag): filament aanvullen herberekent meteen', async () => {
  const h = ok(await vraag('GET', '/productie/opdrachten')).lijst.find(x => x.naam === 'Haakje');
  const b = ok(await vraag('POST', `/productie/opdrachten/${h.id}/bevestig`, { aantal_goed: 1 }));
  assert.equal(b.kost_onvolledig, 1);
  assert.match(b.kost_ontbreekt, /filament en gewicht/);
  const voor = b.productiekost_stuk;
  const na = ok(await vraag('PUT', `/productie/opdrachten/${h.id}/materialen`, { materialen: [{ artikel_id: zwart, gram: 40 }] }));
  assert.ok(na.kost, 'kost teruggegeven');
  assert.ok(!na.kost.ontbreekt.some(t => FILAMENT_ONTBREEKT.test(t)), na.kost.ontbreekt.join('; '));
  assert.ok(Math.abs(na.productiekost_stuk - (voor + filamentKost(zwart, 40))) < 1e-3, `${voor} → ${na.productiekost_stuk}`);
  assert.equal(na.status, 'voltooid');
  // filament weer leegmaken mag ook (en maakt de kost weer onvolledig)
  const weg = ok(await vraag('PUT', `/productie/opdrachten/${h.id}/materialen`, { materialen: [] }));
  assert.equal(weg.materialen.length, 0); assert.equal(weg.kost_onvolledig, 1);
});

test('F5. plannen en bewaren (Productie → Printopdrachten) met filament', async () => {
  const o = ok(await vraag('POST', '/productie/opdrachten', { printer_id: mini, naam: 'Onderzetter', aantal: 4, soort: 'eigen', materialen: [{ artikel_id: zwart, gram: '30,5' }] }), 201);
  assert.equal(o.materialen[0].gram, 30.5);
  const w = ok(await vraag('PUT', `/productie/opdrachten/${o.id}`, { naam: 'Onderzetter', aantal: 4, materialen: [{ filament_type_id: pg, gram: 25 }] }));
  assert.equal(w.materialen.length, 1); assert.equal(w.materialen[0].filament_type_id, pg);
  // zonder `materialen` in de body blijft het filament ongemoeid
  const w2 = ok(await vraag('PUT', `/productie/opdrachten/${o.id}`, { naam: 'Onderzetter rond', aantal: 4 }));
  assert.equal(w2.materialen.length, 1);
  // verwijderen neemt het filament mee (ON DELETE CASCADE)
  ok(await vraag('DELETE', `/productie/opdrachten/${o.id}`));
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM printopdracht_materialen WHERE printopdracht_id = ?').get(o.id).n, 0);
});

test('F6. ongeldige invoer wordt geweigerd', async () => {
  const basisBody = { printer_id: mini, naam: 'Test', aantal: 1, soort: 'intern' };
  fout(await vraag('POST', '/productie/opdrachten', { ...basisBody, materialen: [{ artikel_id: zwart, filament_type_id: pg, gram: 5 }] }), /filament of een prijsgroep/);
  fout(await vraag('POST', '/productie/opdrachten', { ...basisBody, materialen: [{ artikel_id: bureau, gram: 5 }] }), /onbekend filament/);
  fout(await vraag('POST', '/productie/opdrachten', { ...basisBody, materialen: [{ filament_type_id: 99999, gram: 5 }] }), /onbekende prijsgroep/);
  fout(await vraag('POST', '/productie/opdrachten', { ...basisBody, materialen: [{ artikel_id: zwart, gram: -1 }] }), /gewicht/);
  fout(await vraag('POST', '/productie/opdrachten', { ...basisBody, materialen: 'zwart' }), /lijst/);
  // lege rijen (niets gekozen) vallen gewoon weg
  const o = ok(await vraag('POST', '/productie/opdrachten', { ...basisBody, materialen: [{ artikel_id: '', gram: '' }] }), 201);
  assert.equal(o.materialen.length, 0);
});

test('F7. opdracht van een dossier: filament blijft op de regel (hier geweigerd)', async () => {
  const d = ok(await vraag('POST', '/dossiers', { soort: 'intern', titel: 'Intern met regel', regels: [{ type: 'printen', printer_id: mini, aantal: 1, tijd_min: 30,
    materialen: [{ artikel_id: zwart, gram: 10 }] }] }), 201);
  fout(await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: d.regels[0].id, materialen: [{ artikel_id: zwart, gram: 5 }] }), /regel van het dossier/);
  const o = ok(await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: d.regels[0].id }), 201);
  assert.equal(o.materialen[0].gram, 10, 'filament komt van de regel');
  fout(await vraag('PUT', `/productie/opdrachten/${o.id}/materialen`, { materialen: [{ artikel_id: zwart, gram: 5 }] }), /regel van het dossier/);
  fout(await vraag('PUT', `/productie/opdrachten/${o.id}`, { naam: o.naam, aantal: 1, materialen: [{ artikel_id: zwart, gram: 5 }] }), /regel van het dossier/);
  // en de regel-melding voor een dossier zonder gewicht verwijst naar de regel
  const d2 = ok(await vraag('POST', '/dossiers', { soort: 'intern', titel: 'Zonder gram', regels: [{ type: 'printen', printer_id: mini, aantal: 1, tijd_min: 30 }] }), 201);
  const o2 = ok(await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: d2.regels[0].id }), 201);
  const vb = ok(await vraag('GET', `/productie/opdrachten/${o2.id}/kost-voorbeeld?aantal_goed=1`));
  assert.ok(vb.ontbreekt.includes('gewicht filament (op de printregel van het dossier)'), vb.ontbreekt.join('; '));
});

test('F8. rol leegmelden: het filament van de losse opdracht staat bij de voorstellen', async () => {
  const run = await geslaagdeRun();
  ok(await vraag('POST', `/productie/runs/${run.id}/koppel`, { nieuw: { naam: 'Voorstel-test', aantal: 1, soort: 'intern', materialen: [{ artikel_id: zwart, gram: 5 }] } }));
  const f = ok(await vraag('GET', `/productie/printers/${mini}/filament`));
  assert.ok(f.voorstel.some(a => a.id === zwart), JSON.stringify(f.voorstel));
});
