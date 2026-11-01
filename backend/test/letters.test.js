// 29-10: bubble letters voor een wederverkoper — prijsafspraak per klant,
// letterprofiel (plaat per letter), lijst inlezen (per naam / per kleur).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';
import { leesLetterlijst } from '../domein/letters.js';
import { filamentKaart, norm } from '../domein/webshopdossier.js';
import { wisPaletCache } from '../integraties/kleurenpalet.js';
import { bewaarBestellingen } from '../domein/webshopbestellingen.js';

const echteFetch = globalThis.fetch;
let palet = [];
let server, basis;
before(async () => {
  globalThis.fetch = async (url, o) => (String(url).includes('sanity.io')
    ? new Response(JSON.stringify({ result: palet }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
let klant, letter, ring;

test('L1. prijsafspraak per klant: printregel en artikelregel aan de afgesproken prijs; eigen eindbedrag gaat voor', async () => {
  ok(await vraag('PUT', '/printers/1', { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 }));
  klant = ok(await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'Wederverkoper BV' }), 201).id;
  letter = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Bubble letter', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 3 }), 201).id;
  ring = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Ring L1', wordt_gekocht: true, wordt_verkocht: true, verkoopprijs: 0.5 }), 201).id;
  assert.equal((await vraag('PUT', `/klanten/${klant}/prijzen`, { prijzen: [{ artikel_id: letter, prijs: '' }] })).status, 400);
  const p = ok(await vraag('PUT', `/klanten/${klant}/prijzen`, { prijzen: [{ artikel_id: letter, prijs: '1,75' }, { artikel_id: ring, prijs: 0.4 }] }));
  assert.deepEqual(p.map(x => [x.naam, x.prijs]), [['Bubble letter', 1.75], ['Ring L1', 0.4]]);

  const regels = [{ type: 'printen', omschrijving: 'E – roze', printer_id: 1, aantal: 4, tijd_min: 120, artikel_id: letter },
    { type: 'artikel', artikel_id: ring, aantal: 10 }];
  const d = ok(await vraag('POST', '/dossiers', { titel: 'Letters', klant_id: klant, regels }), 201);
  const [r1, r2] = d.berekening.regels.map(r => r._berekend);
  assert.equal(r1.eindbedrag, 7); assert.equal(r1.afspraak, 1.75);
  assert.equal(r2.eindbedrag, 4);
  assert.equal(d.berekening.totaal, 11);
  assert.ok(Math.abs(d.berekening.prijsopbouw.afspraak) > 0);
  // eigen eindbedrag gaat voor
  const zelf = ok(await vraag('POST', '/bereken', { regels: [{ ...regels[0], handmatig_bedrag: 9 }], klant_id: klant }));
  assert.equal(zelf.totaal, 9);
  // andere klant: gewone berekening
  const ander = ok(await vraag('POST', '/bereken', { regels: [regels[0]] }));
  assert.notEqual(ander.totaal, 7);
  ok(await vraag('PUT', `/klanten/${klant}/prijzen`, { prijzen: [{ artikel_id: letter, prijs: 1.75 }] }));
});

test('L1b. printregel uit een product in een klantdossier: verkoopprijs van het product (webshop); andere platen 0; afspraak en eigen eindbedrag gaan voor', async () => {
  const elf = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Gebreid meisje', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 12.5 }), 201).id;
  const regels = [{ type: 'printen', omschrijving: 'romp', printer_id: 1, aantal: 2, tijd_min: 300, plaat_van: elf },
    { type: 'printen', omschrijving: 'Gebreid meisje', printer_id: 1, aantal: 2, tijd_min: 200, artikel_id: elf }];
  const andere = ok(await vraag('POST', '/klanten', { type: 'particulier', naam: 'Claes' }), 201).id;
  const d = ok(await vraag('POST', '/dossiers', { titel: 'Elfjes', klant_id: andere, regels }), 201);
  const [p1, p2] = d.berekening.regels.map(r => r._berekend);
  assert.deepEqual([p1.eindbedrag, p1.productprijs, p2.eindbedrag, p2.productprijs], [0, 0, 25, 12.5]);
  assert.equal(d.berekening.totaal, 25);
  assert.ok(Math.abs(d.berekening.prijsopbouw.productprijs) > 0);
  // eigen eindbedrag gaat voor
  const zelf = ok(await vraag('POST', '/bereken', { regels: [regels[0], { ...regels[1], handmatig_bedrag: 20 }], klant_id: andere }));
  assert.equal(zelf.totaal, 20);
  // voorraaddossier: gewone berekening (kost)
  const eigen = ok(await vraag('POST', '/bereken', { regels, onderdelen: false }));
  assert.ok(eigen.regels[1]._berekend.productprijs === undefined && eigen.totaal !== 25);
  // prijsafspraak van de klant gaat voor de verkoopprijs
  const afs = ok(await vraag('POST', '/bereken', { regels: [{ type: 'printen', printer_id: 1, aantal: 4, tijd_min: 120, artikel_id: letter }], klant_id: klant }));
  assert.equal(afs.totaal, 7);
});

test('L2. letterprofiel: plaat per letter, letters verplicht en uniek; kost = gemiddelde letter', async () => {
  const db = getDb();
  const pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  const plaat = (letter, min, g, nr) => ({ letter, naam: `Letter ${letter}`, printer_id: 1, tijd_min: min, per_plaat: 1, slicer_plaat: nr, materialen: [{ filament_type_id: pg, gram: g }] });
  assert.match((await vraag('PUT', `/productie/printprofiel/${letter}`, { profiel: { letters: true, platen: [plaat('A', 60, 20, 1), plaat('a', 50, 18, 2)] } })).data.error, /A staat er twee keer/);
  assert.match((await vraag('PUT', `/productie/printprofiel/${letter}`, { profiel: { letters: true, platen: [plaat('', 60, 20, 1)] } })).data.error, /vul de letter/);
  const p = ok(await vraag('PUT', `/productie/printprofiel/${letter}`, { profiel: { letters: true, platen: [plaat('A', 60, 20, 1), plaat('É', 90, 30, 2), plaat('M', 120, 40, 3), plaat('&', 30, 10, 4)] } })).profiel;
  assert.equal(p.letters, true); assert.deepEqual(p.platen.map(x => x.letter), ['A', 'É', 'M', '&']);
  const k = ok(await vraag('GET', `/producten/${letter}/kost`));
  assert.equal(k.per_stuk.bron, 'geschat');
  const lijst = ok(await vraag('GET', '/productie/printprofielen')).find(x => x.id === letter);
  assert.deepEqual(lijst.letters, ['A', 'É', 'M', '&']);
  assert.equal(lijst.profiel.tijd_min, 75, 'Uit product: de gemiddelde letter');
  assert.equal(lijst.profiel.materialen[0].gram, 25);
  void db;
});

test('L3. lijst per naam inlezen → voorbeeld, kleuren via het webshoppalet en onthouden; regels per letter × kleur', async () => {
  const db = getDb();
  const kl = n => db.prepare('SELECT id FROM filament_kleuren WHERE naam = ?').get(n).id;
  const pg = db.prepare('SELECT id FROM filament_types ORDER BY id DESC LIMIT 1').get().id;
  const wit = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: kl('Wit') }), 201).id;
  const zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: kl('Zwart') }), 201).id;
  const { merk, materiaal } = db.prepare(`SELECT m.naam merk, mat.naam materiaal FROM filament_types ft JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id WHERE ft.id = ?`).get(pg);
  palet = [{ label: 'Oat', slug: 'oat', filamentName: `${merk} ${materiaal} — Wit` }];
  const tekst = 'MAÉ\nM – Oat v\nA – Zwartig\nÉ – Oat\nAM & MA: oat';
  const v = ok(await vraag('POST', '/dossiers/letters/voorbeeld', { tekst, artikel_id: letter }));
  assert.equal(v.bron, 'naam'); assert.equal(v.totaal, 8); assert.deepEqual(v.zonder_plaat, []);
  assert.deepEqual(v.kleuren.map(k => k.label).sort(), ['Oat', 'Zwartig'], '"Oat" en "oat" = één kleur');
  const oat = v.kleuren.find(k => k.label === 'Oat'), zw = v.kleuren.find(k => k.label === 'Zwartig');
  assert.equal(oat.filament_id, wit); assert.equal(oat.bron, 'webshop');
  assert.equal(zw.filament_id, null);
  assert.match((await vraag('POST', '/dossiers/letters/voorbeeld', { tekst: 'Q – Oat', artikel_id: letter })).data.zonder_plaat.join(), /Q/);

  const d = ok(await vraag('POST', '/dossiers', { titel: 'Letters wederverkoper', klant_id: klant, regels: [] }), 201);
  assert.match((await vraag('POST', `/dossiers/${d.id}/letters`, { tekst, artikel_id: letter })).data.error, /Kies het filament voor: Zwartig/);
  const r = ok(await vraag('POST', `/dossiers/${d.id}/letters`, { tekst, artikel_id: letter, kleuren: { Zwartig: zwart } }), 201);
  assert.equal(r.letters, 8);
  const regels = r.dossier.regels;
  const mOat = regels.find(x => x.omschrijving === 'Bubble letter M – Oat');
  assert.equal(mOat.aantal, 3, 'M van MAÉ + 2× in "AM & MA"');
  assert.deepEqual(mOat.materialen, [{ artikel_id: wit, gram: 120 }], 'eigen plaat M (40 g) × 3, filament Oat');
  assert.equal(mOat.tijd_min, 360); assert.equal(mOat.artikel_id, letter);
  assert.equal(regels.find(x => x.omschrijving === 'Bubble letter A – Zwartig').materialen[0].artikel_id, zwart);
  assert.equal(r.dossier.berekening.totaal, 14, '8 letters × € 1,75 (prijsafspraak)');
  assert.equal(r.dossier.letters.length, 1);
  assert.deepEqual(r.dossier.letters[0].namen.map(n => n.naam), ['MAÉ', 'AM & MA']);
  // gekozen kleuren onthouden
  const v2 = ok(await vraag('POST', '/dossiers/letters/voorbeeld', { tekst: 'Zwartig: A', artikel_id: letter }));
  assert.equal(v2.bron, 'kleur'); assert.equal(v2.kleuren[0].filament_id, zwart); assert.equal(v2.kleuren[0].bron, 'onthouden');
  // tweede lijst erbij → extra regels, tweede bestelling bewaard
  const r2 = ok(await vraag('POST', `/dossiers/${d.id}/letters`, { tekst: 'Zwartig: A A', artikel_id: letter }), 201);
  assert.equal(r2.dossier.letters.length, 2);
  assert.equal(r2.dossier.regels.length, regels.length + 1);
});

test('L4. de mail van het letterformulier op de webshop plakken: kopregels en opmerkingen overslaan, naam of losse letter in één kleur', () => {
  const r = leesLetterlijst(`Product: Bubble Letter
Besteller: Verhoye anja (x@y.be)

Bestelde letters (totaal 6):
- "L" in Zacht oranje (1 letters)
- "C" in Butter cream (geel) (1 letters)
- "Emma" in Lichtroze (4 letters)

Opmerkingen:
graag tegen vrijdag`);
  assert.deepEqual(r.waarschuwingen, []);
  assert.deepEqual(r.namen.map(n => n.naam), ['EMMA']);
  assert.deepEqual(r.items.map(i => `${i.letter}:${i.kleur}:${i.aantal}`), ['C:Butter cream (geel):1', 'A:Lichtroze:1', 'E:Lichtroze:1', 'M:Lichtroze:2', 'L:Zacht oranje:1']);
});

test('L5. zelf gekozen filament bij een webshopkleur wordt onthouden bij de webshopnaam (ook voor webshopbestellingen)', async () => {
  const db = getDb();
  const zwart = db.prepare(`SELECT a.id FROM artikelen a JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.type = 'filament' AND k.naam = 'Zwart'`).get().id;
  wisPaletCache();
  palet = [{ label: 'Zacht oranje', slug: 'zacht-oranje', filamentName: 'Polymaker Panchroma PLA Matte — Pastel Peach' }];
  const v = ok(await vraag('POST', '/dossiers/letters/voorbeeld', { tekst: 'Zacht oranje: A', artikel_id: letter }));
  assert.equal(v.kleuren[0].filament_id, null, 'naam van de webshop niet gekend in Voorraad');
  const d = ok(await vraag('POST', '/dossiers', { titel: 'Peach', klant_id: klant, regels: [] }), 201);
  ok(await vraag('POST', `/dossiers/${d.id}/letters`, { tekst: 'Zacht oranje: A', artikel_id: letter, kleuren: { 'Zacht oranje': zwart } }), 201);
  assert.equal(filamentKaart(db).get(norm('Polymaker Panchroma PLA Matte — Pastel Peach')), zwart);
  // een ander label met dezelfde webshopnaam: meteen herkend
  wisPaletCache();
  palet = [{ label: 'Perzik', slug: 'perzik', filamentName: 'Polymaker Panchroma PLA Matte — Pastel Peach' }];
  const v2 = ok(await vraag('POST', '/dossiers/letters/voorbeeld', { tekst: 'Perzik: A', artikel_id: letter }));
  assert.deepEqual([v2.kleuren[0].filament_id, v2.kleuren[0].bron], [zwart, 'webshop']);
});

test('L6. webshopbestelling met letters → klantdossier met letterregels (per letter × kleur); onbekende kleur → lijst in de notities', async () => {
  const db = getDb();
  db.prepare('UPDATE artikelen SET webshop_slug = ? WHERE id = ?').run('bubble-letter', letter);
  wisPaletCache();
  palet = [{ label: 'Oat', slug: 'oat', filamentName: 'iets onbekends' }];
  const wit = db.prepare(`SELECT a.id FROM artikelen a JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.type = 'filament' AND k.naam = 'Wit'`).get().id;
  bewaarBestellingen(db, [{ id: 'let1', created_at: '2026-11-01T10:00:00Z', customer_name: 'Anja Verhoye', customer_email: 'anja@voorbeeld.be', customer_phone: '0470000000',
    street: 'Dorp 1', postal_city: '9000 Gent', country: 'BE', shipping_method_label: 'Bpost', total: 10, shipping_price: 3.25, notes: 'Bubble Letter: graag tegen vrijdag',
    items: [{ slug: 'bubble-letter', name: 'Bubble letter ("MA" in Oat, "A" in Oat)', quantity: 3, price: 1.75, letters: [{ text: 'MA', color: 'Oat' }, { text: 'A', color: 'Oat' }], note: 'graag tegen vrijdag' }] }]);
  const r = ok(await vraag('POST', '/webshopbestellingen/let1/dossier', {}), 201);
  assert.deepEqual(r.waarschuwingen, []);
  const d = ok(await vraag('GET', `/dossiers/${r.dossier_id}`));
  assert.deepEqual(d.regels.map(x => [x.omschrijving, x.aantal, x.materialen[0]?.artikel_id]).sort(), [['Bubble letter A – Oat', 2, wit], ['Bubble letter M – Oat', 1, wit]]);
  assert.equal(d.berekening.totaal, 5.25, '3 letters × € 1,75');
  assert.deepEqual(d.letters[0].namen.map(n => n.naam), ['MA']);
  assert.match(d.notities, /graag tegen vrijdag/);
  // onbekende kleur: geen regels, wel de lijst in de notities + waarschuwing
  bewaarBestellingen(db, [{ id: 'let2', created_at: '2026-11-01T11:00:00Z', customer_name: 'Bart Test', customer_email: 'bart@voorbeeld.be', total: 2, shipping_price: 0,
    items: [{ slug: 'bubble-letter', name: 'Bubble letter', quantity: 1, price: 1.75, letters: [{ text: 'A', color: 'Neon' }] }] }]);
  const r2 = ok(await vraag('POST', '/webshopbestellingen/let2/dossier', {}), 201);
  assert.match(r2.waarschuwingen.join(), /kies het filament voor Neon/);
  const d2 = ok(await vraag('GET', `/dossiers/${r2.dossier_id}`));
  assert.equal(d2.regels.length, 0);
  assert.match(d2.notities, /- "A" in Neon \(1 letters\)/);
});
