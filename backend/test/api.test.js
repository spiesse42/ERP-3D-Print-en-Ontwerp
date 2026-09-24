// HTTP-tests: de echte Express-app tegen een databank in het geheugen.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';

let server, basis;

before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); sluitDb(); });

async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, {
    method: methode,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}

test('klanten: aanmaken, lezen, wijzigen (incl. Peppol-ID), verwijderen', async () => {
  let r = await vraag('POST', '/klanten', { naam: 'Jeugdhuis Test vzw', type: 'zakelijk', btw_nummer: 'BE0123456789', peppol_id: '0208:0123456789' });
  assert.equal(r.status, 201);
  const id = r.data.id;
  r = await vraag('GET', `/klanten/${id}`);
  assert.equal(r.data.peppol_id, '0208:0123456789');
  assert.equal(r.data.gearchiveerd, 0);
  r = await vraag('PUT', `/klanten/${id}`, { naam: 'Jeugdhuis Test vzw', type: 'zakelijk', gemeente: 'Geel' });
  assert.equal(r.status, 200);
  r = await vraag('GET', `/klanten/${id}`);
  assert.equal(r.data.gemeente, 'Geel');
  assert.equal(r.data.peppol_id, null);
  r = await vraag('POST', '/klanten', { type: 'particulier' });
  assert.equal(r.status, 400, 'naam is verplicht');
  r = await vraag('POST', '/klanten', { naam: 'X', type: 'bedrijf' });
  assert.equal(r.status, 400, 'onbekend type geweigerd');
  r = await vraag('DELETE', `/klanten/${id}`);
  assert.equal(r.status, 200);
  r = await vraag('GET', `/klanten/${id}`);
  assert.equal(r.status, 404);
});

test('tarieven: lijst en wijzigen; een 0 blijft 0', async () => {
  let r = await vraag('GET', '/tarieven');
  assert.equal(r.data.length, 11);
  r = await vraag('PUT', '/tarieven/faalfactor_pct', { waarde: 0 });
  assert.equal(r.status, 200);
  assert.equal(getDb().prepare(`SELECT waarde FROM tarieven WHERE sleutel='faalfactor_pct'`).get().waarde, 0);
  r = await vraag('PUT', '/tarieven/bestaat_niet', { waarde: 1 });
  assert.equal(r.status, 404);
  r = await vraag('PUT', '/tarieven/kwh_prijs', { waarde: 'abc' });
  assert.equal(r.status, 400);
});

test('instellingen: enkel bedrijfsgegevens via de API', async () => {
  let r = await vraag('PUT', '/instellingen/bedrijf_naam', { waarde: '3Dplezier' });
  assert.equal(r.status, 200);
  r = await vraag('GET', '/instellingen');
  assert.equal(r.data.find(x => x.sleutel === 'bedrijf_naam').waarde, '3Dplezier');
  r = await vraag('PUT', '/instellingen/ha_token', { waarde: 'geheim' });
  assert.equal(r.status, 403, 'geheimen kunnen niet via de app');
});

test('catalogus: merken, materialen, kleuren en prijsgroepen', async () => {
  let r = await vraag('GET', '/filament/merken');
  assert.equal(r.data.length, 8);
  r = await vraag('POST', '/filament/merken', { naam: 'bambu lab' });
  assert.equal(r.status, 400, 'duplicaat hoofdletterongevoelig geweigerd');
  r = await vraag('POST', '/filament/merken', { naam: 'Elegoo' });
  assert.equal(r.status, 201);
  r = await vraag('POST', '/filament/kleuren', { naam: 'Mint', hex: 'groen' });
  assert.equal(r.status, 400, 'ongeldige hex');
  r = await vraag('POST', '/filament/kleuren', { naam: 'Mint', hex: '#98ff98' });
  assert.equal(r.status, 201);
  const kleurId = r.data.id;

  r = await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 4, verkoopprijs_per_kg: 32, min_rollen: 2 });
  assert.equal(r.status, 201);
  const pg = r.data.id;
  r = await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 4, verkoopprijs_per_kg: 30 });
  assert.equal(r.status, 400, 'zelfde merk+type bestaat al');
  r = await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 4, verkoopprijs_per_kg: -1 });
  assert.equal(r.status, 400);
  r = await vraag('GET', '/filament/types');
  assert.equal(r.data[0].merk, 'Bambu Lab');
  assert.equal(r.data[0].materiaal, 'PLA Matte');

  // prijsgroep met een artikel eraan kan niet weg
  getDb().prepare(`INSERT INTO artikelen (type, wordt_gekocht, filament_type_id, kleur_id, eenheid) VALUES ('filament', 1, ?, ?, 'rollen')`).run(pg, kleurId);
  r = await vraag('DELETE', `/filament/types/${pg}`);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /artikelen/);
});

test('oude voorraadroutes zijn weg en geven een nette 404', async () => {
  for (const pad of ['/filament/rollen', '/filament/te-bestellen', '/artikelen/types', '/facturen']) {
    const r = await vraag('GET', pad);
    assert.equal(r.status, 404, pad);
    assert.equal(r.data.error, 'Onbekende API-route');
  }
});
