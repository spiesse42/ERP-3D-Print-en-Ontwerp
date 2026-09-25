// Bestelbon inlezen (25-09): bestelmail van Joybuy (geplakte tekst) →
// aankoop "besteld" zonder prijzen; deels ontvangen; factuur met hetzelfde
// bestelnummer → gekoppeld aan die aankoop (prijzen, ook in voorraad,
// verzending toegevoegd), geen dubbele aankoop.
process.env.NODE_ENV = 'test';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { vervangLezer, maakInstructie } from '../integraties/gemini.js';
import { catalogusVoorInstructie } from '../domein/factuurherkenning.js';
import { JOYBUY_BESTELMAIL, JOYBUY_FACTUUR } from './fixtures/gemini-antwoorden.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { vervangLezer(null); server.close(); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
let gezien = null;
async function leesTekst(antwoord, tekst) {
  vervangLezer(async args => { gezien = args; return structuredClone(antwoord); });
  const fd = new FormData(); fd.append('tekst', tekst);
  const res = await fetch(`${basis}/inkoop/inlezen`, { method: 'POST', body: fd });
  return { status: res.status, data: await res.json() };
}
async function leesPdf(antwoord, naam) {
  vervangLezer(async args => { gezien = args; return structuredClone(antwoord); });
  const fd = new FormData(); fd.append('bestand', new Blob(['%PDF-1.4 nep'], { type: 'application/pdf' }), naam);
  const res = await fetch(`${basis}/inkoop/inlezen`, { method: 'POST', body: fd });
  return { status: res.status, data: await res.json() };
}
const alsBody = (v, extra = {}) => ({
  leverancier: v.leverancier.id ? { id: v.leverancier.id } : v.leverancier,
  documentsoort: v.documentsoort, factuurnummer: v.factuurnummer, bestelnummer: v.bestelnummer, datum: v.datum, meteen_ontvangen: false,
  regels: v.regels.map(r => ({ soort: r.soort, artikel_id: r.artikel_id, nieuw_artikel: r.nieuw_artikel,
    filament: r.filament ? { ...r.filament, verkoopprijs_per_kg: 20 } : undefined, aankoop_regel_id: r.aankoop_regel_id,
    omschrijving: r.omschrijving, productcode: r.productcode, aantal: r.aantal, prijs_per_eenheid: r.prijs_per_eenheid })),
  ...extra,
});
const MAIL = 'Bedankt voor uw bestelling(bestelling 1062802400000080695) … 1. JOYBUY x ANYCUBIC PLA Basic … Cyaan x1 …';

test('B0. instructie kent documentsoort en bestelnummer', () => {
  const t = maakInstructie(catalogusVoorInstructie(getDb()));
  assert.match(t, /BESTELBEVESTIGING/); assert.match(t, /bestelnummer/); assert.match(t, /Een bestelbon zonder prijzen/);
});

let akId;
test('B1. bestelmail plakken → voorstel "bestelbon" zonder prijzen → aankoop besteld met bestelnummer', async () => {
  const r = await leesTekst(JOYBUY_BESTELMAIL, MAIL);
  const d = ok(r);
  assert.equal(gezien.tekst, MAIL); assert.equal(gezien.buffer, undefined);
  assert.equal(d.mimetype, 'text/plain'); assert.equal(d.bestandsnaam, 'bestelmail-1062802400000080695.txt');
  const v = d.voorstel;
  assert.equal(v.documentsoort, 'bestelbon'); assert.equal(v.bestelnummer, '1062802400000080695');
  assert.equal(v.regels.length, 9); assert.ok(v.regels.every(x => x.prijs_per_eenheid === null));
  assert.equal(v.bestelling, null);
  const b = await fetch(`${basis}/inkoop/inlezen/${d.token}/bestand`); assert.equal(await b.text(), MAIL);
  const ak = ok(await vraag('POST', `/inkoop/inlezen/${d.token}/bevestig`, alsBody(v)), 201);
  const a = ok(await vraag('GET', `/inkoop/aankopen/${ak.id}`));
  assert.equal(a.status, 'besteld'); assert.equal(a.besteld_op, '2026-09-21');
  assert.equal(a.extern_bestelnummer, '1062802400000080695'); assert.equal(a.extern_factuurnummer, null);
  assert.equal(a.regels.reduce((t, x) => t + x.aantal, 0), 12);
  assert.ok(a.regels.every(x => x.prijs_per_eenheid === null));
  assert.equal(a.bijlagen[0].bestandsnaam, 'bestelmail-1062802400000080695.txt');
  akId = ak.id;
});

test('B2. dezelfde bestelmail nog eens → gemeld als al ingelezen', async () => {
  const d = ok(await leesTekst(JOYBUY_BESTELMAIL, MAIL));
  assert.equal(d.voorstel.dubbel.id, akId);
  const r = await vraag('POST', `/inkoop/inlezen/${d.token}/bevestig`, alsBody(d.voorstel));
  assert.equal(r.status, 400); assert.match(r.data.error, /al ingelezen/);
});

test('B3. eerste pakket: 3 rollen ontvangen zonder prijs', async () => {
  const a = ok(await vraag('GET', `/inkoop/aankopen/${akId}`));
  const lijnen = a.regels.slice(0, 2).map(x => ({ regel_id: x.id, aantal: x.aantal }));   // cyaan 1 + textuurgrijs 2
  ok(await vraag("POST", `/inkoop/aankopen/${akId}/ontvangen`, { lijnen }));
  const na = ok(await vraag('GET', `/inkoop/aankopen/${akId}`));
  assert.equal(na.status, 'deels');
});

test('B4. factuur met hetzelfde ordernummer → voorstel: koppelen aan de bestelling; leverancier van de bestelling', async () => {
  const d = ok(await leesPdf(JOYBUY_FACTUUR, 'Joybuy.pdf'));
  const v = d.voorstel;
  assert.equal(v.documentsoort, 'factuur');
  assert.equal(v.bestelling.id, akId);
  assert.equal(v.leverancier.naam, 'Joybuy', 'andere firmanaam op de factuur → leverancier van de bestelling');
  const gekoppeld = v.regels.filter(r => r.aankoop_regel_id);
  assert.equal(gekoppeld.length, 9, 'alle filamentregels gevonden');
  assert.equal(v.regels.find(r => r.soort === 'kost').aankoop_regel_id, undefined, 'verzending staat niet op de bestelling');
  const res = ok(await vraag('POST', `/inkoop/inlezen/${d.token}/bevestig`, alsBody(v, { aankoop_id: akId })), 201);
  assert.equal(res.id, akId); assert.equal(res.gekoppeld, true); assert.equal(res.bijgewerkt, 9); assert.equal(res.toegevoegd, 1);
  const a = ok(await vraag('GET', `/inkoop/aankopen/${akId}`));
  assert.equal(a.extern_factuurnummer, 'NL20260002895943');
  assert.equal(a.regels.length, 10);
  assert.equal(a.regels[0].prijs_per_eenheid, 8.24);
  assert.equal(a.totaal, 98.89);
  assert.equal(a.bijlagen.length, 2);
  // wat al ontvangen was, kreeg de factuurprijs in voorraad
  const partijen = getDb().prepare('SELECT prijs_per_eenheid FROM voorraad_partijen WHERE aankoop_regel_id IN (?, ?)').all(a.regels[0].id, a.regels[1].id);
  assert.deepEqual(partijen.map(p => p.prijs_per_eenheid), [8.24, 8.245]);
  // geen tweede aankoop
  assert.equal(ok(await vraag('GET', '/inkoop/aankopen')).length, 1);
  const h = ok(await vraag('GET', `/historiek/aankoop/${akId}`)).map(x => x.tekst);
  assert.ok(h.some(t => /Factuur NL20260002895943 gekoppeld: 9 regels bijgewerkt \(prijs, ook in voorraad\), 1 toegevoegd/.test(t)));
});

test('B5. dezelfde factuur nog eens → geen bestelling meer (heeft al een factuur), dubbel gemeld', async () => {
  const d = ok(await leesPdf(JOYBUY_FACTUUR, 'Joybuy.pdf'));
  assert.equal(d.voorstel.bestelling, null);
  assert.equal(d.voorstel.dubbel.id, akId);
});
