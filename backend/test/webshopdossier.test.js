// 25-10: webshopbestelling → klant + klantdossier met printregels uit het
// printprofiel (filament van de kleur, slicerbestand, webshopprijs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';
import { bewaarBestellingen } from '../domein/webshopbestellingen.js';

const echteFetch = globalThis.fetch;
let kleurenSanity = [];
let server, basis;
before(async () => {
  globalThis.fetch = async (url, o) => (String(url).includes('sanity.io')
    ? new Response(JSON.stringify({ result: kleurenSanity }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

test('WD1. bestelling → klant + dossier: gekozen lijnen, profiel, kleur → filament, slicerbestand, webshopprijs', async () => {
  const db = getDb();
  ok(await vraag('PUT', '/printers/1', { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 }));
  const pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  const kleur = db.prepare(`SELECT id, naam FROM filament_kleuren WHERE naam = 'Wit'`).get();
  const wit = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: kleur.id }), 201).id;
  const { merk, materiaal } = db.prepare(`SELECT m.naam merk, mat.naam materiaal FROM filament_types ft JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id WHERE ft.id = ?`).get(pg);
  kleurenSanity = [{ label: 'Oud roze', slug: 'oud-roze', hex: '#e8b4b8', filamentName: `${merk} ${materiaal} — Wit` }];

  const maak = async (naam, slug, extra = {}) => ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam, zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 10, ...extra }), 201).id;
  const deur = await maak('Deurhanger', 'deurhanger');
  const sh = await maak('Sleutelhanger WD', 'sh');
  const lamp = await maak('Lamp WD', 'lamp');
  for (const [id, slug] of [[deur, 'deurhanger'], [sh, 'sh'], [lamp, 'lamp']]) db.prepare('UPDATE artikelen SET webshop_slug = ? WHERE id = ?').run(slug, id);
  ok(await vraag('POST', `/voorraad/artikelen/${sh}/boeking`, { richting: 'in', aantal: 5, prijs_per_eenheid: 1, reden: 'productie' }));
  // slicerbestand bij het artikel + printprofiel
  const fd = new FormData(); fd.append('bestand', new Blob(['3mf-inhoud']), 'deurhanger.gcode.3mf');
  const bijlage = (await (await echteFetch(`${basis}/bijlagen/artikel/${deur}`, { method: 'POST', body: fd })).json()).id;
  ok(await vraag('PUT', `/productie/printprofiel/${deur}`, { profiel: { printer_id: 1, tijd_min: 60, per_plaat: 1, materialen: [{ filament_type_id: pg, gram: 20 }], slicer_bijlage_id: bijlage, slicer_plaat: 1 } }));

  bewaarBestellingen(db, [{ id: 'o1', created_at: '2026-10-24T19:33:00Z', customer_name: 'Maya Mathys', customer_email: 'maya@voorbeeld.be', customer_phone: '0497 80 92 97',
    street: 'Kerkstraat 5', postal_city: '9000 Gent', country: 'BE', shipping_method_label: 'Bpost thuis', total: 40.5, shipping_price: 5,
    items: [{ slug: 'deurhanger', name: 'Deurhanger (Naam: "Romy")', quantity: 1, price: 12.5, text: 'Romy', font: 'Pacifico', color: 'Oud roze' },
      { slug: 'sh', name: 'Sleutelhanger', quantity: 2, price: 3 }, { slug: 'lamp', name: 'Lamp', quantity: 1, price: 20 }] }]);

  const r = ok(await vraag('POST', '/webshopbestellingen/o1/dossier', {}), 201);
  assert.equal(r.klant_nieuw, true);
  assert.equal(r.waarschuwingen.length, 1, JSON.stringify(r.waarschuwingen));
  assert.match(r.waarschuwingen[0], /Lamp WD.*geen printprofiel/);
  const k = db.prepare('SELECT * FROM klanten WHERE id = ?').get(r.klant_id);
  assert.deepEqual([k.voornaam, k.naam, k.email, k.gsm, k.straat, k.huisnummer, k.postcode, k.gemeente, k.land], ['Maya', 'Mathys', 'maya@voorbeeld.be', '0497 80 92 97', 'Kerkstraat', '5', '9000', 'Gent', null]);

  const d = ok(await vraag('GET', `/dossiers/${r.dossier_id}`));
  assert.equal(d.soort, 'klant'); assert.equal(d.klant_id, r.klant_id);
  assert.equal(d.regels.length, 2, 'deurhanger + lamp; de sleutelhanger ligt op voorraad');
  const [rd, rl] = d.regels;
  assert.match(rd.omschrijving, /Romy.*Lettertype: Pacifico/);
  assert.equal(rd.artikel_id, deur);
  assert.deepEqual(rd.materialen, [{ artikel_id: wit, gram: 20 }], 'kleur Oud roze → filament');
  assert.equal(rd.handmatig_bedrag, 12.5);
  const b = db.prepare('SELECT * FROM bijlagen WHERE id = ?').get(rd.slicer_bijlage_id);
  assert.deepEqual([b.entiteit, b.entiteit_id, b.bestandsnaam], ['dossier', r.dossier_id, 'deurhanger.gcode.3mf']);
  assert.equal(rd.slicer_plaat, 1);
  assert.equal(d.berekening.regels[0]._berekend.eindbedrag, 12.5);
  assert.equal(rl.artikel_id, lamp); assert.equal(rl.handmatig_bedrag, 20);
  assert.ok(d.berekening.regels[1]._berekend.fout, 'zonder profiel: onvolledig tot aangevuld');

  const lijst = ok(await vraag('GET', '/webshopbestellingen')).bestellingen;
  assert.equal(lijst[0].dossier_nummer, d.nummer);
  assert.deepEqual(lijst[0].items.map(i => i.in_dossier), [true, false, true]);
  assert.match((await vraag('POST', '/webshopbestellingen/o1/dossier', {})).data.error, /al een dossier/);
});

test('WD2. bestaande klant (e-mail) hergebruikt; zelf gekozen lijnen; afhaalpunt = geen adres', async () => {
  const db = getDb();
  bewaarBestellingen(db, [{ id: 'o2', created_at: '2026-10-25T10:00:00Z', customer_name: 'Maya Mathys', customer_email: 'MAYA@voorbeeld.be', street: 'Guldeland 15', postal_city: '9950', country: 'BE',
    shipping_method_label: 'Mondial Relay — afhaalpunt', total: 6, items: [{ slug: 'sh', name: 'Sleutelhanger', quantity: 2, price: 3 }] }]);
  const voor = db.prepare('SELECT COUNT(*) n FROM klanten').get().n;
  const r = ok(await vraag('POST', '/webshopbestellingen/o2/dossier', { items: [0] }), 201);
  assert.equal(r.klant_nieuw, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM klanten').get().n, voor);
  assert.equal(ok(await vraag('GET', `/dossiers/${r.dossier_id}`)).regels[0].aantal, 2);
  bewaarBestellingen(db, [{ id: 'o3', customer_name: 'Jan', customer_email: 'jan@voorbeeld.be', street: 'Guldeland 15', postal_city: '9950 Lievegem', country: 'BE', shipping_method_label: 'Mondial Relay afhaalpunt', items: [{ slug: 'sh', name: 'Sleutelhanger', quantity: 1, price: 3 }] }]);
  assert.match((await vraag('POST', '/webshopbestellingen/o3/dossier', {})).data.error, /minstens één lijn/, 'op voorraad: standaard niets te printen');
  const r3 = ok(await vraag('POST', '/webshopbestellingen/o3/dossier', { items: [0] }), 201);
  const k = db.prepare('SELECT naam, voornaam, straat FROM klanten WHERE id = ?').get(r3.klant_id);
  assert.deepEqual([k.naam, k.voornaam, k.straat], ['Jan', null, null], 'afhaalpunt is niet het adres van de klant');
});
