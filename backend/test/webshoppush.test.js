// 11-10: webshopvelden in het ERP → push naar Sanity (met een nagebootste Sanity)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { initDb, sluitDb, getDb, bijlagenMap } from '../db/index.js';
import { leesWebshop, bewaarWebshop, pushWebshop, slugVan, LAYER_LEAF_SJABLOON, maakKeuzeArtikel, maakAlleKeuzeArtikels } from '../domein/webshoppush.js';

// nagebootste Sanity: documenten in een Map, GROQ enkel voor de paar vragen die de push stelt
const docs = new Map();
let teller = 0, uploads = 0;
async function nep(url, opties = {}) {
  const u = new URL(url);
  const antwoord = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
  if (u.pathname.includes('/assets/images/')) { uploads++; return antwoord({ document: { _id: `image-${++teller}` } }); }
  if (u.pathname.includes('/data/mutate/')) {
    for (const m of JSON.parse(opties.body).mutations) {
      if (m.create) docs.set(m.create._id, { ...m.create, _updatedAt: `t${++teller}` });
      if (m.patch) { const d = docs.get(m.patch.id); Object.assign(d, m.patch.set, { _updatedAt: `t${++teller}` }); for (const k of m.patch.unset || []) delete d[k]; }
    }
    return antwoord({ results: [] });
  }
  const q = u.searchParams.get('query');
  const p = k => JSON.parse(u.searchParams.get(`$${k}`));
  if (q.startsWith('count(*[_type == "product" && slug.current')) return antwoord({ result: [...docs.values()].filter(d => d.slug?.current === p('s')).length });
  if (q.startsWith('count(*[_id == $id])')) return antwoord({ result: docs.has(p('id')) ? 1 : 0 });
  if (q.startsWith('*[_id == $id][0]')) { const d = docs.get(p('id')); return antwoord({ result: d ? { _id: d._id, _updatedAt: d._updatedAt, slug: d.slug?.current } : null }); }
  return antwoord({ result: null });
}

let art, foto;
before(() => {
  initDb(':memory:');
  process.env.SANITY_TOKEN = 'test';
  const db = getDb();
  art = Number(db.prepare(`INSERT INTO artikelen (type, naam, zelf_geprint, wordt_verkocht, verkoopprijs) VALUES ('artikel', 'Theelichthouder herfst', 1, 1, 14.5)`).run().lastInsertRowid);
  fs.mkdirSync(bijlagenMap(), { recursive: true });
  fs.writeFileSync(path.join(bijlagenMap(), 'webshop-test.png'), Buffer.from([1, 2, 3]));
  foto = Number(db.prepare(`INSERT INTO bijlagen (entiteit, entiteit_id, bestandsnaam, pad, mimetype, grootte) VALUES ('artikel', ?, 'eigen.png', 'webshop-test.png', 'image/png', 3)`).run(art).lastInsertRowid);
});
after(() => { delete process.env.SANITY_TOKEN; sluitDb(); });

test('W1. slug uit de naam', () => {
  assert.equal(slugVan('Theelichthouder – Herfst & Eikel'), 'theelichthouder-herfst-en-eikel');
});

test('W2. nieuw product: ontbrekende velden → fout; daarna aangemaakt, verborgen, met foto', async () => {
  const db = getDb();
  const l = await leesWebshop(db, art, { fetchFn: nep });
  assert.equal(l.bron, 'nieuw'); assert.equal(l.data.hidden, true);
  bewaarWebshop(db, art, { ...l.data, description: '' });
  await assert.rejects(pushWebshop(db, art, { fetchFn: nep }), /beschrijving, een categorie/);
  bewaarWebshop(db, art, { ...l.data, description: 'Sfeervol\n\nVoor binnen.', category_id: 'cat-herfst', image_bijlage_id: foto, allowedColors: ['kleur-1'] });
  const r = await pushWebshop(db, art, { fetchFn: nep });
  assert.equal(r.nieuw, true); assert.equal(r.slug, 'theelichthouder-herfst'); assert.equal(r.verborgen, true);
  const a = db.prepare('SELECT * FROM artikelen WHERE id = ?').get(art);
  const d = docs.get(a.webshop_sanity_id);
  assert.equal(d.name, 'Theelichthouder herfst'); assert.equal(d.price, 14.5); assert.equal(d.hidden, true);
  assert.equal(d.category._ref, 'cat-herfst'); assert.ok(d.image.asset._ref.startsWith('image-'));
  assert.equal(d.allowedColors[0]._ref, 'kleur-1');
  assert.equal(a.webshop_slug, 'theelichthouder-herfst');
});

test('W3. bijwerken; in Sanity gewijzigd → 409, forceren overschrijft; foto niet opnieuw opgeladen', async () => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM artikelen WHERE id = ?').get(art);
  db.prepare('UPDATE artikelen SET verkoopprijs = 16 WHERE id = ?').run(art);
  const voor = uploads;
  await pushWebshop(db, art, { fetchFn: nep });
  assert.equal(docs.get(a.webshop_sanity_id).price, 16);
  assert.equal(uploads, voor, 'foto niet opnieuw opgeladen');
  docs.get(a.webshop_sanity_id)._updatedAt = 'iemand-anders';
  await assert.rejects(pushWebshop(db, art, { fetchFn: nep }), e => e.status === 409);
  const r = await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  assert.equal(r.nieuw, false);
});

test('W9. Layer & Leaf: standaard in de beschrijving (ook in een subcategorie), niet dubbel, melding zolang leeg', async () => {
  const db = getDb();
  const ll = Number(db.prepare(`INSERT INTO categorieen (naam) VALUES ('Layer & Leaf')`).run().lastInsertRowid);
  const sub = Number(db.prepare(`INSERT INTO categorieen (naam, ouder_id) VALUES ('Katten', ?)`).run(ll).lastInsertRowid);
  const id = Number(db.prepare(`INSERT INTO artikelen (type, naam, zelf_geprint, wordt_verkocht, verkoopprijs, categorie_id) VALUES ('artikel', 'Japandi kat', 1, 1, 12, ?)`).run(sub).lastInsertRowid);
  const w = await leesWebshop(db, id, { fetchFn: nep });
  assert.equal(w.data.description, LAYER_LEAF_SJABLOON);
  bewaarWebshop(db, id, { ...w.data, description: `Zittende kat.\n\n${LAYER_LEAF_SJABLOON}` });
  assert.equal((await leesWebshop(db, id, { fetchFn: nep })).data.description.match(/Standaardkleur/g).length, 1, 'niet dubbel');
  bewaarWebshop(db, id, { ...w.data, description: 'Zittende kat.' });
  assert.match((await leesWebshop(db, id, { fetchFn: nep })).data.description, /^Zittende kat\.\n\nStandaardkleur:/, 'achter een bestaande tekst');
  assert.equal((await leesWebshop(db, art, { fetchFn: nep })).data.description.includes('Standaardkleur'), false, 'andere categorie: niets');
});

test('W10. naam/tekst en lettertype: bewaard, onbekend lettertype valt weg, mee in de push; leeg label/max = weg uit Sanity', async () => {
  const db = getDb();
  const w = await leesWebshop(db, art, { fetchFn: nep });
  bewaarWebshop(db, art, { ...w.data, textChoice: true, textLabel: 'Naam op de sleutelhanger', textMaxLength: '12', fontChoice: true, allowedFonts: ['Lobster', 'Comic Sans', 'Bebas Neue'] });
  const l = await leesWebshop(db, art, { fetchFn: nep });
  assert.equal(l.data.textMaxLength, 12); assert.deepEqual(l.data.allowedFonts, ['Lobster', 'Bebas Neue']);
  await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  const d = docs.get(db.prepare('SELECT webshop_sanity_id i FROM artikelen WHERE id = ?').get(art).i);
  assert.equal(d.textChoice, true); assert.equal(d.fontChoice, true); assert.equal(d.textLabel, 'Naam op de sleutelhanger');
  assert.equal(d.textMaxLength, 12); assert.deepEqual(d.allowedFonts, ['Lobster', 'Bebas Neue']);
  bewaarWebshop(db, art, { ...l.data, textLabel: '', textMaxLength: '' });
  await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  assert.equal(d.textLabel, undefined); assert.equal(d.textMaxLength, undefined);
});

test('W11. symbool na de naam: vinkje mee in de push; bestelling toont naam, lettertype en symbool', async () => {
  const db = getDb();
  const w = await leesWebshop(db, art, { fetchFn: nep });
  bewaarWebshop(db, art, { ...w.data, symbolChoice: true });
  await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  assert.equal(docs.get(db.prepare('SELECT webshop_sanity_id i FROM artikelen WHERE id = ?').get(art).i).symbolChoice, true);
  const { bewaarBestellingen, leesBestellingen } = await import('../domein/webshopbestellingen.js');
  bewaarBestellingen(db, [{ id: 'ord-sym', status: 'paid', items: [{ slug: 'x', name: 'Sleutelhanger', quantity: 1, price: 6.5, text: 'Lotte', font: 'Lobster', symbol: 'pootje' }] }]);
  const i = leesBestellingen(db, { alles: true }).find(b => b.id === 'ord-sym').items[0];
  assert.equal(i.tekst, 'Lotte'); assert.equal(i.lettertype, 'Lobster'); assert.equal(i.symbool, 'hondenpootje');
});

test('W12. keuzes (modellen): null = Sanity ongemoeid; lijst = gepusht met foto; leeg = weg; dubbele naam en zonder prijs geweigerd', async () => {
  const db = getDb();
  const id = () => db.prepare('SELECT webshop_sanity_id i FROM artikelen WHERE id = ?').get(art).i;
  // vanuit het ERP aangemaakt → het ERP beheert de keuzes (lege lijst)
  assert.deepEqual((await leesWebshop(db, art, { fetchFn: nep })).data.sizeVariants, []);
  // keuzes onbekend (bv. bewaard vóór 19-10) en niet op te halen uit Sanity → null → niets aan sizeVariants
  bewaarWebshop(db, art, { ...(await leesWebshop(db, art, { fetchFn: nep })).data, sizeVariants: undefined });
  const w = await leesWebshop(db, art, { fetchFn: nep });
  assert.equal(w.data.sizeVariants, null);
  docs.get(id()).sizeVariants = [{ _key: 'x', label: 'In Sanity', price: 1, weightGrams: 1 }];
  bewaarWebshop(db, art, { ...w.data, sizeVariants: undefined });
  await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  assert.equal(docs.get(id()).sizeVariants[0].label, 'In Sanity', 'ongemoeid');
  assert.throws(() => bewaarWebshop(db, art, { ...w.data, sizeVariants: [{ label: 'Man', price: 6.5 }, { label: 'man', price: 6.5 }] }), /dezelfde naam/);
  assert.throws(() => bewaarWebshop(db, art, { ...w.data, sizeVariants: [{ label: 'Man', price: '' }] }), /prijs/);
  bewaarWebshop(db, art, { ...w.data, variantChoiceLabel: 'Model', sizeVariants: [{ label: 'Man', price: '6,50', weightGrams: 12, image_bijlage_id: foto }, { label: 'Vrouw', price: 6.5, sanity_image: 'image-oud' }] });
  await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  const d = docs.get(id());
  assert.equal(d.variantChoiceLabel, 'Model');
  assert.deepEqual(d.sizeVariants.map(v => [v.label, v.price]), [['Man', 6.5], ['Vrouw', 6.5]]);
  assert.ok(d.sizeVariants[0].image.asset._ref.startsWith('image-')); assert.equal(d.sizeVariants[1].image.asset._ref, 'image-oud');
  assert.ok(d.sizeVariants[1].weightGrams >= 0, 'gewicht valt terug op het product');
  bewaarWebshop(db, art, { ...w.data, sizeVariants: [] });
  await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  assert.equal(docs.get(id()).sizeVariants, undefined, 'leeg = weg uit Sanity');
});

test('W13. per keuze een eigen artikel: aangemaakt en gekoppeld (slug + keuze), prijs bij de push van dat artikel, bulk maakt enkel wat ontbreekt', async () => {
  const db = getDb();
  const id = () => db.prepare('SELECT webshop_sanity_id i FROM artikelen WHERE id = ?').get(art).i;
  const w = await leesWebshop(db, art, { fetchFn: nep });
  db.prepare(`UPDATE artikelen SET printprofiel = ? WHERE id = ?`).run(JSON.stringify({ printer_id: 1, tijd_min: 60, materialen: [] }), art);
  bewaarWebshop(db, art, { ...w.data, sizeVariants: [{ label: '10cm', price: 16 }, { label: '15cm', price: 19.95 }] });   // hoofdartikel kost 16 (W3)
  const k = maakKeuzeArtikel(db, art, '15cm');
  assert.equal(k.nieuw, true); assert.match(k.naam, /— 15cm$/); assert.equal(k.verkoopprijs, 19.95);
  const rij = db.prepare('SELECT webshop_slug, webshop_variant, printprofiel FROM artikelen WHERE id = ?').get(k.id);
  assert.equal(rij.webshop_variant, '15cm'); assert.equal(rij.printprofiel, null, 'profiel enkel bij de basismaat (zelfde prijs)');
  assert.equal(maakKeuzeArtikel(db, art, '15cm').nieuw, false, 'geen dubbel');
  // prijs op het keuze-artikel aanpassen → de push neemt die over
  db.prepare('UPDATE artikelen SET verkoopprijs = 21 WHERE id = ?').run(k.id);
  await pushWebshop(db, art, { fetchFn: nep, forceer: true });
  assert.equal(docs.get(id()).sizeVariants.find(v => v.label === '15cm').price, 21);
  const l = await leesWebshop(db, art, { fetchFn: nep });
  assert.equal(l.data.sizeVariants.find(v => v.label === '15cm').artikel.id, k.id);
  // bulk: enkel 10cm ontbreekt nog; die krijgt het profiel (zelfde prijs als het hoofdartikel)
  const b = maakAlleKeuzeArtikels(db);
  assert.equal(b.nieuw, 1);
  const tien = db.prepare(`SELECT printprofiel FROM artikelen WHERE webshop_variant = '10cm'`).get();
  assert.ok(tien.printprofiel, 'basismaat krijgt het printprofiel');
  // een webshopbestelling van 15cm vindt het keuze-artikel
  const { bewaarBestellingen, leesBestellingen } = await import('../domein/webshopbestellingen.js');
  const slug = db.prepare('SELECT webshop_slug s FROM artikelen WHERE id = ?').get(art).s;
  bewaarBestellingen(db, [{ id: 'ord-keuze', status: 'paid', items: [{ slug, name: 'x', quantity: 1, price: 21, variantLabel: '15cm' }] }]);
  assert.equal(leesBestellingen(db, { alles: true }).find(x => x.id === 'ord-keuze').items[0].artikel.id, k.id);
});
