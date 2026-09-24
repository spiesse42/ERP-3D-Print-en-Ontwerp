// Tests voor stap 3c: factuur inlezen. Gemini wordt vervangen door de
// antwoorden in fixtures/ (opgesteld uit drie echte facturen), zodat het
// koppelen, het nakijkvoorstel en het bevestigen getest worden zonder sleutel.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { vervangLezer, maakInstructie } from '../integraties/gemini.js';
import { catalogusVoorInstructie } from '../domein/factuurherkenning.js';
import { AC_PRODUCTS, BAMBU, JOYBUY } from './fixtures/gemini-antwoorden.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { vervangLezer(null); server.close(); sluitDb(); });

async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
async function lees(antwoord, naam = 'factuur.pdf') {
  let gezien = null;
  vervangLezer(async (args) => { gezien = args; if (antwoord instanceof Error) throw antwoord; return structuredClone(antwoord); });
  const fd = new FormData();
  fd.append('bestand', new Blob(['%PDF-1.4 nep'], { type: 'application/pdf' }), naam);
  const res = await fetch(`${basis}/inkoop/inlezen`, { method: 'POST', body: fd });
  return { status: res.status, data: await res.json(), gezien };
}
// Nakijkvoorstel → body zoals het scherm het terugstuurt.
const alsBody = (v, extra = {}) => ({
  leverancier: v.leverancier.id ? { id: v.leverancier.id } : v.leverancier,
  factuurnummer: v.factuurnummer, datum: v.datum, meteen_ontvangen: true,
  regels: v.regels.map(r => ({ soort: r.soort, artikel_id: r.artikel_id, nieuw_artikel: r.nieuw_artikel, filament: r.filament,
    omschrijving: r.omschrijving, productcode: r.productcode, aantal: r.aantal, prijs_per_eenheid: r.prijs_per_eenheid })),
  ...extra,
});

test('instructie bevat onze eigen catalogus en de afgesproken regels', () => {
  const db = getDb();
  const t = maakInstructie(catalogusVoorInstructie(db));
  assert.match(t, /eSUN/); assert.match(t, /PLA Matte/); assert.match(t, /Zwart/); assert.match(t, /Onderdelen/);
  assert.match(t, /INCL\. BTW, NA korting/);
  assert.match(t, /nooit de leverancier/);
});

let acId;
test('AC products: nieuw filament met bestaand merk/type/kleur, nieuwe prijsgroep, verzending als kost', async () => {
  const r = await lees(AC_PRODUCTS, 'Ac Products.pdf');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.gezien.mimetype, 'application/pdf');
  const v = r.data.voorstel;
  assert.deepEqual([v.leverancier.id, v.leverancier.naam, v.klopt, v.totaal_factuur, v.som_regels, v.dubbel], [null, 'AC products', true, 16.27, 16.27, null]);
  const [fil, kost] = v.regels;
  assert.deepEqual([fil.status, fil.soort, fil.filament.merk_naam, fil.filament.materiaal_naam, fil.filament.kleur_naam, fil.filament.prijsgroep_bestaat],
    ['nieuw', 'nieuw_filament', 'eSUN', 'PLA', 'Blauw', false]);
  assert.ok(fil.filament.merk_id && fil.filament.materiaal_id && fil.filament.kleur_id, 'bestaande catalogus gevonden');
  assert.equal(kost.status, 'kost');
  // voorbeeld van het bestand is beschikbaar
  const vb = await fetch(`${basis}/inkoop/inlezen/${r.data.token}/bestand`);
  assert.equal(vb.status, 200);
  // zonder verkoopprijs voor de nieuwe prijsgroep → geweigerd, niets aangemaakt
  let b = await vraag('POST', `/inkoop/inlezen/${r.data.token}/bevestig`, alsBody(v));
  assert.equal(b.status, 400); assert.match(b.data.error, /verkoopprijs per kg/);
  assert.equal(getDb().prepare('SELECT COUNT(*) c FROM leveranciers').get().c, 0, 'alles teruggedraaid');
  const body = alsBody(v); body.regels[0].filament.verkoopprijs_per_kg = '25';
  const ak = ok(await vraag('POST', `/inkoop/inlezen/${r.data.token}/bevestig`, body), 201);
  acId = ak.id;
  const a = ok(await vraag('GET', `/inkoop/aankopen/${ak.id}`));
  assert.deepEqual([a.status, a.bron, a.extern_factuurnummer, a.datum, a.leverancier, a.totaal, a.bijlagen.length, a.bijlagen[0].bestandsnaam],
    ['ontvangen', 'ocr', '16317', '2026-08-21', 'AC products', 16.27, 1, 'Ac Products.pdf']);
  const fils = ok(await vraag('GET', '/voorraad/artikelen?type=filament'));
  assert.deepEqual(fils.map(f => [f.weergave, f.voorraad, f.categorie]), [['eSUN PLA · Blauw', 1, 'Filament']]);
  const art = ok(await vraag('GET', `/voorraad/artikelen/${fils[0].id}`));
  assert.deepEqual([art.leveranciers[0].productcode, art.leveranciers[0].laatste_prijs], ['PLA-Basic175D-U1P1', 10.32]);
  const lev = ok(await vraag('GET', '/leveranciers'))[0];
  assert.deepEqual([lev.naam, lev.btw_nummer, lev.website], ['AC products', 'NL867451853B01', 'acproducts.nl']);
  // tijdelijk bestand is opgeruimd
  assert.equal((await fetch(`${basis}/inkoop/inlezen/${r.data.token}/bestand`)).status, 404);
});

test('dezelfde factuur opnieuw: leverancier en artikel herkend, dubbel geweigerd', async () => {
  const r = await lees(AC_PRODUCTS);
  const v = r.data.voorstel;
  assert.equal(v.leverancier.naam, 'AC products');
  assert.ok(v.leverancier.id);
  assert.deepEqual([v.regels[0].status, v.regels[0].via, v.regels[0].artikel.weergave], ['herkend', 'productcode', 'eSUN PLA · Blauw']);
  assert.ok(v.dubbel);
  const b = await vraag('POST', `/inkoop/inlezen/${r.data.token}/bevestig`, alsBody(v));
  assert.equal(b.status, 400); assert.match(b.data.error, /al ingelezen/);
  // leverancier ook herkend op btw-nummer als de naam anders geschreven is
  const r2 = await lees({ ...AC_PRODUCTS, leverancier: { naam: 'A.C. Products Hengelo', btw_nummer: 'nl 8674.51853 b01' }, factuurnummer: '16400' });
  assert.equal(r2.data.voorstel.leverancier.naam, 'AC products');
  assert.equal(r2.data.voorstel.dubbel, null);
});

test('Bambu Lab: nieuwe kleur, bestaande prijsgroep ontbreekt, niet meteen ontvangen', async () => {
  const r = await lees(BAMBU, 'BambuLab.pdf');
  const v = r.data.voorstel;
  assert.equal(v.klopt, true);
  assert.deepEqual(v.regels.map(x => x.status), ['nieuw', 'nieuw', 'kost']);
  assert.equal(v.regels[0].filament.kleur_id, null, 'Donkergroen bestaat nog niet');
  assert.equal(v.regels[0].filament.kleur_hex, '#1f5130');
  const body = alsBody(v, { meteen_ontvangen: false });
  body.regels[0].filament.verkoopprijs_per_kg = 32;
  body.regels[1].filament.verkoopprijs_per_kg = 28;
  const ak = ok(await vraag('POST', `/inkoop/inlezen/${r.data.token}/bevestig`, body), 201);
  const a = ok(await vraag('GET', `/inkoop/aankopen/${ak.id}`));
  assert.equal(a.status, 'besteld');
  const kleur = getDb().prepare(`SELECT hex FROM filament_kleuren WHERE naam = 'Donkergroen'`).get();
  assert.equal(kleur.hex, '#1f5130');
  // tweede Bambu-factuur met dezelfde codes: alles herkend
  const r2 = await lees({ ...BAMBU, factuurnummer: 'BBLEU-2' });
  assert.deepEqual(r2.data.voorstel.regels.map(x => x.status), ['herkend', 'herkend', 'kost']);
});

test('Joybuy: korting per regel, 10 regels, nieuwe kleuren en groepen; totaal klopt', async () => {
  const r = await lees(JOYBUY);
  const v = r.data.voorstel;
  assert.deepEqual([v.leverancier.id, v.regels.length, v.totaal_factuur, v.klopt], [null, 10, 98.89, true]);
  assert.equal(v.regels[1].prijs_per_eenheid, 8.245);
  // eSUN PLA · Zwart bestaat nog niet, maar de prijsgroep eSUN PLA wel (uit AC products)
  const zwart = v.regels[5];
  assert.deepEqual([zwart.status, zwart.filament.prijsgroep_bestaat], ['nieuw', true]);
  const body = alsBody(v);
  // één prijs per nieuwe prijsgroep volstaat (het scherm vult die bij alle regels van die groep in)
  body.regels[0].filament.verkoopprijs_per_kg = 22;      // AnyCubic PLA
  body.regels[8].filament.verkoopprijs_per_kg = 26;      // AnyCubic PETG
  const ak = ok(await vraag('POST', `/inkoop/inlezen/${r.data.token}/bevestig`, body), 201);
  const a = ok(await vraag('GET', `/inkoop/aankopen/${ak.id}`));
  assert.deepEqual([a.status, a.totaal, a.regels.length], ['ontvangen', 98.89, 10]);
  const fils = ok(await vraag('GET', '/voorraad/artikelen?type=filament'));
  assert.ok(fils.some(f => f.weergave === 'AnyCubic PLA · Textuurgrijs' && f.voorraad === 2));
  assert.ok(fils.some(f => f.weergave === 'eSUN PLA · Wit' && f.voorraad === 2));
  // zonder productcode onthoudt het ERP de omschrijving: de volgende keer herkend
  const r2 = await lees({ ...JOYBUY, factuurnummer: 'NL-2' });
  assert.ok(r2.data.voorstel.regels.filter(x => x.soort !== 'kost').every(x => x.status === 'herkend' && x.via === 'omschrijving'));
});

test('nieuw gewoon artikel + keuze van de gebruiker gaat voor wat onthouden was', async () => {
  const antwoord = { leverancier: { naam: 'AC products', btw_nummer: 'NL867451853B01' }, factuurnummer: 'X-1', datum: '2026-09-01', totaal_incl_btw: 3,
    regels: [{ soort: 'artikel', omschrijving: 'Sleutelringen 25mm 100 st', productcode: 'KR-25', aantal: 1, prijs_per_eenheid: 3, naam_voorstel: 'Sleutelring 25 mm', categorie_voorstel: 'Onderdelen' }] };
  let r = await lees(antwoord);
  let v = r.data.voorstel;
  assert.deepEqual([v.regels[0].status, v.regels[0].nieuw_artikel.naam], ['nieuw', 'Sleutelring 25 mm']);
  assert.ok(v.regels[0].nieuw_artikel.categorie_id);
  ok(await vraag('POST', `/inkoop/inlezen/${r.data.token}/bevestig`, alsBody(v)), 201);
  const ring = ok(await vraag('GET', '/voorraad/artikelen?type=artikel')).find(a => a.naam === 'Sleutelring 25 mm');
  assert.deepEqual([ring.categorie, ring.voorraad, ring.inkoopprijs], ['Onderdelen', 1, 3]);
  // volgende keer herkend; jij kiest nu een ander artikel → de code verhuist
  const ander = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelring 30 mm', wordt_gekocht: true }), 201).id;
  r = await lees({ ...antwoord, factuurnummer: 'X-2' });
  v = r.data.voorstel;
  assert.equal(v.regels[0].artikel_id, ring.id);
  const body = alsBody(v); body.regels[0].artikel_id = ander;
  ok(await vraag('POST', `/inkoop/inlezen/${r.data.token}/bevestig`, body), 201);
  r = await lees({ ...antwoord, factuurnummer: 'X-3' });
  assert.equal(r.data.voorstel.regels[0].artikel_id, ander);
});

test('fouten: Gemini faalt → nette melding, geen bestand; verkeerd type; onbekend token', async () => {
  const r = await lees(new Error('Gemini gaf een fout (429): quota'));
  assert.equal(r.status, 502); assert.match(r.data.error, /429/);
  const fd = new FormData(); fd.append('bestand', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
  const res = await fetch(`${basis}/inkoop/inlezen`, { method: 'POST', body: fd });
  assert.equal(res.status, 400);
  const b = await vraag('POST', '/inkoop/inlezen/00000000-0000-0000-0000-000000000000/bevestig', {});
  assert.equal(b.status, 404);
  assert.equal((await fetch(`${basis}/inkoop/inlezen/..%2F..%2Fetc/bestand`)).status, 404);
  assert.ok(acId);
});
