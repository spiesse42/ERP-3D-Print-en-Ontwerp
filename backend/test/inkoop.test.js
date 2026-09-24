// Tests voor stap 3b: leveranciers, aankopen (status afgeleid, bestellen,
// deels ontvangen, plaatshouder, annuleren/heropenen), bestelling maken, bijlagen.
process.env.NODE_ENV = 'test';

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
  const res = await fetch(basis + pad, {
    method: methode,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const fout = (r, patroon) => { assert.equal(r.status, 400, JSON.stringify(r.data)); if (patroon) assert.match(r.data.error, patroon); };

let action, bambu, ring, lijm, verzending, zwartPla;
test('leveranciers: aanmaken, wijzigen met historiek, dubbel geweigerd', async () => {
  action = ok(await vraag('POST', '/leveranciers', { naam: 'Action', website: 'action.com' }), 201).id;
  bambu = ok(await vraag('POST', '/leveranciers', { naam: 'Bambu Lab Store', email: 'x@bambulab.com' }), 201).id;
  fout(await vraag('POST', '/leveranciers', { naam: 'action' }), /bestaat al/);
  fout(await vraag('POST', '/leveranciers', { naam: 'X', email: 'geen' }), /e-mailadres/);
  ok(await vraag('PUT', `/leveranciers/${action}`, { naam: 'Action', website: 'action.com', klantnummer: 'K-77', btw_nummer: 'BE0404' }));
  const h = ok(await vraag('GET', `/historiek/leverancier/${action}`));
  assert.match(h[0].tekst, /Ons klantnummer ingevuld: K-77/);
  const l = ok(await vraag('GET', `/leveranciers/${action}`));
  assert.deepEqual([l.klantnummer, l.aankopen, l.artikelen], ['K-77', 0, 0]);
});

test('voorbereiding: artikelen', async () => {
  ring = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelring', wordt_gekocht: true, min_voorraad: 50, max_voorraad: 100 }), 201).id;
  lijm = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Secondelijm', wordt_gekocht: true }), 201).id;
  verzending = ok(await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Verzending in', wordt_gekocht: true }), 201).id;
});

let ak;
test('aankoop: concept → besteld; leverancier nodig om te bestellen', async () => {
  const r = ok(await vraag('POST', '/inkoop/aankopen', { regels: [
    { soort: 'artikel', artikel_id: ring, aantal: 100, prijs_per_eenheid: '0,05' },
    { soort: 'artikel', artikel_id: lijm, aantal: 2, prijs_per_eenheid: 3 },
    { soort: 'kost', omschrijving: 'Verzending', aantal: 1, prijs_per_eenheid: '4,95' },
  ] }), 201);
  ak = r.id;
  assert.match(r.nummer, /^AK-\d{4}-0001$/);
  let a = ok(await vraag('GET', `/inkoop/aankopen/${ak}`));
  assert.deepEqual([a.status, a.totaal, a.regels.length], ['concept', 15.95, 3]);
  assert.equal(a.regels[2].ontvangbaar, false, 'verzending hoeft niet ontvangen te worden');
  fout(await vraag('POST', `/inkoop/aankopen/${ak}/bestellen`), /leverancier/);
  ok(await vraag('PUT', `/inkoop/aankopen/${ak}`, { leverancier_id: action, extern_factuurnummer: 'F-123',
    regels: a.regels.map(x => ({ id: x.id, soort: x.soort, artikel_id: x.artikel_id, omschrijving: x.omschrijving, aantal: x.aantal, prijs_per_eenheid: x.prijs_per_eenheid })) }));
  a = ok(await vraag('POST', `/inkoop/aankopen/${ak}/bestellen`));
  assert.equal(a.status, 'besteld');
  fout(await vraag('POST', `/inkoop/aankopen/${ak}/bestellen`), /concept/);
  // lopende bestelling telt mee in "te bestellen": ring niet meer op de lijst
  const tb = ok(await vraag('GET', '/voorraad/te-bestellen'));
  assert.ok(!tb.some(x => x.id === ring));
  assert.equal(ok(await vraag('GET', `/voorraad/artikelen/${ring}`)).besteld, 100);
});

test('ontvangen: deels, dan de rest; prijzen bijwerken; regel ligt daarna vast', async () => {
  let a = ok(await vraag('GET', `/inkoop/aankopen/${ak}`));
  const [rRing, rLijm, rKost] = a.regels;
  fout(await vraag('POST', `/inkoop/aankopen/${ak}/ontvangen`, { lijnen: [{ regel_id: rRing.id, aantal: 101 }] }), /nog maar 100 open/);
  fout(await vraag('POST', `/inkoop/aankopen/${ak}/ontvangen`, { lijnen: [{ regel_id: rKost.id, aantal: 1 }] }), /geen voorraad/);
  fout(await vraag('POST', `/inkoop/aankopen/${ak}/ontvangen`, { lijnen: [{ regel_id: rRing.id, aantal: 0 }] }), /minstens één/);
  a = ok(await vraag('POST', `/inkoop/aankopen/${ak}/ontvangen`, { lijnen: [{ regel_id: rRing.id, aantal: 60 }], datum: '2026-09-20', locatie: 'Lade A' }));
  assert.equal(a.status, 'deels');
  let art = ok(await vraag('GET', `/voorraad/artikelen/${ring}`));
  assert.deepEqual([art.voorraad, art.besteld, art.inkoopprijs], [60, 40, 0.05]);
  assert.equal(art.leveranciers[0].leverancier, 'Action', 'koppeling vanzelf aangemaakt');
  assert.equal(art.leveranciers[0].laatste_prijs, 0.05);
  assert.equal(art.leveranciers[0].voorkeur, 1);
  const partijen = ok(await vraag('GET', `/voorraad/artikelen/${ring}/partijen`));
  assert.deepEqual([partijen[0].aankoop_nummer, partijen[0].ontvangen_op, partijen[0].locatie, partijen[0].prijs_per_eenheid], [a.nummer, '2026-09-20', 'Lade A', 0.05]);
  // annuleren kan niet meer
  fout(await vraag('POST', `/inkoop/aankopen/${ak}/annuleren`), /al iets ontvangen/);
  // ontvangen regel: prijs vast, aantal niet onder ontvangen, niet verwijderen
  const regelsBody = rs => rs.map(x => ({ id: x.id, soort: x.soort, artikel_id: x.artikel_id, omschrijving: x.omschrijving, aantal: x.aantal, prijs_per_eenheid: x.prijs_per_eenheid }));
  let rs = regelsBody(a.regels); rs[0].prijs_per_eenheid = 0.06;
  fout(await vraag('PUT', `/inkoop/aankopen/${ak}`, { leverancier_id: action, regels: rs }), /liggen vast/);
  rs = regelsBody(a.regels); rs[0].aantal = 50;
  fout(await vraag('PUT', `/inkoop/aankopen/${ak}`, { leverancier_id: action, regels: rs }), /niet lager/);
  rs = regelsBody(a.regels).slice(1);
  fout(await vraag('PUT', `/inkoop/aankopen/${ak}`, { leverancier_id: action, regels: rs }), /kan niet verwijderd/);
  // rest komt nooit: aantal ring = 60, lijm ontvangen → status ontvangen
  rs = regelsBody(a.regels); rs[0].aantal = 60;
  ok(await vraag('PUT', `/inkoop/aankopen/${ak}`, { leverancier_id: action, extern_factuurnummer: 'F-123', regels: rs }));
  a = ok(await vraag('POST', `/inkoop/aankopen/${ak}/ontvangen`, { lijnen: [{ regel_id: rLijm.id, aantal: 2 }] }));
  assert.equal(a.status, 'ontvangen');
  art = ok(await vraag('GET', `/voorraad/artikelen/${ring}`));
  assert.equal(art.besteld, 0);
  const h = ok(await vraag('GET', `/historiek/aankoop/${ak}`));
  assert.ok(h.some(g => g.soort === 'status' && /^Ontvangen: 2 × Secondelijm/.test(g.tekst)));
  assert.ok(h.some(g => g.soort === 'status' && /^Deels ontvangen: 60 × Sleutelring/.test(g.tekst)));
  const ha = ok(await vraag('GET', `/historiek/artikel/${ring}`));
  assert.match(ha[0].tekst, /ontvangen via AK-/);
});

test('plaatshouder: merk kiezen bij ontvangst, prijsgroep en artikel worden aangemaakt', async () => {
  // PLA Matte (4) zwart (1), merk nog onbekend
  const r = ok(await vraag('POST', '/inkoop/aankopen', { leverancier_id: bambu, regels: [
    { soort: 'plaatshouder', plaatshouder_materiaal_id: 4, plaatshouder_kleur_id: 1, aantal: 3, prijs_per_eenheid: 19.99 },
  ] }), 201);
  fout(await vraag('POST', '/inkoop/aankopen', { regels: [{ soort: 'plaatshouder', plaatshouder_materiaal_id: 4, aantal: 1 }] }), /kleur/);
  let a = ok(await vraag('GET', `/inkoop/aankopen/${r.id}`));
  assert.equal(a.regels[0].weergave, 'PLA Matte · Zwart (merk nog onbekend)');
  const regel = a.regels[0].id;
  fout(await vraag('POST', `/inkoop/aankopen/${r.id}/ontvangen`, { lijnen: [{ regel_id: regel, aantal: 3 }] }), /kies het merk/);
  fout(await vraag('POST', `/inkoop/aankopen/${r.id}/ontvangen`, { lijnen: [{ regel_id: regel, aantal: 3, merk_id: 1 }] }), /verkoopprijs per kg/);
  // direct ontvangen (concept) met een nieuwe prijsgroep Bambu Lab · PLA Matte
  a = ok(await vraag('POST', `/inkoop/aankopen/${r.id}/ontvangen`, { lijnen: [{ regel_id: regel, aantal: 3, merk_id: 1, nieuwe_prijs_per_kg: '32,5' }] }));
  assert.equal(a.status, 'ontvangen');
  assert.ok(a.besteld_op, 'concept dat meteen ontvangen wordt krijgt een besteldatum');
  const fil = ok(await vraag('GET', '/voorraad/artikelen?type=filament'));
  assert.equal(fil.length, 1);
  zwartPla = fil[0];
  assert.deepEqual([zwartPla.weergave, zwartPla.voorraad, zwartPla.categorie, zwartPla.verkoopprijs_per_kg, zwartPla.inkoopprijs], ['Bambu Lab PLA Matte · Zwart', 3, 'Filament', 32.5, null]);
  // tweede keer: prijsgroep en artikel bestaan al → hetzelfde artikel
  const r2 = ok(await vraag('POST', '/inkoop/aankopen', { leverancier_id: bambu, regels: [
    { soort: 'plaatshouder', plaatshouder_materiaal_id: 4, plaatshouder_kleur_id: 1, aantal: 1, prijs_per_eenheid: 21 }] }), 201);
  const a2 = ok(await vraag('GET', `/inkoop/aankopen/${r2.id}`));
  ok(await vraag('POST', `/inkoop/aankopen/${r2.id}/ontvangen`, { lijnen: [{ regel_id: a2.regels[0].id, aantal: 1, merk_id: 1 }] }));
  assert.equal(ok(await vraag('GET', `/voorraad/artikelen/${zwartPla.id}`)).voorraad, 4);
});

test('annuleren, heropenen, verwijderen', async () => {
  const r = ok(await vraag('POST', '/inkoop/aankopen', { leverancier_id: action, regels: [{ soort: 'artikel', artikel_id: lijm, aantal: 1 }] }), 201);
  ok(await vraag('POST', `/inkoop/aankopen/${r.id}/bestellen`));
  let a = ok(await vraag('POST', `/inkoop/aankopen/${r.id}/heropenen`));
  assert.equal(a.status, 'concept');
  ok(await vraag('POST', `/inkoop/aankopen/${r.id}/bestellen`));
  a = ok(await vraag('POST', `/inkoop/aankopen/${r.id}/annuleren`));
  assert.equal(a.status, 'geannuleerd');
  fout(await vraag('PUT', `/inkoop/aankopen/${r.id}`, { leverancier_id: action, regels: [] }), /geannuleerd/);
  fout(await vraag('POST', `/inkoop/aankopen/${r.id}/ontvangen`, { lijnen: [{ regel_id: a.regels[0].id, aantal: 1 }] }), /geannuleerd/);
  fout(await vraag('DELETE', `/inkoop/aankopen/${r.id}`), /Enkel een concept/);
  a = ok(await vraag('POST', `/inkoop/aankopen/${r.id}/heropenen`));
  assert.equal(a.status, 'besteld', 'terug naar vóór de annulatie');
  ok(await vraag('POST', `/inkoop/aankopen/${r.id}/heropenen`));
  ok(await vraag('DELETE', `/inkoop/aankopen/${r.id}`));
  assert.equal((await vraag('GET', `/inkoop/aankopen/${r.id}`)).status, 404);
  assert.equal(getDb().prepare(`SELECT COUNT(*) c FROM gebeurtenissen WHERE entiteit='aankoop' AND entiteit_id=?`).get(r.id).c, 0);
  // diensten mogen als regel (kost), maar hoeven niet ontvangen te worden
  const d = ok(await vraag('POST', '/inkoop/aankopen', { leverancier_id: action, regels: [{ soort: 'artikel', artikel_id: verzending, aantal: 1, prijs_per_eenheid: 5 }] }), 201);
  assert.equal(ok(await vraag('GET', `/inkoop/aankopen/${d.id}`)).regels[0].ontvangbaar, false);
});

test('bestelling maken vanuit te bestellen: één concept per voorkeursleverancier', async () => {
  const uit = ok(await vraag('POST', '/inkoop/bestelling-maken', { regels: [
    { artikel_id: ring, aantal: 40 }, { artikel_id: zwartPla.id, aantal: 2 }, { artikel_id: lijm, aantal: 1 },
  ] }), 201);
  // ring + lijm → Action (koppeling uit de ontvangst), zwart PLA → Bambu
  assert.equal(uit.length, 2);
  const aks = await Promise.all(uit.map(async u => ok(await vraag('GET', `/inkoop/aankopen/${u.id}`))));
  const bijAction = aks.find(x => x.leverancier === 'Action');
  assert.deepEqual(bijAction.regels.map(r => [r.weergave, r.aantal, r.prijs_per_eenheid]), [['Sleutelring', 40, 0.05], ['Secondelijm', 1, 3]]);
  assert.equal(aks.find(x => x.leverancier === 'Bambu Lab Store').regels[0].prijs_per_eenheid, 21, 'laatste prijs');
  assert.ok(aks.every(x => x.status === 'concept'));
  fout(await vraag('POST', '/inkoop/bestelling-maken', { regels: [{ artikel_id: verzending, aantal: 1 }] }), /niet besteld/);
  fout(await vraag('POST', '/inkoop/bestelling-maken', { regels: [] }), /minstens één/);
  // lijst + filters
  const lijst = ok(await vraag('GET', `/inkoop/aankopen?artikel_id=${ring}`));
  assert.ok(lijst.length >= 2 && lijst.every(x => x.samenvatting.includes('Sleutelring')));
  const perLev = ok(await vraag('GET', `/inkoop/aankopen?leverancier_id=${bambu}`));
  assert.ok(perLev.every(x => x.leverancier === 'Bambu Lab Store'));
  const prijzen = ok(await vraag('GET', `/inkoop/prijzen?leverancier_id=${action}`));
  assert.equal(prijzen[ring].prijs, 0.05);
});

test('leverancier met aankopen: niet verwijderen, wel archiveren', async () => {
  fout(await vraag('DELETE', `/leveranciers/${action}`), /Archiveer/);
  ok(await vraag('PATCH', `/leveranciers/${action}/archief`, { gearchiveerd: true }));
  assert.ok(!ok(await vraag('GET', '/leveranciers')).some(l => l.id === action));
  const l = ok(await vraag('GET', `/leveranciers/${action}`));
  assert.ok(l.aankopen >= 2);
  assert.ok(l.artikellijst.some(x => x.weergave === 'Sleutelring'));
  ok(await vraag('PATCH', `/leveranciers/${action}/archief`, { gearchiveerd: false }));
});

test('bijlagen: opladen, lijst, downloaden, weigeren, verwijderen', async () => {
  const fd = new FormData();
  fd.append('bestand', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'factuur é.pdf');
  let res = await fetch(`${basis}/bijlagen/aankoop/${ak}`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const b = await res.json();
  assert.equal(b.bestandsnaam, 'factuur é.pdf');
  const lijst = ok(await vraag('GET', `/bijlagen/aankoop/${ak}`));
  assert.equal(lijst.length, 1);
  res = await fetch(`${basis}/bijlagen/bestand/${b.id}`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '%PDF-1.4 test');
  assert.equal(ok(await vraag('GET', `/inkoop/aankopen/${ak}`)).bijlagen.length, 1);
  // ander type → geweigerd; onbekend record → 404
  const fd2 = new FormData();
  fd2.append('bestand', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
  res = await fetch(`${basis}/bijlagen/aankoop/${ak}`, { method: 'POST', body: fd2 });
  assert.equal(res.status, 400);
  const fd3 = new FormData();
  fd3.append('bestand', new Blob(['%PDF'], { type: 'application/pdf' }), 'y.pdf');
  res = await fetch(`${basis}/bijlagen/aankoop/99999`, { method: 'POST', body: fd3 });
  assert.equal(res.status, 404);
  ok(await vraag('DELETE', `/bijlagen/bestand/${b.id}`));
  assert.equal(ok(await vraag('GET', `/bijlagen/aankoop/${ak}`)).length, 0);
  const h = ok(await vraag('GET', `/historiek/aankoop/${ak}`));
  assert.match(h[0].tekst, /Bijlage verwijderd: factuur é\.pdf/);
});
