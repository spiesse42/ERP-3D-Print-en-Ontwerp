// Tests voor stap 3a: catalogus (type + vinkjes + categorieën),
// leveranciersgegevens, voorraad (FIFO, correctie, telling), te bestellen.
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
const artikel = async id => ok(await vraag('GET', `/voorraad/artikelen/${id}`));
const boek = (id, body) => vraag('POST', `/voorraad/artikelen/${id}/boeking`, body);

let pg, zwart, wit;
test('voorbereiding: prijsgroep met rolgewicht en min/max rollen', async () => {
  let r = await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25, min_rollen: 2, max_rollen: 1 });
  assert.equal(r.status, 400, 'max < min');
  r = await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25, min_rollen: 2, max_rollen: 4, rolgewicht_g: '250' });
  pg = ok(r, 201).id;
  const t = ok(await vraag('GET', '/filament/types')).find(x => x.id === pg);
  assert.equal(t.rolgewicht_g, 250);
  assert.equal(t.max_rollen, 4);
  zwart = 1; wit = 2;
});

let ring, hond, verzending, filZwart, filWit;
test('artikelen aanmaken: regels per type en vinkjes', async () => {
  // artikel dat niet gekocht en niet zelf geprint wordt → fout
  let r = await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'X', wordt_verkocht: true, verkoopprijs: 1 });
  assert.equal(r.status, 400);
  // verkocht zonder verkoopprijs → fout
  r = await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'X', wordt_gekocht: true, wordt_verkocht: true });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Verkoopprijs/);
  // gekocht + verkocht: inkoop, marge en verkoopprijs; productieprijs wordt gewist
  ring = ok(await vraag('POST', '/voorraad/artikelen', {
    type: 'artikel', naam: 'Sleutelring 25 mm', wordt_gekocht: true, wordt_verkocht: true,
    inkoopprijs: '0,10', marge_pct: 50, verkoopprijs: '0,15', productieprijs: 9, min_voorraad: 50, max_voorraad: 200, categorie_id: 2,
  }), 201).id;
  let a = await artikel(ring);
  assert.deepEqual([a.inkoopprijs, a.marge_pct, a.verkoopprijs, a.productieprijs, a.categorie], [0.1, 50, 0.15, null, 'Onderdelen']);
  // zelf geprint eindproduct
  hond = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelhanger hond', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 8, productieprijs: 2.5, min_voorraad: 3 }), 201).id;
  // dienst: min/max worden genegeerd
  verzending = ok(await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Verzending', wordt_verkocht: true, verkoopprijs: 5, vaste_prijs: true, min_voorraad: 3 }), 201).id;
  a = await artikel(verzending);
  assert.deepEqual([a.min_voorraad, a.vaste_prijs, a.status], [null, 1, null]);
  // filament: prijsgroep + kleur; prijzen en vinkjes vast
  filZwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: zwart, verkoopprijs: 99, wordt_verkocht: true }), 201).id;
  a = await artikel(filZwart);
  assert.equal(a.weergave, 'Bambu Lab PLA · Zwart');
  assert.deepEqual([a.eenheid, a.wordt_gekocht, a.wordt_verkocht, a.verkoopprijs, a.min_eff, a.max_eff], ['rollen', 1, 0, null, 2, 4]);
  filWit = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: wit, min_voorraad: 1, max_voorraad: 1 }), 201).id;
  a = await artikel(filWit);
  assert.deepEqual([a.min_eff, a.max_eff], [1, 1], 'eigen min/max per kleur gaat voor de prijsgroep');
  // dubbels
  r = await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: zwart });
  assert.equal(r.status, 400); assert.match(r.data.error, /prijsgroep en kleur/);
  r = await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'verzending', wordt_verkocht: true, verkoopprijs: 1 });
  assert.equal(r.status, 400); assert.match(r.data.error, /naam/);
});

test('wijzigen: vinkje uit wist de bijhorende prijzen en schrijft historiek', async () => {
  ok(await vraag('PUT', `/voorraad/artikelen/${ring}`, { type: 'artikel', naam: 'Sleutelring 25 mm', wordt_gekocht: true, wordt_verkocht: false,
    inkoopprijs: '0,10', marge_pct: 50, verkoopprijs: '0,15', min_voorraad: 50, max_voorraad: 200, categorie_id: 2 }));
  const a = await artikel(ring);
  assert.deepEqual([a.verkoopprijs, a.marge_pct], [null, null]);
  const h = ok(await vraag('GET', `/historiek/artikel/${ring}`));
  assert.equal(h[0].soort, 'gewijzigd');
  assert.match(h[0].tekst, /Wordt verkocht: ja → nee/);
  assert.match(h[0].tekst, /Verkoopprijs gewist/);
});

test('boekingen: partijen in, FIFO uit over twee partijen, onvoldoende → niets gewijzigd', async () => {
  ok(await boek(ring, { richting: 'in', aantal: 30, prijs_per_eenheid: '0,10', datum: '2026-09-01' }));
  ok(await boek(ring, { richting: 'in', aantal: 50, prijs_per_eenheid: '0,12', datum: '2026-09-10' }));
  let a = await artikel(ring);
  assert.deepEqual([a.voorraad, a.partijen, a.waarde], [80, 2, 9]);
  // 40 eraf: 30 uit de oudste, 10 uit de tweede
  const uit = ok(await boek(ring, { richting: 'uit', aantal: 40, reden: 'gebruik' }));
  assert.deepEqual(uit.verdeling.map(v => v.aantal), [30, 10]);
  const partijen = ok(await vraag('GET', `/voorraad/artikelen/${ring}/partijen`));
  assert.deepEqual(partijen.map(p => p.aantal_resterend), [40, 0], 'lopende partij eerst, lege achteraan');
  a = await artikel(ring);
  assert.deepEqual([a.voorraad, a.gem_prijs], [40, 0.12]);
  // te veel → 400 en niets veranderd
  const r = await boek(ring, { richting: 'uit', aantal: 41 });
  assert.equal(r.status, 400); assert.match(r.data.error, /Onvoldoende voorraad: 40 beschikbaar/);
  assert.equal((await artikel(ring)).voorraad, 40);
  // ongeldige invoer
  assert.equal((await boek(ring, { richting: 'uit', aantal: 0 })).status, 400);
  assert.equal((await boek(ring, { richting: 'in', aantal: 1, reden: 'gebruik' })).status, 400);
  assert.equal((await boek(verzending, { richting: 'in', aantal: 1 })).status, 400, 'dienst heeft geen voorraad');
  // historiek
  const h = ok(await vraag('GET', `/historiek/artikel/${ring}`));
  assert.equal(h[0].soort, 'voorraad');
  assert.equal(h[0].tekst, '−40 gebruikt');
});

test('corrigeren: meer → nieuwe partij aan de laatste prijs; minder → FIFO; gelijk → niets', async () => {
  let c = ok(await boek(ring, { richting: 'corrigeer', aantal: 45 }));
  assert.deepEqual([c.oud, c.nieuw, c.verschil], [40, 45, 5]);
  const p = ok(await vraag('GET', `/voorraad/artikelen/${ring}/partijen`)).find(x => x.aantal_ontvangen === 5);
  assert.equal(p.prijs_per_eenheid, 0.12);
  c = ok(await boek(ring, { richting: 'corrigeer', aantal: '44,5' }));
  assert.equal(c.verschil, -0.5);
  c = ok(await boek(ring, { richting: 'corrigeer', aantal: 44.5 }));
  assert.equal(c.ongewijzigd, true);
  const muts = ok(await vraag('GET', `/voorraad/mutaties?artikel_id=${ring}&reden=correctie`));
  assert.equal(muts.length, 2);
  assert.equal(muts[0].weergave, 'Sleutelring 25 mm');
});

test('filament: kostprijs per kg volgt het rolgewicht', async () => {
  ok(await boek(filZwart, { richting: 'in', aantal: 2, prijs_per_eenheid: 6 }));
  const a = await artikel(filZwart);
  assert.equal(a.kost_per_kg, 24, '€ 6 per rol van 250 g = € 24/kg');
  // rol leegmelden = 1 eraf
  ok(await boek(filZwart, { richting: 'uit', aantal: 1, reden: 'gebruik', notitie: 'leeg' }));
  assert.equal((await artikel(filZwart)).voorraad, 1);
});

test('te bestellen: aanvullen tot max, besteld telt mee, zelf geprint = produceren, voorkeursleverancier', async () => {
  const db = getDb();
  const action = ok(await vraag('POST', '/leveranciers', { naam: 'Action' }), 201).id;
  const bambu = ok(await vraag('POST', '/leveranciers', { naam: 'Bambu Store' }), 201).id;
  assert.equal((await vraag('POST', '/leveranciers', { naam: 'action' })).status, 400);
  // leveranciersgegevens op het filament: voorkeur Bambu
  ok(await vraag('PUT', `/voorraad/artikelen/${filZwart}`, { type: 'filament', filament_type_id: pg, kleur_id: zwart,
    leveranciers: [{ leverancier_id: action, omschrijving: 'PLA zwart' }, { leverancier_id: bambu, productcode: '10101', laatste_prijs: '6,5', levertijd_dagen: 5, voorkeur: true }] }));
  let a = await artikel(filZwart);
  assert.equal(a.leveranciers[0].leverancier, 'Bambu Store');
  // zelfde code bij dezelfde leverancier op een ander artikel → fout
  const r = await vraag('PUT', `/voorraad/artikelen/${filWit}`, { type: 'filament', filament_type_id: pg, kleur_id: wit, min_voorraad: 1, max_voorraad: 1,
    leveranciers: [{ leverancier_id: bambu, productcode: '10101' }] });
  assert.equal(r.status, 400); assert.match(r.data.error, /productcode/);

  let lijst = ok(await vraag('GET', '/voorraad/te-bestellen'));
  const perId = Object.fromEntries(lijst.map(x => [x.id, x]));
  // zwart: 1 rol, min 2 (prijsgroep) → aanvullen tot max 4 → 3
  assert.deepEqual([perId[filZwart].voorstel, perId[filZwart].actie, perId[filZwart].leverancier, perId[filZwart].leverancier_prijs], [3, 'bestellen', 'Bambu Store', 6.5]);
  // wit: 0 rollen, eigen min/max 1 → 1
  assert.equal(perId[filWit].voorstel, 1);
  // hond: zelf geprint, 0 < min 3 → produceren (geen max → tot minimum)
  assert.deepEqual([perId[hond].actie, perId[hond].voorstel], ['produceren', 3]);
  // ring: 44,5 < 50 → tot max 200 → 155,5 → afgerond naar 156 stuks
  assert.equal(perId[ring].voorstel, 156);
  // een lopende bestelling voor 3 rollen zwart telt mee → verdwijnt van de lijst
  const ak = db.prepare(`INSERT INTO aankopen (nummer, besteld_op) VALUES ('AK-2026-0001', date('now'))`).run().lastInsertRowid;
  db.prepare('INSERT INTO aankoop_regels (aankoop_id, artikel_id, aantal) VALUES (?,?,3)').run(ak, filZwart);
  lijst = ok(await vraag('GET', '/voorraad/te-bestellen'));
  assert.ok(!lijst.some(x => x.id === filZwart));
  a = await artikel(filZwart);
  assert.deepEqual([a.besteld, a.status], [3, 'besteld']);
  // geannuleerd → telt niet meer mee
  db.prepare(`UPDATE aankopen SET geannuleerd_op = date('now') WHERE id = ?`).run(ak);
  assert.equal((await artikel(filZwart)).status, 'bestellen');
});

test('voorraadtelling: in één keer, alles of niets', async () => {
  const voor = [(await artikel(ring)).voorraad, (await artikel(filZwart)).voorraad];
  // één ongeldige regel → niets geboekt
  let r = await vraag('POST', '/voorraad/telling', { regels: [{ artikel_id: ring, geteld: 10 }, { artikel_id: verzending, geteld: 1 }] });
  assert.equal(r.status, 400);
  assert.deepEqual([(await artikel(ring)).voorraad, (await artikel(filZwart)).voorraad], voor);
  r = await vraag('POST', '/voorraad/telling', { regels: [{ artikel_id: ring, geteld: 10 }, { artikel_id: ring, geteld: 11 }] });
  assert.equal(r.status, 400, 'dubbel artikel');
  // geldig: ring 44,5 → 60, zwart 1 → 1 (ongewijzigd), hond leeg (overslaan), wit 0 → 2
  const uit = ok(await vraag('POST', '/voorraad/telling', { regels: [
    { artikel_id: ring, geteld: 60 }, { artikel_id: filZwart, geteld: 1 }, { artikel_id: hond, geteld: '' }, { artikel_id: filWit, geteld: 2 },
  ] }));
  assert.deepEqual(uit.aangepast.map(x => [x.artikel_id, x.verschil]), [[ring, 15.5], [filWit, 2]]);
  const h = ok(await vraag('GET', `/historiek/artikel/${ring}`));
  assert.equal(h[0].tekst, 'Voorraadtelling: 44,5 → 60');
  const muts = ok(await vraag('GET', `/voorraad/mutaties?artikel_id=${filWit}`));
  assert.equal(muts[0].notitie, 'Voorraadtelling');
});

test('type wijzigen kan enkel zolang er geen bewegingen zijn; verwijderen idem', async () => {
  let r = await vraag('PUT', `/voorraad/artikelen/${ring}`, { type: 'dienst', naam: 'Sleutelring 25 mm', wordt_gekocht: true });
  assert.equal(r.status, 400); assert.match(r.data.error, /type/);
  r = await vraag('DELETE', `/voorraad/artikelen/${ring}`);
  assert.equal(r.status, 400); assert.match(r.data.error, /Archiveer/);
  // archiveren: weg uit de standaardlijst, zichtbaar in archief
  ok(await vraag('PATCH', `/voorraad/artikelen/${ring}/archief`, { gearchiveerd: true }));
  assert.ok(!ok(await vraag('GET', '/voorraad/artikelen')).some(x => x.id === ring));
  assert.ok(ok(await vraag('GET', '/voorraad/artikelen?archief=1')).some(x => x.id === ring));
  assert.ok(!ok(await vraag('GET', '/voorraad/te-bestellen')).some(x => x.id === ring), 'gearchiveerd staat niet op te bestellen');
  // een nieuw artikel zonder bewegingen mag wel van type veranderen en weg
  const tijdelijk = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Tijdelijk', wordt_gekocht: true }), 201).id;
  ok(await vraag('PUT', `/voorraad/artikelen/${tijdelijk}`, { type: 'dienst', naam: 'Tijdelijk', wordt_gekocht: true }));
  ok(await vraag('DELETE', `/voorraad/artikelen/${tijdelijk}`));
  assert.equal(getDb().prepare(`SELECT COUNT(*) c FROM gebeurtenissen WHERE entiteit='artikel' AND entiteit_id=?`).get(tijdelijk).c, 0);
});

test('categorieën: boom met pad, geen lus, niet weg zolang in gebruik', async () => {
  const sub = ok(await vraag('POST', '/voorraad/categorieen', { naam: 'Ringen', ouder_id: 2 }), 201);
  assert.equal(sub.pad, 'Onderdelen / Ringen');
  const subsub = ok(await vraag('POST', '/voorraad/categorieen', { naam: 'Groot', ouder_id: sub.id }), 201).id;
  assert.equal((await vraag('POST', '/voorraad/categorieen', { naam: 'ringen', ouder_id: 2 })).status, 400, 'dubbel');
  assert.equal((await vraag('POST', '/voorraad/categorieen', { naam: 'A/B' })).status, 400);
  // Onderdelen onder "Groot" hangen → lus
  let r = await vraag('PUT', '/voorraad/categorieen/2', { naam: 'Onderdelen', ouder_id: subsub });
  assert.equal(r.status, 400); assert.match(r.data.error, /onder zichzelf/);
  // hernoemen werkt door in het pad van het artikel
  ok(await vraag('PUT', '/voorraad/categorieen/2', { naam: 'Componenten' }));
  const cats = ok(await vraag('GET', '/voorraad/categorieen'));
  assert.ok(cats.some(c => c.pad === 'Componenten / Ringen / Groot'));
  r = await vraag('DELETE', '/voorraad/categorieen/2');
  assert.equal(r.status, 400); assert.match(r.data.error, /subcategorieën/);
  ok(await vraag('DELETE', `/voorraad/categorieen/${subsub}`));
  // categorie met artikelen → weigeren
  r = await vraag('DELETE', '/voorraad/categorieen/1');
  assert.equal(r.status, 200, 'Filament wordt door geen artikel gebruikt');
  ok(await vraag('PUT', `/voorraad/artikelen/${hond}`, { type: 'artikel', naam: 'Sleutelhanger hond', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 8, categorie_id: sub.id }));
  r = await vraag('DELETE', `/voorraad/categorieen/${sub.id}`);
  assert.equal(r.status, 400); assert.match(r.data.error, /1 artikel/);
  assert.equal((await artikel(hond)).categorie, 'Componenten / Ringen');
});
