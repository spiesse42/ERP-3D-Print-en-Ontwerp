// Stap 5b: offertes (versies, bevriezen, aanvaard/geweigerd/verlopen), werkbon
// (werkelijk verbruik, definitief bij afrekenen), PDF en mail.
process.env.MAIL_NEP = '1';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && (await import('fs')).existsSync('/opt/pw-browsers/chromium')) process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { nepPostvak } from '../documenten/mail.js';
import { sluitBrowser, vindBrowser } from '../documenten/pdf.js';
import { documentHtml } from '../documenten/sjabloon.js';

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
  if (type.includes('pdf')) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const jaar = new Date().getFullYear();
const vandaag = new Date().toISOString().slice(0, 10);
let klant, dos, mini, pg;

test('F0. voorbereiding', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 });
  pg = (await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 })).data.id;
  klant = (await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Sofie', naam: 'Maes', email: 'sofie@voorbeeld.be' })).data.id;
  await vraag('PUT', '/instellingen', { bedrijf_naam: '3Dplezier <test>', offerte_geldig_dagen: '14' });
  dos = (await vraag('POST', '/dossiers', { titel: 'Naamplaatje', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Naamplaatje', printer_id: mini, aantal: 2, tijd_min: 120, materialen: [{ filament_type_id: pg, gram: 40 }] },
    { type: 'ontwerp', minuten: 30 }] })).data;
});

test('F1. offerte: concept volgt de regels, versturen bevriest', async () => {
  let d = (await vraag('POST', `/dossiers/${dos.id}/offertes`)).data;
  const o = d.offertes[0];
  assert.equal(o.nummer, `OFF-${jaar}-001`);
  assert.equal(o.status, 'concept');
  const verwachtGeldig = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  assert.equal(o.geldig_tot, verwachtGeldig, 'standaard geldigheid uit de instellingen (14 dagen)');
  assert.equal((await vraag('POST', `/dossiers/${dos.id}/offertes`)).status, 400, 'maar één concept tegelijk');
  await vraag('PUT', `/offertes/${o.id}`, { geldig_tot: o.geldig_tot, levertermijn: '1 week', opmerking: 'Kleur naar keuze' });
  d = (await vraag('POST', `/offertes/${o.id}/versturen`)).data;
  assert.equal(d.fase, 'offerte');
  assert.equal(d.offertes[0].status, 'verstuurd');
  const bevroren = d.offertes[0].totaal;
  assert.equal(bevroren, d.berekening.totaal);
  // dossier wijzigen: de verstuurde offerte blijft zoals ze was
  const regels = d.regels.map(x => (x.type === 'ontwerp' ? { ...x, minuten: 90 } : x));
  d = (await vraag('PUT', `/dossiers/${dos.id}`, { soort: 'klant', klant_id: klant, titel: 'Naamplaatje', regels })).data;
  assert.ok(d.berekening.totaal > bevroren);
  assert.equal(d.offertes[0].totaal, bevroren);
  assert.equal((await vraag('PUT', `/offertes/${o.id}`, { levertermijn: 'x' })).status, 400, 'verstuurd = vast');
  assert.equal((await vraag('DELETE', `/offertes/${o.id}`)).status, 400);
  // verwijderen van het dossier kan niet meer
  assert.match((await vraag('DELETE', `/dossiers/${dos.id}`)).data.error, /offerte verstuurd/);
});

test('F2. nieuwe versie: zelfde nummer v2, vorige = vervangen; aanvaard → akkoord', async () => {
  let d = (await vraag('POST', `/dossiers/${dos.id}/offertes`)).data;
  const v2 = d.offertes.find(o => o.versie === 2);
  assert.equal(v2.weergave, `OFF-${jaar}-001 v2`);
  assert.equal(v2.levertermijn, '1 week', 'overgenomen van de vorige versie');
  d = (await vraag('POST', `/offertes/${v2.id}/versturen`)).data;
  assert.equal(d.offertes.find(o => o.versie === 1).status, 'vervangen');
  const v1 = d.offertes.find(o => o.versie === 1);
  assert.match((await vraag('POST', `/offertes/${v1.id}/aanvaard`)).data.error, /nieuwere versie/);
  d = (await vraag('POST', `/offertes/${v2.id}/aanvaard`, { datum: vandaag })).data;
  assert.equal(d.fase, 'akkoord');
  assert.equal(d.acties.offerte, false, 'geen nieuwe versie na akkoord');
  assert.equal(d.wijkt_af_van_offerte, false);
  const h = (await vraag('GET', `/historiek/dossier/${dos.id}`)).data.map(x => x.tekst);
  assert.ok(h.some(t => /Offerte OFF-\d+-001 v2 aanvaard door de klant/.test(t)));
  // lijst: fase akkoord
  assert.equal((await vraag('GET', '/dossiers')).data.find(x => x.id === dos.id).fase, 'akkoord');
  assert.equal((await vraag('GET', '/offertes')).data.length, 2);
});

test('F3. geweigerd / verlopen / antwoord ongedaan', async () => {
  const x = (await vraag('POST', '/dossiers', { titel: 'Tweede', klant_id: klant, regels: [{ type: 'extra', bedrag: 10 }] })).data;
  let d = (await vraag('POST', `/dossiers/${x.id}/offertes`)).data;
  const o = d.offertes[0];
  assert.equal(o.nummer, `OFF-${jaar}-002`);
  d = (await vraag('POST', `/offertes/${o.id}/versturen`)).data;
  d = (await vraag('POST', `/offertes/${o.id}/geweigerd`)).data;
  assert.equal(d.offertes[0].status, 'geweigerd');
  assert.equal(d.fase, 'nieuw', 'geweigerd → terug naar nieuw');
  d = (await vraag('POST', `/offertes/${o.id}/antwoord-ongedaan`)).data;
  assert.equal(d.fase, 'offerte');
  getDb().prepare(`UPDATE offertes SET geldig_tot = '2020-01-01' WHERE id = ?`).run(o.id);
  d = (await vraag('GET', `/dossiers/${x.id}`)).data;
  assert.equal(d.offertes[0].status, 'verlopen');
  // concept met datum in het verleden kan niet verstuurd worden
  const y = (await vraag('POST', '/dossiers', { titel: 'Derde', klant_id: klant, regels: [{ type: 'extra', bedrag: 1 }] })).data;
  const oy = (await vraag('POST', `/dossiers/${y.id}/offertes`)).data.offertes[0];
  await vraag('PUT', `/offertes/${oy.id}`, { geldig_tot: '2020-01-01' });
  assert.match((await vraag('POST', `/offertes/${oy.id}/versturen`)).data.error, /verleden/);
  assert.equal((await vraag('DELETE', `/offertes/${oy.id}`)).status, 200, 'concept mag weg');
  // eigen product: geen offerte
  const e = (await vraag('POST', '/dossiers', { titel: 'Eigen', soort: 'eigen' })).data;
  assert.match((await vraag('POST', `/dossiers/${e.id}/offertes`)).data.error, /Enkel een klantopdracht/);
});

test('F4. werkbon: werkelijk verbruik, regels terugzetten, definitief bij afrekenen', async () => {
  let d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  assert.equal(d.wijkt_af_van_offerte, false);
  d = (await vraag('POST', `/dossiers/${dos.id}/werkbon`)).data;
  assert.equal(d.werkbon.nummer, `WB-${jaar}-0001`);
  assert.equal(d.werkbon.berekening.totaal, d.berekening.totaal, 'zonder werkelijke waarden = schatting');
  const pr = d.regels.find(x => x.type === 'printen');
  d = (await vraag('PUT', `/dossiers/${dos.id}/werkelijk`, { regels: [{ id: pr.id, uren: '2,5', kwh: '0,3' }] })).data;
  assert.equal(d.regels.find(x => x.id === pr.id).werkelijk.uren, 2.5);
  assert.notEqual(d.werkbon.berekening.totaal, d.berekening.totaal, 'werkelijk ≠ schatting');
  const det = d.werkbon.berekening.regels.find(x => x.type === 'printen')._berekend.detail;
  assert.equal(det.energie_bron, 'gemeten');
  assert.match((await vraag('PUT', `/dossiers/${dos.id}/werkelijk`, { regels: [{ id: pr.id, uren: -1 }] })).data.error, /≥ 0/);
  // regels opslaan laat werkelijk ongemoeid
  d = (await vraag('PUT', `/dossiers/${dos.id}`, { soort: 'klant', klant_id: klant, titel: 'Naamplaatje', regels: d.regels.map(({ werkelijk: _w, ...x }) => ({ ...x, aantal: 3 })) })).data;
  assert.equal(d.regels.find(x => x.id === pr.id).werkelijk.kwh, 0.3);
  assert.equal(d.wijkt_af_van_offerte, true);
  d = (await vraag('POST', `/dossiers/${dos.id}/regels-uit-offerte`)).data;
  assert.equal(d.wijkt_af_van_offerte, false);
  assert.equal(d.regels.find(x => x.id === pr.id).werkelijk.kwh, 0.3, 'werkelijk blijft na terugzetten');
  // Domeinmodel (bevestigd 23-09): met aanvaarde offerte blijft de offerteprijs staan;
  // de metingen dienen enkel voor de marge-analyse.
  const offerteTotaal = d.offertes.find(o => o.aanvaard_op).totaal;
  assert.equal(d.werkbon.basis, 'offerte');
  assert.equal(d.werkbon.bedrag, offerteTotaal);
  assert.notEqual(d.werkbon.berekening.totaal, offerteTotaal, 'metingen apart zichtbaar');
  d = (await vraag('POST', `/dossiers/${dos.id}/afrekenen`, { soort: 'factuur', nummer: 'F-1', datum: vandaag })).data;
  assert.equal(d.afgerekend_bedrag, offerteTotaal, 'standaardbedrag = offerteprijs');
  assert.equal(d.werkbon.definitief_op, vandaag);
  assert.equal(d.werkbon.totaal, offerteTotaal);
  assert.equal((await vraag('PUT', `/dossiers/${dos.id}/werkelijk`, { regels: [{ id: pr.id, uren: 1 }] })).status, 400);
  assert.equal((await vraag('DELETE', `/werkbonnen/${d.werkbon.id}`)).status, 400);
  d = (await vraag('POST', `/dossiers/${dos.id}/afrekening-ongedaan`)).data;
  assert.equal(d.werkbon.definitief_op, null);
  assert.equal(d.werkbon.weergave, `WB-${jaar}-0001 v2`, 'nieuwe versie na ongedaan maken');
});

test('F4b. werkbon zonder offerte rekent met de metingen', async () => {
  const x = (await vraag('POST', '/dossiers', { titel: 'Zonder offerte', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Hanger', printer_id: mini, aantal: 1, tijd_min: 60, materialen: [{ filament_type_id: pg, gram: 10 }] }] })).data;
  let d = (await vraag('POST', `/dossiers/${x.id}/werkbon`)).data;
  assert.equal(d.werkbon.basis, 'metingen');
  const pr = d.regels[0];
  d = (await vraag('PUT', `/dossiers/${x.id}/werkelijk`, { regels: [{ id: pr.id, uren: 3, kwh: 0.5 }] })).data;
  assert.equal(d.werkbon.bedrag, d.werkbon.berekening.totaal);
  assert.ok(d.werkbon.bedrag > d.berekening.totaal, 'langer geprint dan geschat → hoger bedrag');
  d = (await vraag('POST', `/dossiers/${x.id}/afrekenen`, { soort: 'bonnetje', nummer: 'B-1', datum: vandaag })).data;
  assert.equal(d.afgerekend_bedrag, d.werkbon.totaal);
});

test('F5. PDF en mail', { skip: !vindBrowser() && 'geen Chromium in deze omgeving' }, async () => {
  const d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  const v2 = d.offertes.find(o => o.versie === 2);
  let r = await vraag('GET', `/offertes/${v2.id}/pdf`);
  assert.equal(r.status, 200);
  assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(r.headers.get('content-disposition'), /Offerte OFF-\d+-001 v2\.pdf/);
  r = await vraag('GET', `/werkbonnen/${d.werkbon.id}/pdf`);
  assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-');
  // mail van een concept-offerte: eerst versturen, dan mailen
  const x = (await vraag('POST', '/dossiers', { titel: 'Mail', klant_id: klant, regels: [{ type: 'extra', bedrag: 5 }] })).data;
  const o = (await vraag('POST', `/dossiers/${x.id}/offertes`)).data.offertes[0];
  assert.match((await vraag('POST', `/offertes/${o.id}/mail`, { aan: 'geen-adres' })).data.error, /geldig e-mailadres/);
  r = await vraag('POST', `/offertes/${o.id}/mail`, { aan: 'sofie@voorbeeld.be', onderwerp: 'Uw offerte', tekst: 'Beste Sofie' });
  assert.equal(r.status, 200);
  assert.equal(r.data.offertes[0].status, 'verstuurd');
  const m = nepPostvak().at(-1);
  assert.equal(m.to, 'sofie@voorbeeld.be');
  assert.equal(m.attachments[0].filename, `Offerte OFF-${jaar}-00${o.nummer.slice(-1)}.pdf`);
  assert.ok(m.bijlage_bytes > 1000);
  assert.ok((await vraag('GET', `/historiek/dossier/${x.id}`)).data.some(h => /gemaild naar sofie@voorbeeld.be/.test(h.tekst)));
});

test('F6. sjabloon: escapen, concept-watermerk, geen aankoopfactuurnummers', () => {
  const html = documentHtml({ soort: 'OFFERTE', nummer: 'OFF-1', datum: '2026-09-25', concept: true, opmerking: '<b>vet</b>\nlijn 2',
    inhoud: { bedrijf: { naam: 'A&B' }, klant: { type: 'particulier', naam: '<script>' }, dossier: { nummer: 'D-1', titel: 'T' },
      regels: [{ omschrijving: 'x', aantal: 1, per_stuk: 1.5, bedrag: 1.5 }], totaal: 1.5, vast: 0 } });
  assert.ok(html.includes('A&amp;B') && html.includes('&lt;script&gt;') && !html.includes('<script>'));
  assert.ok(html.includes('&lt;b&gt;vet&lt;/b&gt;<br>lijn 2'));
  assert.ok(html.includes('class="concept"'));
  assert.ok(html.includes('€ 1,50'));
  assert.ok(html.includes('56bis'));
});
