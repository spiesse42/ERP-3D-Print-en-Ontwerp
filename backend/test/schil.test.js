// Tests voor stap 2 (backendkant van de Odoo-schil): historiek, archiveren,
// opslaan in één keer, integratiestatus.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { beschrijfWijzigingen } from '../domein/historiek.js';

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
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}

test('klant aanmaken en wijzigen schrijft historiek', async () => {
  let r = await vraag('POST', '/klanten', { naam: 'Verbeke', type: 'zakelijk', bedrijfsnaam: 'Atelier Verbeke bv', gemeente: 'Mol' });
  const id = r.data.id;
  r = await vraag('PUT', `/klanten/${id}`, { naam: 'Verbeke', type: 'zakelijk', bedrijfsnaam: 'Atelier Verbeke bv', gemeente: 'Geel', email: 'info@voorbeeld.be' });
  assert.equal(r.status, 200);
  r = await vraag('GET', `/historiek/klant/${id}`);
  assert.equal(r.data.length, 2);
  assert.equal(r.data[0].soort, 'gewijzigd');
  assert.match(r.data[0].tekst, /Gemeente: Mol → Geel/);
  assert.match(r.data[0].tekst, /E-mail ingevuld: info@voorbeeld\.be/);
  assert.equal(r.data[1].soort, 'aangemaakt');
  // opslaan zonder wijziging → geen nieuwe gebeurtenis
  await vraag('PUT', `/klanten/${id}`, { naam: 'Verbeke', type: 'zakelijk', bedrijfsnaam: 'Atelier Verbeke bv', gemeente: 'Geel', email: 'info@voorbeeld.be' });
  r = await vraag('GET', `/historiek/klant/${id}`);
  assert.equal(r.data.length, 2);
});

test('type terug naar particulier wist bedrijfsnaam en Peppol-ID', async () => {
  let r = await vraag('POST', '/klanten', { naam: 'Maes', type: 'zakelijk', bedrijfsnaam: 'Maes bv', peppol_id: '0208:1' });
  const id = r.data.id;
  await vraag('PUT', `/klanten/${id}`, { naam: 'Maes', type: 'particulier', bedrijfsnaam: 'Maes bv', peppol_id: '0208:1' });
  r = await vraag('GET', `/klanten/${id}`);
  assert.equal(r.data.bedrijfsnaam, null);
  assert.equal(r.data.peppol_id, null);
});

test('ongeldig e-mailadres wordt geweigerd', async () => {
  const r = await vraag('POST', '/klanten', { naam: 'X', email: 'geen-adres' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /e-mailadres/);
});

test('archiveren en herstellen: lijstfilter + historiek', async () => {
  let r = await vraag('POST', '/klanten', { naam: 'Peeters' });
  const id = r.data.id;
  r = await vraag('PATCH', `/klanten/${id}/archief`, { gearchiveerd: true });
  assert.equal(r.status, 200);
  const actief = (await vraag('GET', '/klanten')).data.map(k => k.id);
  const archief = (await vraag('GET', '/klanten?archief=1')).data.map(k => k.id);
  const alle = (await vraag('GET', '/klanten?archief=alle')).data.map(k => k.id);
  assert.ok(!actief.includes(id));
  assert.ok(archief.includes(id));
  assert.ok(alle.includes(id));
  await vraag('PATCH', `/klanten/${id}/archief`, { gearchiveerd: false });
  r = await vraag('GET', `/historiek/klant/${id}`);
  assert.deepEqual(r.data.map(g => g.soort), ['hersteld', 'gearchiveerd', 'aangemaakt']);
  r = await vraag('PATCH', '/klanten/99999/archief', { gearchiveerd: true });
  assert.equal(r.status, 404);
});

test('notities: toevoegen, lege weigeren, onbekend record of soort weigeren', async () => {
  const id = (await vraag('POST', '/klanten', { naam: 'De Smet' })).data.id;
  let r = await vraag('POST', `/historiek/klant/${id}`, { tekst: 'Wil offerte voor 20 figuren.' });
  assert.equal(r.status, 201);
  r = await vraag('POST', `/historiek/klant/${id}`, { tekst: '   ' });
  assert.equal(r.status, 400);
  r = await vraag('GET', `/historiek/klant/99999`);
  assert.equal(r.status, 404);
  r = await vraag('GET', `/historiek/tarieven/1`);
  assert.equal(r.status, 404);
  r = await vraag('GET', `/historiek/klant/${id}`);
  assert.equal(r.data[0].soort, 'notitie');
  assert.equal(r.data[0].tekst, 'Wil offerte voor 20 figuren.');
});

test('verwijderen van een klant neemt de historiek mee', async () => {
  const id = (await vraag('POST', '/klanten', { naam: 'Tijdelijk' })).data.id;
  await vraag('POST', `/historiek/klant/${id}`, { tekst: 'test' });
  await vraag('DELETE', `/klanten/${id}`);
  const n = getDb().prepare(`SELECT COUNT(*) c FROM gebeurtenissen WHERE entiteit='klant' AND entiteit_id=?`).get(id).c;
  assert.equal(n, 0);
});

test('tarieven in één keer opslaan: alles of niets', async () => {
  let r = await vraag('PUT', '/tarieven', { kwh_prijs: '0,31', marge_klein_pct: 20 });
  assert.equal(r.status, 200);
  const t = Object.fromEntries(getDb().prepare('SELECT sleutel, waarde FROM tarieven').all().map(x => [x.sleutel, x.waarde]));
  assert.equal(t.kwh_prijs, 0.31);
  assert.equal(t.marge_klein_pct, 20);
  r = await vraag('PUT', '/tarieven', { kwh_prijs: 0.5, arbeid_per_uur: 'x' });
  assert.equal(r.status, 400);
  assert.equal(getDb().prepare(`SELECT waarde FROM tarieven WHERE sleutel='kwh_prijs'`).get().waarde, 0.31, 'niets gewijzigd bij een fout');
  r = await vraag('PUT', '/tarieven', { onbekend: 1 });
  assert.equal(r.status, 404);
  r = await vraag('PUT', '/tarieven', { kwh_prijs: -1 });
  assert.equal(r.status, 400);
});

test('bedrijfsgegevens in één keer opslaan; geheimen geweigerd', async () => {
  let r = await vraag('PUT', '/instellingen', { bedrijf_naam: '3Dplezier', bedrijf_email: 'x@y.be' });
  assert.equal(r.status, 200);
  r = await vraag('GET', '/instellingen');
  assert.equal(r.data.find(x => x.sleutel === 'bedrijf_email').waarde, 'x@y.be');
  r = await vraag('PUT', '/instellingen', { bedrijf_naam: 'X', ha_token: 'geheim' });
  assert.equal(r.status, 403);
  r = await vraag('GET', '/instellingen');
  assert.equal(r.data.find(x => x.sleutel === 'bedrijf_naam').waarde, '3Dplezier');
});

test('integratiestatus geeft enkel ja/nee terug, nooit de sleutel', async () => {
  process.env.GEMINI_API_KEY = 'geheime-sleutel';
  const r = await vraag('GET', '/instellingen/integraties');
  delete process.env.GEMINI_API_KEY;
  assert.equal(r.data.gemini, true);
  assert.ok(!JSON.stringify(r.data).includes('geheime-sleutel'));
});

test('beschrijfWijzigingen', () => {
  const t = beschrijfWijzigingen({ a: 'x', b: null, c: 'z' }, { a: 'y', b: 'q', c: null }, { a: 'A', b: 'B', c: 'C' });
  assert.equal(t, 'A: x → y; B ingevuld: q; C gewist');
  assert.equal(beschrijfWijzigingen({ a: 1 }, { a: '1' }, { a: 'A' }), '');
});

test('migratie 002: zakelijke klant zonder contactnaam; particulier blijft naam nodig', async () => {
  let r = await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'Café Het Anker' });
  assert.equal(r.status, 201);
  r = await vraag('POST', '/klanten', { type: 'zakelijk' });
  assert.equal(r.status, 400);
  r = await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Sofie' });
  assert.equal(r.status, 400);
  assert.throws(() => getDb().prepare(`INSERT INTO klanten (type) VALUES ('particulier')`).run(), /CHECK/);
});

test('index.html krijgt het Ingress-pad als <base href> (ook op een diepe link)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dist = path.join(import.meta.dirname, '..', '..', 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(dist)) return; // frontend niet gebouwd: test overslaan
  const root = basis.replace(/\/api$/, '');
  let res = await fetch(root + '/klanten/12');
  assert.match(await res.text(), /<base href="\/" \/>/);
  res = await fetch(root + '/klanten/12', { headers: { 'X-Ingress-Path': '/api/hassio_ingress/abc123' } });
  assert.match(await res.text(), /<base href="\/api\/hassio_ingress\/abc123\/" \/>/);
  res = await fetch(root + '/', { headers: { 'X-Ingress-Path': '/x"><script>alert(1)</script>' } });
  const html = await res.text();
  assert.ok(!html.includes('<script>alert'), 'header wordt opgekuist');
});
