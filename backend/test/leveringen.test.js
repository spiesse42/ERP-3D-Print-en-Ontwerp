// Stap 5c: leveringen in meerdere keren, voorraad FIFO, pakbon, ongedaan maken.
process.env.MAIL_NEP = '1';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && (await import('fs')).existsSync('/opt/pw-browsers/chromium')) process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { sluitBrowser, vindBrowser } from '../documenten/pdf.js';
import { nepPostvak } from '../documenten/mail.js';

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
  if ((res.headers.get('content-type') || '').includes('pdf')) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()) };
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const jaar = new Date().getFullYear();
const vandaag = new Date().toISOString().slice(0, 10);
let d, klant, hond, ring, verzending;
const voorraad = async id => (await vraag('GET', `/voorraad/artikelen/${id}`)).data.voorraad;

test('G0. voorbereiding: eigen product met voorraad, gekocht artikel, dienst', async () => {
  await vraag('PUT', '/printers/1', { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 });
  klant = (await vraag('POST', '/klanten', { type: 'particulier', naam: 'Maes', email: 'm@voorbeeld.be' })).data.id;
  hond = (await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Hondje', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 8 })).data.id;
  ring = (await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelring', wordt_gekocht: true, wordt_verkocht: true, verkoopprijs: 1 })).data.id;
  verzending = (await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Verzending', wordt_verkocht: true, verkoopprijs: 4.5, vaste_prijs: true })).data.id;
  await vraag('POST', `/voorraad/artikelen/${hond}/boeking`, { richting: 'in', aantal: 5, prijs: 2, reden: 'productie' });
  await vraag('POST', `/voorraad/artikelen/${ring}/boeking`, { richting: 'in', aantal: 2, prijs: 0.3, reden: 'ontvangst' });
  assert.equal(await voorraad(hond), 5);
  d = (await vraag('POST', '/dossiers', { titel: 'Hondjes', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Naamplaatje', printer_id: 1, aantal: 3, tijd_min: 60 },
    { type: 'artikel', artikel_id: hond, aantal: 4 },
    { type: 'artikel', artikel_id: ring, aantal: 3 },
    { type: 'artikel', artikel_id: verzending, aantal: 1 },
    { type: 'ontwerp', minuten: 15 }] })).data;
  assert.deepEqual(d.leverbaar.map(x => x.omschrijving), ['Naamplaatje', 'Hondje', 'Sleutelring'], 'geen dienst, geen ontwerp');
  assert.equal(d.lever_status, 'geen');
  assert.ok(d.stappen.includes('geleverd'));
});

test('G1. eerste levering: deels, voorraad FIFO eraf, pakbon PB-…-001', async () => {
  const [np, h, rg] = d.leverbaar;
  let r = await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: vandaag, regels: [{ regel_id: rg.regel_id, aantal: 3 }] });
  assert.match(r.data.error, /Sleutelring: Onvoldoende voorraad: 2 beschikbaar/);
  assert.equal(await voorraad(ring), 2, 'niets geboekt bij een fout');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM leveringen').get().n, 0, 'transactie teruggedraaid');
  r = await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: vandaag, regels: [{ regel_id: np.regel_id, aantal: 5 }] });
  assert.match(r.data.error, /nog 3 te leveren/);
  assert.match((await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: vandaag, regels: [] })).data.error, /minstens één regel/);
  r = await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: vandaag, opmerking: 'Rest volgt', regels: [
    { regel_id: np.regel_id, aantal: 2 }, { regel_id: h.regel_id, aantal: '4' }, { regel_id: rg.regel_id, aantal: '' }] });
  assert.equal(r.status, 201);
  d = r.data;
  assert.equal(d.leveringen[0].nummer, `PB-${jaar}-001`);
  assert.equal(d.fase, 'deels');
  assert.equal(await voorraad(hond), 1);
  const m = getDb().prepare(`SELECT * FROM voorraad_mutaties WHERE artikel_id = ? AND reden = 'levering'`).all(hond);
  assert.equal(m.length, 1); assert.equal(m[0].aantal, -4); assert.equal(m[0].bron_type, 'levering_regel');
  assert.deepEqual(d.leverbaar.map(x => x.rest), [1, 0, 3]);
});

test('G2. geleverde regels beschermd; annuleren/verwijderen geweigerd', async () => {
  const zonderHond = d.regels.filter(x => x.artikel_id !== hond).map(({ werkelijk: _w, ...x }) => x);
  let r = await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Hondjes', regels: zonderHond });
  assert.match(r.data.error, /al \(deels\) geleverd en kan niet weg/);
  const minder = d.regels.map(({ werkelijk: _w, ...x }) => (x.type === 'printen' ? { ...x, aantal: 1 } : x));
  r = await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Hondjes', regels: minder });
  assert.match(r.data.error, /al 2 stuks geleverd/);
  const meer = d.regels.map(({ werkelijk: _w, ...x }) => (x.type === 'printen' ? { ...x, aantal: 4 } : x));
  r = await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Hondjes', regels: meer });
  assert.equal(r.status, 200, 'meer bestellen mag');
  d = r.data;
  assert.match((await vraag('POST', `/dossiers/${d.id}/annuleren`)).data.error, /leveringen ongedaan/);
  assert.match((await vraag('DELETE', `/dossiers/${d.id}`)).data.error, /al geleverd/);
});

test('G3. tweede levering → geleverd; afrekenen daarna; levering ook na afrekenen', async () => {
  await vraag('POST', `/voorraad/artikelen/${ring}/boeking`, { richting: 'in', aantal: 1, prijs: 0.3, reden: 'ontvangst' });
  const rest = d.leverbaar.filter(x => x.rest > 0).map(x => ({ regel_id: x.regel_id, aantal: x.rest }));
  d = (await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: vandaag, regels: rest })).data;
  assert.equal(d.fase, 'geleverd');
  assert.equal(d.acties.leveren, false);
  assert.equal(await voorraad(ring), 0);
  assert.equal((await vraag('GET', '/dossiers')).data.find(x => x.id === d.id).fase, 'geleverd');
  const l = (await vraag('GET', '/leveringen')).data;
  assert.equal(l.length, 2);
  assert.equal(l[0].klant, 'Maes');
});

test('G4. pakbon PDF + mail', { skip: !vindBrowser() && 'geen Chromium' }, async () => {
  const eerste = d.leveringen[0];
  const r = await vraag('GET', `/leveringen/${eerste.id}/pdf`);
  assert.equal(r.pdf.subarray(0, 5).toString(), '%PDF-');
  const m = await vraag('POST', `/leveringen/${eerste.id}/mail`, { aan: 'm@voorbeeld.be' });
  assert.equal(m.status, 200);
  assert.equal(nepPostvak().at(-1).attachments[0].filename, `Pakbon PB-${jaar}-001.pdf`);
});

test('G5. enkel de laatste levering ongedaan; voorraad terug op dezelfde partijen', async () => {
  const [eerste, tweede] = d.leveringen;
  assert.match((await vraag('DELETE', `/leveringen/${eerste.id}`)).data.error, /Enkel de laatste/);
  d = (await vraag('DELETE', `/leveringen/${tweede.id}`)).data;
  assert.equal(d.fase, 'deels');
  assert.equal(await voorraad(ring), 3, 'alle 3 sleutelringen terug');
  const corr = getDb().prepare(`SELECT * FROM voorraad_mutaties WHERE artikel_id = ? AND reden = 'correctie'`).all(ring);
  assert.deepEqual(corr.map(c => c.aantal), [2, 1], 'terug op dezelfde twee partijen (FIFO: 2 + 1)');
  const partijen = getDb().prepare('SELECT aantal_resterend FROM voorraad_partijen WHERE artikel_id = ? ORDER BY id').all(ring).map(p => p.aantal_resterend);
  assert.deepEqual(partijen, [2, 1]);
  d = (await vraag('DELETE', `/leveringen/${eerste.id}`)).data;
  assert.equal(d.fase, 'nieuw');
  assert.equal(await voorraad(hond), 5);
  // nieuwe levering krijgt een nieuw nummer (niet hergebruikt)
  const h = d.leverbaar.find(x => x.omschrijving === 'Hondje');
  d = (await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: vandaag, regels: [{ regel_id: h.regel_id, aantal: 1 }] })).data;
  assert.equal(d.leveringen[0].nummer, `PB-${jaar}-00${getDb().prepare(`SELECT laatste FROM nummering WHERE reeks = 'PB'`).get().laatste}`);
  assert.notEqual(d.leveringen[0].nummer, `PB-${jaar}-001`);
  // eigen product: geen levering
  const e = (await vraag('POST', '/dossiers', { titel: 'Eigen', soort: 'eigen', regels: [{ type: 'artikel', artikel_id: hond, aantal: 1 }] })).data;
  assert.match((await vraag('POST', `/dossiers/${e.id}/leveringen`, { datum: vandaag, regels: [] })).data.error, /Enkel een klantopdracht/);
});
