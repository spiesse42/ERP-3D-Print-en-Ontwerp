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
  assert.equal(db.pragma('user_version', { simple: true }), 15);
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

test('X13. volgende stap: van regels tot afgerond', async () => {
  const stap = async id => (await vraag('GET', `/dossiers/${id}`)).data.volgende_stap;
  getDb().prepare(`UPDATE printruns SET intern = 'test' WHERE printopdracht_id IS NULL AND intern IS NULL`).run();   // restjes van vorige tests
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Stappen', klant_id: klant })).data;
  assert.equal(d0.volgende_stap.soort, 'regels');
  let r = await vraag('PUT', `/dossiers/${d0.id}`, { soort: 'klant', klant_id: klant, titel: 'Stappen', regels: [
    { type: 'printen', omschrijving: 'Hanger', printer_id: mini, aantal: 1, tijd_min: 30, materialen: [{ filament_type_id: pg, gram: 5 }] }] });
  assert.equal(r.data.volgende_stap.soort, 'starten');
  await vraag('POST', `/dossiers/${d0.id}/starten`);
  assert.equal((await stap(d0.id)).soort, 'wachtrij');
  const d = (await vraag('GET', `/dossiers/${d0.id}`)).data;
  const o = d.productie.regels[0].opdrachten[0];
  const x = (await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: new Date(Date.now() - 10 * 3600e3).toISOString(), geeindigd_op: new Date(Date.now() - 9 * 3600e3).toISOString(), uitkomst: 'klaar', kwh: 0.1 })).data;
  let s = await stap(d0.id);
  assert.equal(s.soort, 'koppelen'); assert.equal(s.run.id, x.id); assert.equal(s.run.voorstel.id, o.id);
  await vraag('POST', `/productie/runs/${x.id}/koppel`, { printopdracht_id: o.id });
  s = await stap(d0.id);
  assert.equal(s.soort, 'bevestigen'); assert.equal(s.opdracht_id, o.id);
  await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 1 });
  s = await stap(d0.id);
  assert.equal(s.soort, 'afrekenen'); assert.equal(s.kan, true); assert.match(s.tekst, /Alles is geprint/);
  assert.ok(s.extra.some(t => /Dossier annuleren/.test(t)));
  await vraag('POST', `/dossiers/${d0.id}/afrekenen`, { soort: 'factuur', nummer: 'F-77', datum: new Date().toISOString().slice(0, 10) });
  assert.equal((await stap(d0.id)).soort, 'betaling');
  await vraag('POST', `/dossiers/${d0.id}/betaald`, { datum: new Date().toISOString().slice(0, 10) });
  assert.equal((await stap(d0.id)).soort, 'afgerond');
  // offerte verstuurd → wachten op de klant; geannuleerd
  const e = (await vraag('POST', '/dossiers', { titel: 'Offerte', klant_id: klant, regels: [{ type: 'ontwerp', minuten: 30 }] })).data;
  let od = (await vraag('POST', `/dossiers/${e.id}/offertes`)).data;
  od = (await vraag('POST', `/offertes/${od.offertes[0].id}/versturen`)).data;
  assert.equal(od.volgende_stap.soort, 'offerte_wacht');
  assert.equal((await vraag('POST', `/dossiers/${e.id}/annuleren`)).data.volgende_stap.soort, 'geannuleerd');
});

test('X14. gratis geleverd: geen omzet, werkbon definitief, kost in Marges, ongedaan maken', async () => {
  getDb().prepare(`UPDATE printruns SET intern = 'test' WHERE printopdracht_id IS NULL AND intern IS NULL`).run();
  const jaar = new Date().getFullYear();
  const vandaag = new Date().toISOString().slice(0, 10);
  const omzetVoor = (await vraag('GET', `/financien/overzicht?jaar=${jaar}`)).data.totaal.omzet;
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Voetjes', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Voetjes', printer_id: mini, aantal: 5, tijd_min: 35, materialen: [{ filament_type_id: pg, gram: 10 }] }] })).data;
  let d = (await vraag('POST', `/dossiers/${d0.id}/starten`)).data;
  const o = d.productie.regels[0].opdrachten[0];
  const x = (await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: new Date(Date.now() - 30 * 3600e3).toISOString(), geeindigd_op: new Date(Date.now() - 29.4 * 3600e3).toISOString(), uitkomst: 'klaar', kwh: 0.06 })).data;
  await vraag('POST', `/productie/runs/${x.id}/koppel`, { printopdracht_id: o.id });
  await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 5 });
  d = (await vraag('GET', `/dossiers/${d0.id}`)).data;
  assert.equal(d.acties.gratis, true);
  const wbBedrag = d.werkbon.bedrag;
  d = (await vraag('POST', `/dossiers/${d0.id}/gratis`, { datum: vandaag })).data;
  assert.equal(d.fase, 'gratis');
  assert.deepEqual(d.stappen.slice(-1), ['gratis']);
  assert.equal(d.gratis_waarde, wbBedrag);
  assert.ok(d.werkbon.definitief_op);
  assert.equal(d.acties.bewerken, false); assert.equal(d.acties.afrekenen, false); assert.equal(d.acties.annuleren, false);
  assert.equal(d.volgende_stap.soort, 'afgerond'); assert.match(d.volgende_stap.tekst, /Gratis geleverd/);
  assert.equal((await vraag('POST', `/dossiers/${d0.id}/afrekenen`, { soort: 'bonnetje', nummer: 'B', datum: vandaag })).status, 400);
  // Financiën: geen omzet, wel in Marges en in het overzicht
  const ov = (await vraag('GET', `/financien/overzicht?jaar=${jaar}`)).data;
  assert.equal(ov.totaal.omzet, omzetVoor);
  assert.equal(ov.gratis.aantal, 1); assert.equal(ov.gratis.waarde, wbBedrag); assert.ok(ov.gratis.kost > 0);
  const m = (await vraag('GET', `/financien/marges?jaar=${jaar}`)).data.rijen.find(r => r.id === d0.id);
  assert.equal(m.afgerekend_soort, 'gratis'); assert.equal(m.afgerekend_bedrag, 0); assert.ok(m.kost > 0); assert.equal(m.marge, -m.kost);
  // opvolging: niet bij onbetaald of nog af te rekenen
  const op = (await vraag('GET', '/financien/opvolging')).data;
  assert.ok(!JSON.stringify(op).includes(`"id":${d0.id},`));
  // ongedaan
  d = (await vraag('POST', `/dossiers/${d0.id}/gratis-ongedaan`)).data;
  assert.equal(d.fase, 'klaar'); assert.equal(d.werkbon.definitief_op, null); assert.equal(d.werkbon.versie, 2);
  // eigen product: niet
  const e = (await vraag('POST', '/dossiers', { titel: 'Eigen', soort: 'eigen', regels: [{ type: 'extra', bedrag: 1 }] })).data;
  assert.match((await vraag('POST', `/dossiers/${e.id}/gratis`, {})).data.error, /Enkel een klantopdracht/);
});

test('X15. productiekost: wat ontbreekt wordt bewaard en getoond; herberekenen na het aanvullen', async () => {
  getDb().prepare(`UPDATE printruns SET intern = 'test' WHERE printopdracht_id IS NULL AND intern IS NULL`).run();
  const db = getDb();
  // nieuwe prijsgroep zonder enige inkoopprijs
  const kaal = (await vraag('POST', '/filament/types', { merk_id: 2, materiaal_id: 1, verkoopprijs_per_kg: 30 })).data.id;
  const naam = db.prepare(`SELECT fm.naam || ' ' || mat.naam n FROM filament_types ft JOIN filament_merken fm ON fm.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id WHERE ft.id = ?`).get(kaal).n;
  const d0 = (await vraag('POST', '/dossiers', { titel: 'Zonder inkoop', klant_id: klant, regels: [
    { type: 'printen', omschrijving: 'Kaal', printer_id: mini, aantal: 1, tijd_min: 30, materialen: [{ filament_type_id: kaal, gram: 50 }] }] })).data;
  const d = (await vraag('POST', `/dossiers/${d0.id}/starten`)).data;
  const o = d.productie.regels[0].opdrachten[0];
  const x = (await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: new Date(Date.now() - 40 * 3600e3).toISOString(), geeindigd_op: new Date(Date.now() - 39.5 * 3600e3).toISOString(), uitkomst: 'klaar', kwh: 0.05 })).data;
  await vraag('POST', `/productie/runs/${x.id}/koppel`, { printopdracht_id: o.id });
  // bevestigvenster: vooraf zien wat ontbreekt
  const vb = (await vraag('GET', `/productie/opdrachten/${o.id}/kost-voorbeeld?aantal_goed=1`)).data;
  assert.equal(vb.onvolledig, true); assert.deepEqual(vb.ontbreekt, [`inkoopprijs filament ${naam}`]);
  await vraag('POST', `/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: 1 });
  let r = db.prepare('SELECT * FROM printopdrachten WHERE id = ?').get(o.id);
  assert.equal(r.kost_onvolledig, 1); assert.equal(r.kost_ontbreekt, `inkoopprijs filament ${naam}`);
  const voor = r.productiekost_stuk;
  // inkoopprijs aanvullen (artikel in die prijsgroep met inkoopprijs per rol)
  db.prepare(`INSERT INTO artikelen (type, filament_type_id, kleur_id, wordt_gekocht, inkoopprijs) VALUES ('filament', ?, 1, 1, 20)`).run(kaal);
  const h = (await vraag('POST', `/productie/opdrachten/${o.id}/herbereken`)).data;
  assert.equal(h.kost.onvolledig, false);
  r = db.prepare('SELECT * FROM printopdrachten WHERE id = ?').get(o.id);
  assert.equal(r.kost_onvolledig, 0); assert.equal(r.kost_ontbreekt, null);
  assert.ok(r.productiekost_stuk > voor, 'filament telt nu mee');
  // bulk via Marges
  const b = (await vraag('POST', '/financien/marges/herbereken')).data;
  assert.ok(b.bekeken >= 0);
});
