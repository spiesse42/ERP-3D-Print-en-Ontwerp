// 17-11: offerte met de printregels als één regel en een pagina "Beelden"
// met foto's uit de bijlagen van het dossier (dossier Sainte Geneviève).
if (!process.env.PUPPETEER_EXECUTABLE_PATH && (await import('fs')).existsSync('/opt/pw-browsers/chromium')) process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { sluitBrowser, vindBrowser } from '../documenten/pdf.js';
import { documentHtml } from '../documenten/sjabloon.js';
import { printregelsInhoud } from '../domein/documenten.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); sluitDb(); await sluitBrowser(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  if (type.includes('pdf')) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()) };
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
// 1×1 png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function upload(pad, naam, type, inhoud) {
  const fd = new FormData();
  fd.append('bestand', new Blob([inhoud], { type }), naam);
  const res = await fetch(basis + pad, { method: 'POST', body: fd });
  return { status: res.status, data: await res.json() };
}

let dos, o, foto, pdfBijlage;
test('O1. voorbereiding: beeld in 3 delen + ontwerp + afwerking', async () => {
  const db = getDb();
  const a1 = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  await vraag('PUT', `/printers/${a1}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 });
  const pg = (await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 })).data.id;
  const klant = (await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'Gemeente', email: 'info@gemeente.test' })).data.id;
  const deel = n => ({ type: 'printen', omschrijving: `Deel ${n}`, printer_id: a1, aantal: 1, tijd_min: 600, materialen: [{ filament_type_id: pg, gram: 400 }] });
  dos = (await vraag('POST', '/dossiers', { titel: 'Sainte Geneviève', klant_id: klant, regels: [
    { type: 'ontwerp', minuten: 60 }, deel(1), deel(2), deel(3), { type: 'extra', omschrijving: 'Afwerking', bedrag: 50 }] })).data;
  o = (await vraag('POST', `/dossiers/${dos.id}/offertes`)).data.offertes[0];
  foto = (await upload(`/bijlagen/dossier/${dos.id}`, 'beeld.png', 'image/png', PNG)).data.id;
  pdfBijlage = (await upload(`/bijlagen/dossier/${dos.id}`, 'plan.pdf', 'application/pdf', Buffer.from('%PDF-1.4'))).data.id;
  assert.ok(foto && pdfBijlage);
});

test('O2. printregels samenvoegen: één regel op de plaats van de eerste, totaal gelijk', () => {
  const inhoud = { regels: [
    { omschrijving: 'Ontwerp', aantal: 1, per_stuk: 35, bedrag: 35, soort: 'ontwerp' },
    { omschrijving: 'Deel 1', aantal: 1, per_stuk: 54.81, bedrag: 54.81, soort: 'printen', afbeelding: 'x' },
    { omschrijving: 'Deel 2', aantal: 1, per_stuk: 31.25, bedrag: 31.25, soort: 'printen' },
    { omschrijving: 'Afwerking', aantal: 1, per_stuk: 50, bedrag: 50, soort: 'extra' },
    { omschrijving: 'Deel 3', aantal: 1, per_stuk: 32.62, bedrag: 32.62, soort: 'printen' }], totaal: 203.68 };
  const een = printregelsInhoud(inhoud, 'Beeld Sainte Geneviève, 3 delen');
  assert.deepEqual(een.regels.map(r => r.omschrijving), ['Ontwerp', 'Beeld Sainte Geneviève, 3 delen', 'Afwerking']);
  assert.equal(een.regels[1].bedrag, 118.68);
  assert.equal(een.regels[1].afbeelding, null);
  assert.equal(een.totaal, 203.68);
  assert.equal(inhoud.regels.length, 5, 'origineel ongewijzigd');
  assert.equal(printregelsInhoud(inhoud, '  '), inhoud, 'lege omschrijving: niets samenvoegen');
  // oude momentopname zonder soort: niets samenvoegen
  const oud = { regels: [{ omschrijving: 'x', bedrag: 1 }], totaal: 1 };
  assert.equal(printregelsInhoud(oud, 'y').regels[0].omschrijving, 'x');
});

test("O3. offerte bewaren: één regel + foto's, controles, mee naar een nieuwe versie", async () => {
  let r = await vraag('PUT', `/offertes/${o.id}`, { geldig_tot: o.geldig_tot, een_regel: 'Beeld, 3 delen', fotos: [foto] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let x = r.data.offertes[0];
  assert.equal(x.een_regel, 'Beeld, 3 delen');
  assert.deepEqual(x.fotos, [foto]);
  assert.match((await vraag('PUT', `/offertes/${o.id}`, { fotos: [pdfBijlage] })).data.error, /jpg, png of webp/);
  assert.match((await vraag('PUT', `/offertes/${o.id}`, { fotos: [999999] })).data.error, /hoort niet bij dit dossier/);
  assert.match((await vraag('PUT', `/offertes/${o.id}`, { een_regel: 'x'.repeat(201) })).data.error, /te lang/);
  // velden die ontbreken blijven staan (bv. enkel de levertermijn aanpassen)
  x = (await vraag('PUT', `/offertes/${o.id}`, { geldig_tot: o.geldig_tot, levertermijn: 'ca. 3 weken' })).data.offertes[0];
  assert.equal(x.een_regel, 'Beeld, 3 delen');
  assert.deepEqual(x.fotos, [foto]);
  // versturen bevriest; de nieuwe versie neemt de keuzes over
  const vs = await vraag('POST', `/offertes/${o.id}/versturen`);
  assert.equal(vs.status, 200, JSON.stringify(vs.data));
  const d = (await vraag('POST', `/dossiers/${dos.id}/offertes`)).data;
  const v2 = d.offertes.find(y => y.versie === 2);
  assert.equal(v2.een_regel, 'Beeld, 3 delen');
  assert.deepEqual(v2.fotos, [foto]);
  r = await vraag('PUT', `/offertes/${v2.id}`, { een_regel: '', fotos: [] });
  assert.equal(r.data.offertes.find(y => y.versie === 2).een_regel, null);
  assert.deepEqual(r.data.offertes.find(y => y.versie === 2).fotos, []);
  await vraag('PUT', `/offertes/${v2.id}`, { een_regel: 'Beeld, 3 delen', fotos: [foto] });
});

test('O4. sjabloon: neutrale opmerking met titel, pagina "Beelden", slot bij elkaar', () => {
  const inhoud = { bedrijf: { naam: 'X' }, klant: null, dossier: { titel: 'T' }, regels: [], totaal: 10, vast: 0 };
  const html = documentHtml({ soort: 'OFFERTE', nummer: 'OFF-1', datum: '2026-11-17', inhoud, opmerking: 'Let op <b>', opmerkingTitel: 'Opmerkingen en voorwaarden', fotos: ['data:image/png;base64,AAA'] });
  assert.match(html, /class="opmerking neutraal"><h3>Opmerkingen en voorwaarden<\/h3>Let op &lt;b&gt;/);
  assert.match(html, /<div class="beelden"><h2>Beelden<\/h2><div class="beelden-grid een"><div class="beeld"><img src="data:image\/png;base64,AAA"/);
  assert.match(html, /<div class="slot">[\s\S]*<div class="footer">/);
  const zonder = documentHtml({ soort: 'WERKBON', nummer: 'W', datum: '2026-11-17', inhoud, opmerking: 'intern' });
  assert.match(zonder, /<div class="opmerking">intern/);
  assert.doesNotMatch(zonder, /<div class="beelden">/);
});

test('O5. PDF: één regel en de foto-pagina', { skip: !vindBrowser() && 'geen Chromium in deze omgeving' }, async () => {
  const v2 = getDb().prepare('SELECT id FROM offertes WHERE dossier_id = ? AND versie = 2').get(dos.id).id;
  const r = await vraag('GET', `/offertes/${v2}/pdf`);
  assert.equal(r.status, 200);
  const paginas = (r.pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(paginas, 2, 'offerte + pagina Beelden');
});
