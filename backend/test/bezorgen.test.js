// 18-11: digitaal ontwerp (enkel ontwerp/aanpassing): afrekenen en "gratis
// geleverd" pas nadat het bestand bezorgd is (gemaild of met de hand).
process.env.MAIL_NEP = '1';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { nepPostvak } from '../documenten/mail.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
async function upload(pad, naam, type, inhoud) {
  const fd = new FormData();
  fd.append('bestand', new Blob([inhoud], { type }), naam);
  const res = await fetch(basis + pad, { method: 'POST', body: fd });
  return { status: res.status, data: await res.json() };
}
const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
let klant, dos;

test('B1. enkel ontwerp = digitaal: eerst bezorgen, afrekenen/gratis geblokkeerd', async () => {
  klant = (await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Richard', naam: 'K', email: 'richard@voorbeeld.test' })).data.id;
  dos = (await vraag('POST', '/dossiers', { titel: 'Hydrant', klant_id: klant, regels: [{ type: 'ontwerp', omschrijving: 'Ontwerp digitaal bestand', minuten: 90 }] })).data;
  assert.equal(dos.digitaal, true);
  assert.equal(dos.acties.afrekenen, false);
  assert.equal(dos.acties.gratis, false);
  assert.equal(dos.acties.bezorgen, true);
  assert.equal(dos.acties.leveren, false, 'geen pakbon voor een bestand');
  assert.equal(dos.lever_status, null);
  await vraag('POST', `/dossiers/${dos.id}/starten`);
  const d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  assert.equal(d.volgende_stap.soort, 'bezorgen');
  const r = await vraag('POST', `/dossiers/${dos.id}/afrekenen`, { soort: 'bonnetje', nummer: '2026-1', datum: vandaag });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /digitale bestand/);
  assert.match((await vraag('POST', `/dossiers/${dos.id}/gratis`, {})).data.error, /digitale bestand/);
  assert.match((await vraag('GET', `/dossiers/${dos.id}/bonnetje/voorstel?datum=${vandaag}`)).data.error, /digitale bestand/);
});

test('B2. met de hand bezorgd → fase Geleverd, afrekenen kan; ongedaan maken', async () => {
  assert.match((await vraag('POST', `/dossiers/${dos.id}/bezorgd`, { datum: '2999-01-01' })).data.error, /toekomst/);
  let d = (await vraag('POST', `/dossiers/${dos.id}/bezorgd`, { hoe: 'via WeTransfer' })).data;
  assert.equal(d.fase, 'geleverd');
  assert.equal(d.bezorgd_op, vandaag);
  assert.equal(d.acties.afrekenen, true);
  assert.equal(d.acties.bezorgen, false);
  assert.equal(d.volgende_stap.soort, 'afrekenen');
  assert.ok(d.volgende_stap.extra.some(t => /Bestand bezorgd op .*WeTransfer/.test(t)));
  assert.match((await vraag('POST', `/dossiers/${dos.id}/bezorgd`, {})).data.error, /al bezorgd/);
  const lijst = (await vraag('GET', '/dossiers')).data.find(x => x.id === dos.id);
  assert.equal(lijst.fase, 'geleverd', 'lijst en detail gelijk');
  assert.equal(lijst.digitaal, true, 'lijst weet dat het een ontwerpdossier is (kleur)');
  d = (await vraag('POST', `/dossiers/${dos.id}/bezorgd-ongedaan`)).data;
  assert.equal(d.bezorgd_op, null);
  assert.equal(d.acties.afrekenen, false);
});

test('B3. bestand mailen: bijlagen mee, daarna bezorgd; controles', async () => {
  const stl = (await upload(`/bijlagen/dossier/${dos.id}`, 'hydrant.stl', 'application/octet-stream', Buffer.from('solid x'))).data.id;
  const step = (await upload(`/bijlagen/dossier/${dos.id}`, 'hydrant.step', 'application/octet-stream', Buffer.from('ISO-10303'))).data.id;
  assert.ok(stl && step, 'stl en step als bijlage');
  const ander = (await vraag('POST', '/dossiers', { titel: 'Ander', klant_id: klant, regels: [{ type: 'ontwerp', minuten: 10 }] })).data;
  const vreemd = (await upload(`/bijlagen/dossier/${ander.id}`, 'x.stl', 'application/octet-stream', Buffer.from('x'))).data.id;
  assert.match((await vraag('POST', `/dossiers/${dos.id}/bestand-mailen`, { aan: 'richard@voorbeeld.test', bijlagen: [] })).data.error, /minstens één/);
  assert.match((await vraag('POST', `/dossiers/${dos.id}/bestand-mailen`, { aan: 'richard@voorbeeld.test', bijlagen: [vreemd] })).data.error, /hoort niet bij/);
  assert.match((await vraag('POST', `/dossiers/${dos.id}/bestand-mailen`, { aan: 'geen-adres', bijlagen: [stl] })).data.error, /Ongeldig e-mailadres/);
  assert.equal((await vraag('GET', `/dossiers/${dos.id}`)).data.bezorgd_op, null, 'mislukt = niet bezorgd');
  const voor = nepPostvak().length;
  const r = await vraag('POST', `/dossiers/${dos.id}/bestand-mailen`, { aan: 'richard@voorbeeld.test', onderwerp: 'Je ontwerp', tekst: 'Hier is het', bijlagen: [stl, step] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = nepPostvak()[voor];
  assert.equal(m.to, 'richard@voorbeeld.test');
  assert.deepEqual(m.attachments.map(a => a.filename), ['hydrant.stl', 'hydrant.step']);
  assert.equal(r.data.fase, 'geleverd');
  assert.match(r.data.bezorgd_hoe, /gemaild naar richard@voorbeeld\.test: hydrant\.stl, hydrant\.step/);
  // opnieuw mailen mag (bv. een correctie), bezorgd blijft staan
  assert.equal((await vraag('POST', `/dossiers/${dos.id}/bestand-mailen`, { aan: 'richard@voorbeeld.test', bijlagen: [stl] })).status, 200);
  // afrekenen kan nu
  const af = await vraag('POST', `/dossiers/${dos.id}/afrekenen`, { soort: 'bonnetje', nummer: `${vandaag.slice(0, 4)}-901`, datum: vandaag });
  assert.equal(af.status, 200, JSON.stringify(af.data));
  assert.equal(af.data.acties.bezorgd_ongedaan, false, 'na afrekenen ligt bezorgd vast');
});

test('B4. met printwerk is het geen digitaal dossier: niets verandert', async () => {
  const db = getDb();
  const p = db.prepare('SELECT id FROM printers LIMIT 1').get().id;
  const d = (await vraag('POST', '/dossiers', { titel: 'Print', klant_id: klant, regels: [{ type: 'ontwerp', minuten: 30 }, { type: 'printen', printer_id: p, aantal: 1, tijd_min: 60, materialen: [] }] })).data;
  assert.equal(d.digitaal, false);
  const inLijst = (await vraag('GET', '/dossiers')).data.find(x => x.id === d.id);
  assert.equal(inLijst.digitaal, false);
  assert.equal(inLijst.heeft_ontwerp, true, 'badge ontwerp');
  assert.equal(inLijst.heeft_print, true, 'badge print');
  assert.equal(d.acties.bezorgen, false);
  assert.equal(d.acties.afrekenen, true);
  assert.match((await vraag('POST', `/dossiers/${d.id}/bezorgd`, {})).data.error, /enkel ontwerp/);
});
