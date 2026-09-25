// Automatische flow (25-09): knop Starten (werkbon + printopdrachten),
// offerte aanvaard = starten, printopdrachten volgen de regels, extra
// opdracht als er al geprint wordt, melding bij te veel, afrekenen zonder
// werkbon.
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
const jaar = new Date().getFullYear();
let mini, a1, pg, klant;
let runKlok = Date.now() - 50 * 3600e3;
// een afgelopen run (met de hand) koppelen aan een opdracht
async function run(printerId, opdrachtId, uitkomst = 'klaar') {
  const van = new Date(runKlok).toISOString(); runKlok += 3600e3;
  const tot = new Date(runKlok).toISOString(); runKlok += 60e3;
  const r = await vraag('POST', '/productie/runs', { printer_id: printerId, gestart_op: van, geeindigd_op: tot, uitkomst, kwh: 0.1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const k = await vraag('POST', `/productie/runs/${r.data.id}/koppel`, { printopdracht_id: opdrachtId });
  assert.equal(k.status, 200, JSON.stringify(k.data));
}
const opslaan = (d, regels) => vraag('PUT', `/dossiers/${d.id}`, { soort: d.soort, klant_id: d.klant_id, titel: d.titel, regels });
const zonderLees = regels => regels.map(({ werkelijk: _w, gemeten: _g, ...x }) => x);
const ops = d => d.productie.regels.flatMap(x => x.opdrachten).filter(o => o.status !== 'geannuleerd');

test('X0. voorbereiding', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  a1 = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1'`).get().id;
  await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 95 });
  pg = (await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 })).data.id;
  klant = (await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Sofie', naam: 'Maes' })).data.id;
  assert.equal(db.pragma('user_version', { simple: true }), 12);
});

let dos;
test('X1. Starten: werkbon + printopdracht per printregel met printer; eenmalig', async () => {
  dos = (await vraag('POST', '/dossiers', { titel: 'Sleutelhangers', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Sleutelhanger', printer_id: mini, aantal: 4, tijd_min: 60, materialen: [{ filament_type_id: pg, gram: 10 }] },
    { type: 'printen', omschrijving: 'Doosje', aantal: 1, tijd_min: 30, materialen: [{ filament_type_id: pg, gram: 20 }] },
    { type: 'ontwerp', minuten: 30 }] })).data;
  assert.equal(dos.acties.starten, true);
  assert.equal(dos.werkbon, null);
  let d = (await vraag('POST', `/dossiers/${dos.id}/starten`)).data;
  assert.ok(d.gestart_op);
  assert.equal(d.acties.starten, false);
  assert.equal(d.werkbon.nummer, `WB-${jaar}-0001`);
  assert.equal(d.fase, 'productie');
  const [sh, doos] = d.productie.regels;
  assert.equal(sh.opdrachten.length, 1);
  assert.equal(sh.opdrachten[0].aantal, 4); assert.equal(sh.opdrachten[0].naam, 'Sleutelhanger'); assert.equal(sh.opdrachten[0].printer_id, mini);
  assert.equal(doos.opdrachten.length, 0, 'geen printer → geen opdracht');
  assert.equal(doos.te_plannen, 1);
  assert.match((await vraag('POST', `/dossiers/${dos.id}/starten`)).data.error, /al gestart/);
  const h = (await vraag('GET', `/historiek/dossier/${dos.id}`)).data.map(x => x.tekst);
  assert.ok(h.some(t => /Uitvoering gestart/.test(t)));
  assert.ok(h.some(t => /Werkbon WB-\d+-0001 aangemaakt \(Starten\)/.test(t)));
  dos = d;
});

test('X2. opdrachten volgen de regel: aantal, printer, naam; printer kiezen maakt de ontbrekende', async () => {
  let regels = zonderLees(dos.regels);
  regels[0] = { ...regels[0], aantal: 6, omschrijving: 'Sleutelhanger blauw', printer_id: a1 };
  regels[1] = { ...regels[1], printer_id: mini };
  let d = (await opslaan(dos, regels)).data;
  const [sh, doos] = d.productie.regels;
  assert.equal(sh.opdrachten.length, 1);
  assert.equal(sh.opdrachten[0].aantal, 6);
  assert.equal(sh.opdrachten[0].printer_id, a1);
  assert.equal(sh.opdrachten[0].naam, 'Sleutelhanger blauw');
  assert.equal(doos.opdrachten.length, 1, 'printer gekozen → opdracht aangemaakt');
  assert.equal(doos.te_plannen, 0);
  // zelf een andere naam en printer gegeven → die blijven bij een volgende wijziging van de regel
  await vraag('PUT', `/productie/opdrachten/${sh.opdrachten[0].id}`, { naam: 'SH eigen naam', printer_id: mini });
  regels = zonderLees(d.regels);
  regels[0] = { ...regels[0], aantal: 5, omschrijving: 'Sleutelhanger groen', printer_id: a1 };
  d = (await opslaan(d, regels)).data;
  const o = d.productie.regels[0].opdrachten[0];
  assert.equal(o.naam, 'SH eigen naam'); assert.equal(o.printer_id, mini); assert.equal(o.aantal, 5);
  dos = d;
});

test('X3. geplande opdracht volgt de regel: niet los annuleren of verwijderen', async () => {
  const o = dos.productie.regels[1].opdrachten[0];
  assert.match((await vraag('POST', `/productie/opdrachten/${o.id}/annuleer`)).data.error, /volgt de regel/);
  assert.match((await vraag('DELETE', `/productie/opdrachten/${o.id}`)).data.error, /volgt de regel/);
});

test('X4. zelf splitsen: nieuwe opdracht voor een deel → de andere wordt kleiner', async () => {
  const r = await vraag('POST', '/productie/opdrachten', { printer_id: a1, dossier_regel_id: dos.regels[0].id, aantal: 2 });
  assert.equal(r.status, 201);
  const d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  const aantallen = d.productie.regels[0].opdrachten.map(o => [o.printer_id, o.aantal]);
  assert.deepEqual(aantallen.sort(), [[a1, 2], [mini, 3]].sort());
  dos = d;
});

test('X5. meer nodig terwijl er al geprint wordt → extra opdracht; te veel → melding', async () => {
  // doosje (1 stuk) printen en bevestigen
  const doos = dos.productie.regels[1].opdrachten[0];
  await run(mini, doos.id);
  await vraag('POST', `/productie/opdrachten/${doos.id}/bevestig`, { aantal_goed: 1 });
  let regels = zonderLees(dos.regels);
  regels[1] = { ...regels[1], aantal: 3 };
  let d = (await opslaan(dos, regels)).data;
  let x = d.productie.regels[1];
  assert.equal(x.opdrachten.length, 2, 'extra opdracht');
  assert.equal(x.opdrachten.find(o => o.status === 'gepland').aantal, 2);
  const h = (await vraag('GET', `/historiek/dossier/${dos.id}`)).data.map(y => y.tekst);
  assert.ok(h.some(t => /Automatisch: extra printopdracht voor 2 stuks van "Doosje"/.test(t)));
  // zelf nog een opdracht bij terwijl alles al gedekt is → geweigerd
  regels = zonderLees(d.regels); regels[1] = { ...regels[1], aantal: 1 };
  d = (await opslaan(d, regels)).data;
  assert.match((await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: d.regels[1].id, aantal: 1 })).data.error, /al genoeg/);
  regels = zonderLees(d.regels); regels[1] = { ...regels[1], aantal: 1 };
  d = (await opslaan(d, regels)).data;
  x = d.productie.regels[1];
  assert.equal(x.opdrachten.length, 1); assert.equal(x.te_veel, 0);
  // minder dan geprint → enkel een melding
  regels = zonderLees(d.regels); regels[1] = { ...regels[1], aantal: 0.5 };
  d = (await opslaan(d, regels)).data;
  assert.equal(d.productie.regels[1].te_veel, 0.5);
  regels = zonderLees(d.regels); regels[1] = { ...regels[1], aantal: 1 };
  dos = (await opslaan(d, regels)).data;
});

test('X6. minder goede stuks bevestigd → tekort erbij gepland; heropenen zet het terug', async () => {
  const x = dos.productie.regels[0];
  const o = x.opdrachten.find(y => y.aantal === 3);
  await run(mini, o.id);
  await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 2 });
  let d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  const open = d.productie.regels[0].opdrachten.filter(y => y.status === 'gepland');
  assert.deepEqual(open.map(y => y.aantal), [3], 'tekort van 1 → de geplande opdracht wordt groter');
  await vraag('POST', `/productie/opdrachten/${o.id}/heropen`);
  d = (await vraag('GET', `/dossiers/${dos.id}`)).data;
  assert.deepEqual(d.productie.regels[0].opdrachten.filter(y => y.status === 'gepland').map(y => y.aantal), [2], 'terug naar 2');
  await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 3 });
  dos = (await vraag('GET', `/dossiers/${dos.id}`)).data;
});

test('X7. regel weg / ander type: geplande opdrachten mee weg, geprinte blokkeren', async () => {
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Twee', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'A', printer_id: mini, aantal: 1, tijd_min: 10, materialen: [{ filament_type_id: pg, gram: 5 }] },
    { type: 'printen', omschrijving: 'B', printer_id: mini, aantal: 1, tijd_min: 10, materialen: [{ filament_type_id: pg, gram: 5 }] }] })).data;
  let d = (await vraag('POST', `/dossiers/${d0.id}/starten`)).data;
  assert.equal(d.productie.aantal_opdrachten, 2);
  const [a, b] = zonderLees(d.regels);
  let r = await opslaan(d, [a, { ...b, type: 'ontwerp', minuten: 10, materialen: [] }]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.productie.aantal_opdrachten, 1);
  d = r.data;
  await run(mini, d.productie.regels[0].opdrachten[0].id);
  r = await opslaan(d, zonderLees(d.regels).filter(x => x.type !== 'printen'));
  assert.match(r.data.error, /al \(deels\) geprint en kan niet weg/);
  r = await opslaan(d, []);
  assert.equal(r.status, 400);
});

test('X8. offerte aanvaard = starten; ontwerp-only klantopdracht → enkel werkbon', async () => {
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Logo', klant_id: klant, regels: [{ type: 'ontwerp', minuten: 60 }] })).data;
  assert.equal(d0.acties.starten, true);
  let d = (await vraag('POST', `/dossiers/${d0.id}/offertes`)).data;
  d = (await vraag('POST', `/offertes/${d.offertes[0].id}/versturen`)).data;
  assert.equal(d.werkbon, null, 'verstuurd: nog niets gestart');
  d = (await vraag('POST', `/offertes/${d.offertes[0].id}/aanvaard`)).data;
  assert.ok(d.gestart_op); assert.ok(d.werkbon); assert.equal(d.fase, 'akkoord', 'geen printregels → blijft akkoord');
  assert.equal(d.acties.starten, false);
});

test('X9. eigen product: enkel printopdrachten (soort eigen), geen werkbon; zonder printregels niets te starten', async () => {
  const art = (await vraag('POST', '/artikelen', { type: 'artikel', naam: 'Draakje', zelf_geprint: true, verkoopprijs: 12 })).data;
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Draakjes', soort: 'eigen', regels: [
    { type: 'printen', omschrijving: 'Draakje', printer_id: mini, aantal: 5, tijd_min: 30, artikel_id: art.id, materialen: [{ filament_type_id: pg, gram: 15 }] }] })).data;
  const d = (await vraag('POST', `/dossiers/${d0.id}/starten`)).data;
  assert.equal(d.werkbon, null);
  assert.equal(d.productie.regels[0].opdrachten[0].soort, 'eigen');
  assert.equal(d.productie.regels[0].opdrachten[0].aantal, 5);
  const leeg = (await vraag('POST', '/dossiers', { titel: 'Leeg eigen', soort: 'eigen', regels: [{ type: 'extra', bedrag: 1 }] })).data;
  assert.equal(leeg.acties.starten, false);
  assert.match((await vraag('POST', `/dossiers/${leeg.id}/starten`)).data.error, /geen printregels/);
});

test('X10. annuleren en heropenen: opdrachten weer gepland', async () => {
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Annuleren', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'C', printer_id: mini, aantal: 2, tijd_min: 10, materialen: [{ filament_type_id: pg, gram: 5 }] }] })).data;
  await vraag('POST', `/dossiers/${d0.id}/starten`);
  let d = (await vraag('POST', `/dossiers/${d0.id}/annuleren`)).data;
  assert.equal(ops(d).length, 0);
  d = (await vraag('POST', `/dossiers/${d0.id}/heropenen`)).data;
  assert.equal(ops(d).length, 1);
  assert.equal(ops(d)[0].aantal, 2);
});

test('X11. niet gestart dossier: niets automatisch (zoals voorheen)', async () => {
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Manueel', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'D', printer_id: mini, aantal: 2, tijd_min: 10, materialen: [{ filament_type_id: pg, gram: 5 }] }] })).data;
  const o = (await vraag('POST', '/productie/opdrachten', { printer_id: mini, dossier_regel_id: d0.regels[0].id, aantal: 1 })).data;
  let d = (await vraag('GET', `/dossiers/${d0.id}`)).data;
  assert.equal(ops(d).length, 1); assert.equal(ops(d)[0].aantal, 1, 'geen aanvulling');
  assert.equal((await vraag('DELETE', `/productie/opdrachten/${o.id}`)).status, 200, 'los verwijderen mag');
  // werkbon niet berekenbaar → afrekenen geweigerd, en geen werkbon achtergelaten
  await vraag('PUT', `/printers/${a1}`, { naam: 'Bambu Lab A1', machine_per_uur: null });
  const d1 = (await vraag('POST', '/dossiers', { titel: 'Onvolledig', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'E', printer_id: a1, aantal: 1, tijd_min: 10, materialen: [{ filament_type_id: pg, gram: 5 }] }] })).data;
  assert.match((await vraag('POST', `/dossiers/${d1.id}/afrekenen`, { soort: 'bonnetje', nummer: 'B-8', datum: new Date().toISOString().slice(0, 10) })).data.error, /werkbon kunnen berekend/);
  assert.equal((await vraag('GET', `/dossiers/${d1.id}`)).data.werkbon, null);
  d = (await vraag('POST', `/dossiers/${d0.id}/afrekenen`, { soort: 'bonnetje', nummer: 'B-9', datum: new Date().toISOString().slice(0, 10) })).data;
  assert.equal(d.fase, 'betaald', JSON.stringify(d));
  assert.ok(d.werkbon.definitief_op);
});

test('X12. te koppelen runs in het dossier: enkel printers van open opdrachten, laatste 48 u, voorstel = opdracht van het dossier', async () => {
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Bluey', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Bluey', printer_id: a1, aantal: 1, tijd_min: 60, materialen: [{ filament_type_id: pg, gram: 20 }] }] })).data;
  let d = (await vraag('POST', `/dossiers/${d0.id}/starten`)).data;
  const o = d.productie.regels[0].opdrachten[0];
  const nieuweRun = async (printer, urenGeleden) => (await vraag('POST', '/productie/runs', { printer_id: printer,
    gestart_op: new Date(Date.now() - urenGeleden * 3600e3).toISOString(), geeindigd_op: new Date(Date.now() - (urenGeleden - 0.5) * 3600e3).toISOString(), uitkomst: 'klaar', kwh: 0.1 })).data;
  const juist = await nieuweRun(a1, 3);
  await nieuweRun(a1, 60);                 // te oud
  await nieuweRun(mini, 2);                // andere printer
  const intern = await nieuweRun(a1, 5);
  await vraag('POST', `/productie/runs/${intern.id}/koppel`, { intern: 'test' });
  d = (await vraag('GET', `/dossiers/${d0.id}`)).data;
  assert.deepEqual(d.productie.te_koppelen_runs.map(r => r.id), [juist.id]);
  assert.equal(d.productie.te_koppelen_runs[0].voorstel.id, o.id);
  await vraag('POST', `/productie/runs/${juist.id}/koppel`, { printopdracht_id: o.id });
  d = (await vraag('GET', `/dossiers/${d0.id}`)).data;
  assert.equal(d.productie.te_koppelen_runs.length, 0);
});
