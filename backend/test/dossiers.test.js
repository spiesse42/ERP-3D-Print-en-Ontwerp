// Stap 5a: dossiers, regels, afgeleide fase, afrekening als verwijzing, nummering.
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
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const jaar = new Date().getFullYear();
let mini, pg, klant, verzending;

test('E0. voorbereiding: printer, prijsgroep, klant, dienst', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 });
  pg = (await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 })).data.id;
  klant = (await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Sofie', naam: 'Maes', gemeente: 'Geel' })).data.id;
  verzending = (await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Verzending', wordt_verkocht: true, verkoopprijs: 4.5, vaste_prijs: true })).data.id;
});

const regels = () => [
  { type: 'printen', omschrijving: 'Naamplaatje', printer_id: mini, aantal: 2, tijd_min: 90, materialen: [{ filament_type_id: pg, gram: 40 }, { filament_type_id: pg, gram: 5 }] },
  { type: 'ontwerp', minuten: 30 },
  { type: 'artikel', artikel_id: verzending, aantal: 1 },
];

test('E1. aanmaken: nummer D-jaar-001, regels bewaard, berekening = /api/bereken', async () => {
  const r = await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Naamplaatje fiets', regels: regels() });
  assert.equal(r.status, 201);
  const d = r.data;
  assert.equal(d.nummer, `D-${jaar}-001`);
  assert.equal(d.fase, 'nieuw');
  assert.equal(d.klant, 'Sofie Maes');
  assert.equal(d.regels.length, 3);
  assert.equal(d.regels[0].materialen.length, 2);
  const b = (await vraag('POST', '/bereken', { regels: regels() })).data;
  assert.equal(d.berekening.totaal, b.totaal);
  assert.ok(d.berekening.volledig);
  assert.equal(d.berekening.vast, 4.5, 'verzending buiten de btw-grondslag');
  const lijst = (await vraag('GET', '/dossiers')).data;
  assert.equal(lijst[0].totaal, b.totaal);
  assert.equal(lijst[0].klant, 'Sofie Maes');
});

test('E2. regels wijzigen behoudt id\'s; historiek toont het nieuwe totaal', async () => {
  const d = (await vraag('GET', '/dossiers')).data[0];
  const vol = (await vraag('GET', `/dossiers/${d.id}`)).data;
  const [printen, ontwerp] = vol.regels;
  const nieuw = [{ ...printen, aantal: 3 }, { type: 'extra', bedrag: 2, omschrijving: 'Sleutelring' }, { ...ontwerp }];
  const r = await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Naamplaatje fiets', regels: nieuw });
  assert.equal(r.status, 200);
  assert.equal(r.data.regels[0].id, printen.id, 'printregel behoudt zijn id');
  assert.equal(r.data.regels[2].id, ontwerp.id, 'ontwerpregel behoudt zijn id (andere volgorde)');
  assert.ok(!r.data.regels.some(x => x.type === 'artikel'), 'verzending is weg');
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM dossier_regels').get().n, 3, 'geen wezen');
  const h = (await vraag('GET', `/historiek/dossier/${d.id}`)).data;
  assert.match(h[0].tekst, /Regels gewijzigd \(3 regels, totaal € [\d,]+ → € [\d,]+\)/);
  // zelfde regels opnieuw opslaan → geen lege historiekregel
  const n = h.length;
  await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Naamplaatje fiets', regels: r.data.regels });
  assert.equal((await vraag('GET', `/historiek/dossier/${d.id}`)).data.length, n);
});

test('E3. validatie: titel verplicht, negatief, filament of prijsgroep', async () => {
  assert.equal((await vraag('POST', '/dossiers', { titel: ' ' })).status, 400);
  let r = await vraag('POST', '/dossiers', { titel: 'x', regels: [{ type: 'printen', tijd_min: -5 }] });
  assert.match(r.data.error, /Regel 1: printtijd mag niet negatief zijn/);
  r = await vraag('POST', '/dossiers', { titel: 'x', regels: [{ type: 'printen', materialen: [{ gram: 3 }] }] });
  assert.match(r.data.error, /kies per kleur een filament of een prijsgroep/);
  r = await vraag('POST', '/dossiers', { titel: 'x', klant_id: 999 });
  assert.match(r.data.error, /Onbekende klant/);
  r = await vraag('POST', '/dossiers', { titel: 'x', soort: 'webshop' });
  assert.equal(r.status, 400);
});

test('E4. afrekenen (factuur) → vast → betaald → ongedaan', async () => {
  const d = (await vraag('GET', '/dossiers')).data[0];
  let r = await vraag('POST', `/dossiers/${d.id}/betaald`, { datum: '2026-09-25' });
  assert.equal(r.status, 400, 'betaald kan pas na afrekenen');
  r = await vraag('POST', `/dossiers/${d.id}/afrekenen`, { soort: 'factuur', nummer: '', datum: '2026-09-25' });
  assert.match(r.data.error, /nummer van de factuur/);
  assert.equal((await vraag('GET', `/dossiers/${d.id}`)).data.werkbon, null, 'fout → ook geen werkbon (transactie)');
  r = await vraag('POST', `/dossiers/${d.id}/afrekenen`, { soort: 'factuur', nummer: 'F2026-014', datum: '2026-09-25' });
  assert.equal(r.status, 200);
  assert.equal(r.data.fase, 'afgerekend');
  assert.ok(r.data.werkbon?.definitief_op, 'zonder werkbon maakt afrekenen hem zelf (25-09)');
  assert.equal(r.data.afgerekend_bedrag, d.totaal, 'bedrag = totaal als je niets invult');
  // vast: regels/titel wijzigen geweigerd, notities mag
  r = await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Andere titel' });
  assert.match(r.data.error, /afgerekend en ligt vast/);
  r = await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Naamplaatje fiets', notities: 'Opgehaald' });
  assert.equal(r.status, 200);
  assert.equal((await vraag('POST', `/dossiers/${d.id}/annuleren`)).status, 400);
  assert.equal((await vraag('DELETE', `/dossiers/${d.id}`)).status, 400);
  r = await vraag('POST', `/dossiers/${d.id}/betaald`, { datum: '2026-09-30' });
  assert.equal(r.data.fase, 'betaald');
  r = await vraag('POST', `/dossiers/${d.id}/betaling-ongedaan`);
  assert.equal(r.data.fase, 'afgerekend');
  r = await vraag('POST', `/dossiers/${d.id}/afrekening-ongedaan`);
  assert.equal(r.data.fase, 'nieuw');
  assert.equal(r.data.afgerekend_nummer, null);
  const h = (await vraag('GET', `/historiek/dossier/${d.id}`)).data.map(x => x.tekst);
  assert.ok(h.some(t => /Afgerekend in Accountable: factuur F2026-014 van 25-09-2026/.test(t)));
  assert.ok(h.some(t => /Pas dit ook aan in Accountable/.test(t)));
});

test('E5. bonnetje = afgerekend én betaald; eigen product wordt niet afgerekend', async () => {
  const d = (await vraag('POST', '/dossiers', { titel: 'Sleutelhangers markt', klant_id: klant, regels: [{ type: 'extra', bedrag: 12 }] })).data;
  await vraag('POST', `/dossiers/${d.id}/werkbon`);
  const r = await vraag('POST', `/dossiers/${d.id}/afrekenen`, { soort: 'bonnetje', nummer: 'B-88', datum: '2026-09-25', bedrag: '11,50' });
  assert.equal(r.data.fase, 'betaald');
  assert.equal(r.data.afgerekend_bedrag, 11.5);
  assert.equal(r.data.acties.betaling_ongedaan, false, 'bonnetje is altijd betaald');
  const e = (await vraag('POST', '/dossiers', { titel: 'Voorraad hondjes', soort: 'eigen', regels: [{ type: 'extra', bedrag: 1 }] })).data;
  assert.equal(e.acties.afrekenen, false);
  assert.deepEqual(e.stappen, ['nieuw']);
  assert.match((await vraag('POST', `/dossiers/${e.id}/afrekenen`, { soort: 'factuur', nummer: 'x', datum: '2026-09-25' })).data.error, /Enkel een klantopdracht/);
  // niet volledig berekenbaar → niet afrekenen
  const o = (await vraag('POST', '/dossiers', { titel: 'Zonder printer', klant_id: klant, regels: [{ type: 'printen', tijd_min: 60 }] })).data;
  assert.equal(o.berekening.volledig, false);
  await vraag('POST', `/dossiers/${o.id}/werkbon`);
  assert.match((await vraag('POST', `/dossiers/${o.id}/afrekenen`, { soort: 'factuur', nummer: 'x', datum: '2026-09-25' })).data.error, /Niet alle regels/);
});

test('E6. annuleren/heropenen, archiveren, verwijderen, klant verwijderen geweigerd', async () => {
  const d = (await vraag('POST', '/dossiers', { titel: 'Test', klant_id: klant })).data;
  let r = await vraag('POST', `/dossiers/${d.id}/annuleren`);
  assert.equal(r.data.fase, 'geannuleerd');
  assert.match((await vraag('PUT', `/dossiers/${d.id}`, { titel: 'x', klant_id: klant })).data.error, /geannuleerd/);
  r = await vraag('POST', `/dossiers/${d.id}/heropenen`);
  assert.equal(r.data.fase, 'nieuw');
  await vraag('PATCH', `/dossiers/${d.id}/archief`, { gearchiveerd: true });
  assert.ok(!(await vraag('GET', '/dossiers')).data.some(x => x.id === d.id));
  assert.ok((await vraag('GET', '/dossiers?archief=1')).data.some(x => x.id === d.id));
  assert.equal((await vraag('DELETE', `/dossiers/${d.id}`)).status, 200);
  assert.equal((await vraag('GET', `/dossiers/${d.id}`)).status, 404);
  assert.equal((await vraag('GET', `/historiek/dossier/${d.id}`)).status, 404);
  // klant met dossiers kan niet weg, printer ook niet
  assert.match((await vraag('DELETE', `/klanten/${klant}`)).data.error, /Archiveer/);
  assert.equal((await vraag('DELETE', `/printers/${mini}`)).status, 400);
  // filter per klant
  assert.ok((await vraag(`GET`, `/dossiers?klant=${klant}`)).data.every(x => x.klant_id === klant));
});

test('E7. nummering: overzicht, verder tellen, niet lager dan wat bestaat', async () => {
  let r = await vraag('GET', '/nummering');
  const D = r.data.find(x => x.reeks === 'D');
  assert.equal(D.minimum, 5, 'D-…-001 t.e.m. 004 bestaan nog; 005 is verwijderd en telt niet');
  r = await vraag('PUT', '/nummering/D', { volgend: 2 });
  assert.match(r.data.error, /niet lager dan 5/);
  r = await vraag('PUT', '/nummering/OFF', { volgend: 42 });
  assert.equal(r.data.find(x => x.reeks === 'OFF').voorbeeld, `OFF-${jaar}-042`);
  r = await vraag('PUT', '/nummering/D', { volgend: 120 });
  assert.equal(r.status, 200);
  const d = (await vraag('POST', '/dossiers', { titel: 'Na overschakeling' })).data;
  assert.equal(d.nummer, `D-${jaar}-120`);
  assert.equal((await vraag('PUT', '/nummering/XX', { volgend: 1 })).status, 400);
  assert.equal((await vraag('PUT', '/nummering/D', { volgend: 'abc' })).status, 400);
});
