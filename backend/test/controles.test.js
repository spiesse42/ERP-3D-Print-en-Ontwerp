// Stap 4b: overzicht ontbrekende gegevens + artikel met herkomst.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { ontbrekendeGegevens } from '../domein/controles.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const groepen = l => l.map(x => x.groep);

test('D1. nieuwe databank: printers, bedrijf en Gemini ontbreken; tarieven zijn ingevuld', () => {
  const l = ontbrekendeGegevens(getDb(), { geminiIngesteld: false });
  assert.equal(l.filter(x => x.groep === 'Printers').length, 3);
  assert.match(l.find(x => x.groep === 'Printers').tekst, /machinetarief en gemiddeld verbruik ontbreekt/);
  assert.ok(!groepen(l).includes('Tarieven'));
  assert.ok(groepen(l).includes('Bedrijfsgegevens'));
  assert.ok(groepen(l).includes('Integraties'));
  assert.ok(l.every(x => x.naar.startsWith('/')), 'elke melding heeft een link');
  assert.ok(!groepen(ontbrekendeGegevens(getDb(), { geminiIngesteld: true, mailIngesteld: true, pdfBeschikbaar: true })).includes('Integraties'));
  const zonder = ontbrekendeGegevens(getDb(), { geminiIngesteld: true, mailIngesteld: false, pdfBeschikbaar: false }).filter(x => x.groep === 'Integraties');
  assert.equal(zonder.length, 2, 'mailen en PDF');
});

test('D2. oplossen doet de melding verdwijnen; nieuwe problemen verschijnen', async () => {
  const db = getDb();
  const mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18 });
  let l = ontbrekendeGegevens(db);
  assert.match(l.find(x => x.tekst.startsWith('Bambu Lab A1 Mini')).tekst, /: gemiddeld verbruik ontbreekt/);
  await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 });
  // een gedeactiveerde printer telt niet mee
  const kobra = db.prepare(`SELECT id FROM printers WHERE naam = 'AnyCubic Kobra S1'`).get().id;
  await vraag('PATCH', `/printers/${kobra}/actief`, { actief: false });
  l = ontbrekendeGegevens(db);
  assert.deepEqual(l.filter(x => x.groep === 'Printers').map(x => x.tekst), ['Bambu Lab A1: machinetarief en gemiddeld verbruik ontbreekt']);

  // tarief leeg, prijsgroep aan € 0, zakelijke klant zonder btw
  const kwh = db.prepare(`SELECT * FROM tarieven WHERE sleutel = 'kwh_prijs'`).get();
  db.prepare(`DELETE FROM tarieven WHERE sleutel = 'kwh_prijs'`).run();
  db.prepare('INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg) VALUES (1, 1, 0)').run();
  const k = (await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'Bakkerij Peeters' })).data.id;
  l = ontbrekendeGegevens(db);
  assert.match(l.find(x => x.groep === 'Tarieven').tekst, /kwh_prijs is niet ingevuld/);
  assert.match(l.find(x => x.groep === 'Materiaalprijzen').tekst, /Bambu Lab PLA/);
  const kl = l.find(x => x.groep === 'Klanten');
  assert.equal(kl.naar, `/klanten/${k}`);
  assert.match(kl.tekst, /Bakkerij Peeters/);

  // bedrijfsgegevens deels ingevuld → enkel wat nog ontbreekt
  await vraag('PUT', '/instellingen', { bedrijf_naam: '3Dplezier', bedrijf_adres: 'Straat 1, 2460 Kasterlee' });
  l = ontbrekendeGegevens(db);
  assert.match(l.find(x => x.groep === 'Bedrijfsgegevens').tekst, /Ontbreekt: btw-nummer, IBAN/);
  db.prepare('INSERT INTO tarieven (sleutel, waarde, eenheid, label) VALUES (?,?,?,?)').run(kwh.sleutel, kwh.waarde, kwh.eenheid, kwh.label);
});

test('D3. GET /api/controles + artikel aangemaakt vanuit de proefberekening', async () => {
  let r = await vraag('GET', '/controles');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data) && r.data.length > 0);
  r = await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Verzending bpost', wordt_verkocht: true, verkoopprijs: '4,5', vaste_prijs: true, herkomst: 'proefberekening' });
  assert.equal(r.status, 201);
  const h = (await vraag('GET', `/historiek/artikel/${r.data.id}`)).data;
  assert.equal(h[0].tekst, 'Aangemaakt vanuit de proefberekening');
  // onbekende herkomst → gewone historiek, geen vrije tekst
  r = await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Afhalen', wordt_verkocht: true, verkoopprijs: 0, herkomst: '<script>' });
  assert.equal((await vraag('GET', `/historiek/artikel/${r.data.id}`)).data[0].tekst, null);
  // de nieuwe dienst is meteen bruikbaar in de rekenmotor, vaste prijs buiten de btw-grondslag
  const b = (await vraag('POST', '/bereken', { regels: [{ type: 'artikel', artikel_id: (await vraag('GET', '/voorraad/artikelen')).data.find(a => a.naam === 'Verzending bpost').id, aantal: 1 }] })).data;
  assert.equal(b.totaal, 4.5);
  assert.equal(b.btw_grondslag, 0);
});
