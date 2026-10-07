// 06-10: webshopproducten (Sanity, gemockt) overnemen, onderdelen per stuk
// afboeken bij de verkoop (en terug bij ongedaan), productoverzicht met kost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';

const echteFetch = globalThis.fetch;
let sanity = [];
let supabaseOrders = [];
let server, basis;
before(async () => {
  process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_KEY = 'sleutel';
  globalThis.fetch = async (url, o) => (String(url).includes('sanity.io')
    ? new Response(JSON.stringify({ result: sanity }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : String(url).includes('supabase.co')
      ? new Response(JSON.stringify(supabaseOrders), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : echteFetch(url, o));
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { globalThis.fetch = echteFetch; server.close(); stopWachter(); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await echteFetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
const voorraad = id => getDb().prepare('SELECT COALESCE(SUM(aantal_resterend),0) v FROM voorraad_partijen WHERE artikel_id = ?').get(id).v;
let egel, beeld10, ring, bestaand;
const jaar = new Date().getFullYear();

test('W1. ophalen: rijen per product en maatvariant, status nieuw / zelfde naam', async () => {
  bestaand = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelhanger hond', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 4 }), 201).id;
  sanity = [
    { _id: 'a', name: 'Happy Flappy Egel', slug: 'happy-flappy-egel', price: 12.5, categorie: 'Happy Flappy', foto: 'https://cdn/egel.jpg', weightGrams: 30 },
    { _id: 'b', name: 'Beeldje uil', slug: 'beeldje-uil', price: 15, categorie: 'Beeldjes', sizeVariants: [{ label: '10 cm', price: 15, weightGrams: 40 }, { label: '15 cm', price: 22, weightGrams: 90 }] },
    { _id: 'c', name: 'Sleutelhanger hond', slug: 'sleutelhanger-hond', price: 5, categorie: 'Sleutelhangers' },
    { _id: 'd', name: 'Geboortebord', slug: 'geboortebord', price: 45, priceFrom: true, customOrder: true, categorie: 'Geboorte' },
  ];
  const w = ok(await vraag('GET', '/producten/webshop'));
  assert.equal(w.producten.length, 5);
  const st = Object.fromEntries(w.producten.map(p => [p.naam, p.status]));
  assert.equal(st['Happy Flappy Egel'], 'nieuw'); assert.equal(st['Beeldje uil – 15 cm'], 'nieuw');
  assert.equal(st['Sleutelhanger hond'], 'zelfde_naam');
  assert.equal(w.producten.find(p => p.slug === 'geboortebord').maatwerk, true);
});

test('W2. overnemen: aanmaken, koppelen op naam, categorie onder Webshop; tweede keer bijwerken', async () => {
  const uit = ok(await vraag('POST', '/producten/webshop/overnemen', { sleutels: ['happy-flappy-egel|', 'beeldje-uil|10 cm', 'sleutelhanger-hond|'] }));
  assert.deepEqual(uit.map(u => u.actie).sort(), ['aangemaakt', 'aangemaakt', 'gekoppeld']);
  egel = uit.find(u => u.sleutel === 'happy-flappy-egel|').artikel_id;
  beeld10 = uit.find(u => u.sleutel === 'beeldje-uil|10 cm').artikel_id;
  const db = getDb();
  const a = db.prepare('SELECT a.*, c.naam cat, p.naam ouder FROM artikelen a JOIN categorieen c ON c.id = a.categorie_id JOIN categorieen p ON p.id = c.ouder_id WHERE a.id = ?').get(egel);
  assert.equal(a.zelf_geprint, 1); assert.equal(a.verkoopprijs, 12.5); assert.equal(a.cat, 'Happy Flappy'); assert.equal(a.ouder, 'Webshop');
  assert.equal(db.prepare('SELECT verkoopprijs, webshop_slug FROM artikelen WHERE id = ?').get(bestaand).verkoopprijs, 5, 'prijs uit de webshop');
  // prijs in de webshop gewijzigd → status gewijzigd → bijwerken
  sanity[0].price = 13;
  const w = ok(await vraag('GET', '/producten/webshop'));
  assert.equal(w.producten.find(p => p.slug === 'happy-flappy-egel').status, 'gewijzigd');
  assert.equal(ok(await vraag('POST', '/producten/webshop/overnemen', { sleutels: ['happy-flappy-egel|'] }))[0].actie, 'bijgewerkt');
  assert.equal(db.prepare('SELECT verkoopprijs FROM artikelen WHERE id = ?').get(egel).verkoopprijs, 13);
  // uit de webshop verdwenen → in "weg"
  sanity = sanity.filter(p => p.slug !== 'beeldje-uil');
  assert.deepEqual(ok(await vraag('GET', '/producten/webshop')).weg.map(x => x.id), [beeld10]);
});

test('W3. onderdelen per stuk: afboeken bij verkoop, tekort meldt maar blokkeert niet, ongedaan zet terug', async () => {
  ring = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelring 25 mm', wordt_gekocht: true }), 201).id;
  ok(await vraag('POST', `/voorraad/artikelen/${ring}/boeking`, { richting: 'in', aantal: 3, prijs_per_eenheid: 0.1, datum: '2026-09-01' }));
  assert.match((await vraag('PUT', `/producten/${bestaand}/onderdelen`, { onderdelen: [{ onderdeel_id: bestaand, aantal: 1 }] })).data.error, /zichzelf/);
  const o = ok(await vraag('PUT', `/producten/${bestaand}/onderdelen`, { onderdelen: [{ onderdeel_id: ring, aantal: 1 }] }));
  assert.equal(o[0].naam, 'Sleutelring 25 mm'); assert.equal(o[0].prijs, 0.1);
  ok(await vraag('POST', `/voorraad/artikelen/${bestaand}/boeking`, { richting: 'in', aantal: 5, prijs_per_eenheid: 0.5, datum: '2026-09-01' }));
  const v = ok(await vraag('POST', '/verkopen', { soort: 'bonnetje', nummer: `${jaar}-501`, datum: `${jaar}-09-15`, regels: [{ soort: 'artikel', artikel_id: bestaand, aantal: 4 }] }), 201);
  assert.equal(voorraad(ring), 0);
  assert.equal(v.tekort_onderdelen.length, 1); assert.match(v.tekort_onderdelen[0], /Sleutelring 25 mm \(1 te weinig/);
  assert.equal(v.kost, 2.3, '4 × 0,50 + 3 × 0,10');
  ok(await vraag('POST', `/verkopen/${v.id}/annuleer`));
  assert.equal(voorraad(ring), 3); assert.equal(voorraad(bestaand), 5);
});

test('W4. productoverzicht: geschatte kost uit profiel + onderdelen, marge', async () => {
  const db = getDb();
  const mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  ok(await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 100 }));
  const pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  const zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: db.prepare(`SELECT id FROM filament_kleuren WHERE naam = 'Zwart'`).get().id }), 201).id;
  ok(await vraag('POST', `/voorraad/artikelen/${zwart}/boeking`, { richting: 'in', aantal: 1, prijs_per_eenheid: 20, datum: '2026-09-01' }));
  ok(await vraag('PUT', `/productie/printprofiel/${bestaand}`, { profiel: { printer_id: mini, tijd_min: 30, per_plaat: 10, voorbereiding_min: 10, nabewerking_min: 1, materialen: [{ artikel_id: zwart, gram: 10 }] } }));
  const p = ok(await vraag('GET', '/producten')).find(x => x.id === bestaand);
  const rol = db.prepare('SELECT rolgewicht_g FROM filament_types WHERE id = ?').get(pg).rolgewicht_g;
  const t = Object.fromEntries(db.prepare('SELECT sleutel, waarde FROM tarieven').all().map(x => [x.sleutel, x.waarde]));
  const verwacht = 10 / 1000 * (20 / rol * 1000) + 0.1 * 0.5 * t.kwh_prijs + 0.5 * 0.2 + t.bmcu_per_job / 10 + 0.1;
  assert.ok(Math.abs(p.schatting.kost - verwacht) < 1e-3, `${p.schatting.kost} ≈ ${verwacht}`);
  assert.equal(p.webshop.slug, 'sleutelhanger-hond'); assert.equal(p.verkoopprijs, 5);
  assert.equal(p.marge, Math.round((5 - p.kost) * 100) / 100);
  assert.equal(p.verkocht_30d, 0, 'ongedane verkoop telt niet');
});

test('W5. webshopbestellingen: ophalen, koppelen aan artikel, verkoop maakt ze afgehandeld', async () => {
  supabaseOrders = [{ id: 'abc-1', created_at: '2026-10-07T10:00:00Z', status: 'paid', customer_name: 'Jan', customer_email: 'jan@x.be', street: 'Straat 1', postal_city: '8700 Tielt',
    items: [{ slug: 'sleutelhanger-hond', name: 'Sleutelhanger hond', quantity: 2, price: 5, variantLabel: null, colors: ['Rood'] }], total: 14.5, shipping_method_label: 'Bpost', shipping_price: 4.5 }];
  assert.equal(ok(await vraag('POST', '/webshopbestellingen/ophalen')).nieuw, 1);
  assert.equal(ok(await vraag('POST', '/webshopbestellingen/ophalen')).nieuw, 0, 'niet dubbel');
  const l = ok(await vraag('GET', '/webshopbestellingen'));
  const b = l.bestellingen[0];
  assert.equal(b.items[0].artikel.id, bestaand); assert.deepEqual(b.items[0].kleuren, ['Rood']); assert.equal(b.afgehandeld, false);
  ok(await vraag('POST', `/voorraad/artikelen/${bestaand}/boeking`, { richting: 'in', aantal: 2, prijs_per_eenheid: 0.5, datum: '2026-09-01' }));
  const v = ok(await vraag('POST', '/verkopen', { soort: 'bonnetje', nummer: `${jaar}-777`, datum: `${jaar}-10-07`, webshop_bestelling: 'abc-1',
    regels: [{ soort: 'artikel', artikel_id: bestaand, aantal: 2, prijs_per_stuk: 5 }] }), 201);
  const na = ok(await vraag('GET', '/webshopbestellingen')).bestellingen[0];
  assert.equal(na.afgehandeld, true); assert.equal(na.verkoop_id, v.id);
});
