// 21-11: prijs per aantal (staffel) op een offerte: één printregel herrekend
// voor andere aantallen (bv. sleutelhangers, 16 per plaat).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { regelVoorAantal, leesAantallen } from '../domein/staffel.js';
import { documentHtml } from '../documenten/sjabloon.js';

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

test('S1. regel voor een ander aantal: per plaat, per stuk', () => {
  const plaat = { type: 'printen', aantal: 16, per_plaat: 16, per_stuk: false, tijd_min: 240, voorbereiding_min: 10, nabewerking_min: 5, materialen: [{ filament_type_id: 1, gram: 80 }], handmatig_bedrag: 99 };
  const r = regelVoorAantal(plaat, 50);   // 4 platen
  assert.equal(r.aantal, 50);
  assert.equal(r.tijd_min, 960);
  assert.equal(r.materialen[0].gram, 320);
  assert.equal(r.voorbereiding_min, 40);
  assert.equal(r.nabewerking_min, 20);
  assert.equal(r.handmatig_bedrag, null, 'handmatig bedrag telt niet mee');
  const stuk = { type: 'printen', aantal: 2, per_stuk: true, tijd_min: 30, voorbereiding_min: null, materialen: [{ filament_type_id: 1, gram: 10 }] };
  const s = regelVoorAantal(stuk, 10);
  assert.equal(s.tijd_min, 150);
  assert.equal(s.materialen[0].gram, 50);
  assert.equal(s.voorbereiding_min, null, 'leeg blijft leeg (standaard)');
  assert.deepEqual(leesAantallen('200; 50,100  50'), [50, 100, 200]);
  assert.throws(() => leesAantallen('50, abc'), /hele getallen/);
  assert.throws(() => leesAantallen('0'), /hele getallen/);
});

let dos, regel, o;
test('S2. voorbeeld en bewaren op de offerte; per stuk daalt met het aantal', async () => {
  const db = getDb();
  const p = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  await vraag('PUT', `/printers/${p}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 });
  const pg = (await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 })).data.id;
  const klant = (await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'An', naam: 'B' })).data.id;
  dos = (await vraag('POST', '/dossiers', { titel: 'Sleutelhangers', klant_id: klant, regels: [
    { type: 'ontwerp', minuten: 60 },
    { type: 'printen', omschrijving: 'Sleutelhanger (16 per plaat)', printer_id: p, aantal: 16, per_plaat: 16, tijd_min: 240, materialen: [{ filament_type_id: pg, gram: 80 }] }] })).data;
  regel = dos.regels.find(r => r.type === 'printen');
  const v = await vraag('POST', `/dossiers/${dos.id}/staffel`, { regel_id: regel.id, aantallen: '200, 50, 100' });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.deepEqual(v.data.rijen.map(x => x.aantal), [50, 100, 200]);
  assert.deepEqual(v.data.rijen.map(x => x.platen), [4, 7, 13]);
  for (const x of v.data.rijen) assert.equal(x.totaal, Math.round(x.per_stuk * x.aantal * 100) / 100);
  assert.ok(v.data.rijen[0].per_stuk >= v.data.rijen[2].per_stuk, 'per stuk niet duurder bij meer');
  // ontwerpregel kan niet
  const ontwerp = dos.regels.find(r => r.type === 'ontwerp');
  assert.match((await vraag('POST', `/dossiers/${dos.id}/staffel`, { regel_id: ontwerp.id, aantallen: '50' })).data.error, /printregel/);

  o = (await vraag('POST', `/dossiers/${dos.id}/offertes`)).data.offertes[0];
  const r = await vraag('PUT', `/offertes/${o.id}`, { staffel: { regel_id: regel.id, aantallen: '50, 100, 200' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.offertes[0].staffel, { regel_id: regel.id, aantallen: [50, 100, 200], extra: [] });
  assert.match((await vraag('PUT', `/offertes/${o.id}`, { staffel: { regel_id: regel.id, aantallen: '' } })).data.error, /minstens één aantal/);
  // andere velden aanpassen laat de staffel staan
  assert.deepEqual((await vraag('PUT', `/offertes/${o.id}`, { levertermijn: '2 weken' })).data.offertes[0].staffel.aantallen, [50, 100, 200]);
});

test('S3. versturen legt de prijzen vast; nieuwe versie neemt de keuze over', async () => {
  const voor = (await vraag('POST', `/dossiers/${dos.id}/staffel`, { regel_id: regel.id, aantallen: '50, 100, 200' })).data.rijen;
  assert.equal((await vraag('POST', `/offertes/${o.id}/versturen`)).status, 200);
  const m = JSON.parse(getDb().prepare('SELECT momentopname FROM offertes WHERE id = ?').get(o.id).momentopname);
  assert.deepEqual(m.document.staffel.rijen, voor);
  const d = (await vraag('POST', `/dossiers/${dos.id}/offertes`)).data;
  assert.deepEqual(d.offertes.find(x => x.versie === 2).staffel, { regel_id: regel.id, aantallen: [50, 100, 200], extra: [] });
  const uit = await vraag('PUT', `/offertes/${d.offertes.find(x => x.versie === 2).id}`, { staffel: null });
  assert.equal(uit.data.offertes.find(x => x.versie === 2).staffel, null);
});

test('S3b. sleutelring per stuk mee: 1 per stuk, wat het aantal op de regel ook is; verzending (vaste prijs) niet', async () => {
  const ring = (await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelring', verkoopprijs: 0.25, wordt_verkocht: true, wordt_gekocht: true })).data;
  assert.ok(ring.id, JSON.stringify(ring));
  const verz = (await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Verzending', verkoopprijs: 6, wordt_verkocht: true, vaste_prijs: true })).data;
  const p = getDb().prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  const pg = getDb().prepare('SELECT id FROM filament_types LIMIT 1').get().id;
  const k = (await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'C', naam: 'D' })).data.id;
  const d2 = (await vraag('POST', '/dossiers', { titel: 'Ringen', klant_id: k, regels: [
    { type: 'printen', omschrijving: 'Sleutelhanger', printer_id: p, aantal: 16, per_plaat: 16, tijd_min: 240, materialen: [{ filament_type_id: pg, gram: 80 }] },
    { type: 'artikel', artikel_id: ring.id, aantal: 3 },
    { type: 'artikel', artikel_id: verz.id, aantal: 1 }] })).data;
  const [pr, rg, vz] = d2.regels;
  const zonder = (await vraag('POST', `/dossiers/${d2.id}/staffel`, { regel_id: pr.id, aantallen: '48, 96' })).data.rijen;
  const met = await vraag('POST', `/dossiers/${d2.id}/staffel`, { regel_id: pr.id, aantallen: '48, 96', extra: [rg.id] });
  assert.equal(met.status, 200, JSON.stringify(met.data));
  assert.deepEqual(met.data.extra, ['Sleutelring']);
  // 48 ringen à € 0,25 = € 12 erbij
  assert.ok(Math.abs((met.data.rijen[0].totaal - zonder[0].totaal) - 12) < 0.5, `${met.data.rijen[0].totaal} vs ${zonder[0].totaal}`);
  assert.ok(Math.abs((met.data.rijen[1].totaal - zonder[1].totaal) - 24) < 1);
  assert.match((await vraag('POST', `/dossiers/${d2.id}/staffel`, { regel_id: pr.id, aantallen: '48', extra: [vz.id] })).data.error, /per stuk meetellen/);
  const o2 = (await vraag('POST', `/dossiers/${d2.id}/offertes`)).data.offertes[0];
  const r = await vraag('PUT', `/offertes/${o2.id}`, { staffel: { regel_id: pr.id, aantallen: '48, 96', extra: [rg.id] } });
  assert.deepEqual(r.data.offertes[0].staffel.extra, [rg.id]);
  assert.match((await vraag('PUT', `/offertes/${o2.id}`, { staffel: { regel_id: pr.id, aantallen: '48', extra: [vz.id] } })).data.error, /per stuk meetellen/);
});

test('S4. sjabloon: tabel "Prijs per aantal"', () => {
  const inhoud = { bedrijf: {}, klant: null, dossier: {}, regels: [], totaal: 10, vast: 0 };
  const html = documentHtml({ soort: 'OFFERTE', nummer: 'O', datum: '2026-11-21', inhoud,
    staffel: { omschrijving: 'Sleutelhanger <rood>', extra: ['Sleutelring'], rijen: [{ aantal: 50, per_stuk: 1.2, totaal: 60 }, { aantal: 100, per_stuk: 0.95, totaal: 95 }] } });
  assert.match(html, /Prijs per aantal \(indicatief\)/);
  assert.match(html, /Sleutelhanger &lt;rood&gt;, inclusief Sleutelring/);
  assert.match(html, /<td>50 stuks<\/td><td class="r">€ 1,20<\/td><td class="r">€ 60,00<\/td>/);
  assert.doesNotMatch(documentHtml({ soort: 'OFFERTE', nummer: 'O', datum: '2026-11-21', inhoud }), /Prijs per aantal/);
});
