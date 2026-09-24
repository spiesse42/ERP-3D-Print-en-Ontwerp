// Tests voor het basisschema en de migratie-aanpak.
// Draaien: `npm test` in de backend-map (ook automatisch vóór een build).
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initDb, sluitDb, huidigeVersie, migreer } from '../db/index.js';
import { MIGRATIES } from '../db/migraties/index.js';
import { volgendNummer } from '../domein/nummering.js';
import { getalOfDefault, optioneelGetal, getTarieven } from '../domein/hulp.js';

function tijdelijkPad() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-')), 'erp.db');
}

test('lege databank wordt gemigreerd tot de laatste versie', () => {
  const db = initDb(':memory:');
  assert.equal(huidigeVersie(db), MIGRATIES.at(-1).versie);
  const tabellen = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  for (const t of ['klanten', 'tarieven', 'instellingen', 'nummering', 'gebeurtenissen', 'bijlagen',
    'filament_merken', 'filament_materialen', 'filament_kleuren', 'filament_types', 'artikelen',
    'leveranciers', 'aankopen', 'aankoop_regels', 'voorraad_partijen', 'voorraad_mutaties',
    'categorieen', 'artikel_leveranciers']) {
    assert.ok(tabellen.includes(t), `tabel ${t} ontbreekt`);
  }
  for (const oud of ['filament_rollen', 'artikel_voorraad', 'artikel_types', 'facturen']) {
    assert.ok(!tabellen.includes(oud), `oude tabel ${oud} mag niet meer bestaan`);
  }
  sluitDb();
});

test('seed: 11 tarieven (machine_per_uur weg sinds 005), 8 merken, 8 materialen, 16 kleuren, 3 printers', () => {
  const db = initDb(':memory:');
  const t = getTarieven(db);
  assert.equal(Object.keys(t).length, 11);
  assert.equal(t.kwh_prijs, 0.35);
  assert.equal(t.machine_per_uur, undefined, 'geen globaal machinetarief meer (beslissing 24-09)');
  assert.deepEqual(db.prepare('SELECT naam, machine_per_uur, actief FROM printers ORDER BY id').all().map(p => [p.naam, p.machine_per_uur, p.actief]),
    [['Bambu Lab A1 Mini', null, 1], ['Bambu Lab A1', null, 1], ['AnyCubic Kobra S1', null, 1]]);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM filament_merken').get().c, 8);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM filament_materialen').get().c, 8);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM filament_kleuren').get().c, 16);
  sluitDb();
});

test('opnieuw opstarten op een bestaande databank voert niets dubbel uit en bewaart data', () => {
  const pad = tijdelijkPad();
  let db = initDb(pad);
  db.prepare(`INSERT INTO klanten (naam) VALUES ('Testklant')`).run();
  sluitDb();
  db = initDb(pad);
  assert.equal(huidigeVersie(db), MIGRATIES.at(-1).versie);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM klanten').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tarieven').get().c, 11, 'seed mag niet opnieuw lopen');
  sluitDb();
});

test('een databank uit de vorige opbouw wordt geweigerd met een duidelijke melding', () => {
  const pad = tijdelijkPad();
  const oud = new Database(pad);
  oud.exec('CREATE TABLE filament_rollen (id INTEGER PRIMARY KEY)');
  oud.close();
  assert.throws(() => initDb(pad), /Verwijder erp\.db/);
  sluitDb();
});

test('een mislukte migratie wordt volledig teruggedraaid', () => {
  const db = new Database(':memory:');
  const kapot = { versie: 1, naam: 'kapot', up: d => { d.exec('CREATE TABLE a (x)'); throw new Error('stuk'); } };
  assert.throws(() => migreer(db, [kapot]), /stuk/);
  assert.equal(db.pragma('user_version', { simple: true }), 0);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE name='a'`).get().c, 0);
  db.close();
});

test('migraties moeten oplopend en uniek genummerd zijn', () => {
  const db = new Database(':memory:');
  const m = v => ({ versie: v, naam: 'x', up: () => {} });
  assert.throws(() => migreer(db, [m(2), m(1)]), /oplopend/);
  assert.throws(() => migreer(db, [m(1), m(1)]), /oplopend/);
  db.close();
});

test('artikelen: regels per type worden door de databank afgedwongen (migratie 003)', () => {
  const db = initDb(':memory:');
  const pg = db.prepare(`INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg, min_rollen) VALUES (1, 4, 32, 2)`).run().lastInsertRowid;
  const ins = (kol, waarden) => db.prepare(`INSERT INTO artikelen (${kol}) VALUES (${waarden.map(() => '?').join(',')})`).run(...waarden);
  // filament zonder kleur → fout; filament moet "wordt gekocht" zijn
  assert.throws(() => ins('type, wordt_gekocht, filament_type_id', ['filament', 1, pg]), /CHECK/);
  assert.throws(() => ins('type, filament_type_id, kleur_id', ['filament', pg, 1]), /CHECK/);
  ins('type, wordt_gekocht, filament_type_id, kleur_id, eenheid', ['filament', 1, pg, 1, 'rollen']);
  assert.throws(() => ins('type, wordt_gekocht, filament_type_id, kleur_id', ['filament', 1, pg, 1]), /UNIQUE/);
  // artikel: naam verplicht, geen kleur, en gekocht OF zelf geprint
  assert.throws(() => ins('type, wordt_gekocht', ['artikel', 1]), /CHECK/);
  assert.throws(() => ins('type, wordt_gekocht, naam, kleur_id', ['artikel', 1, 'Ring', 1]), /CHECK/);
  assert.throws(() => ins('type, wordt_verkocht, naam', ['artikel', 1, 'Enkel verkocht']), /CHECK/);
  ins('type, zelf_geprint, wordt_verkocht, naam', ['artikel', 1, 1, 'Sleutelhanger hond']);
  // dienst: niet zelf geprint, geen minimum
  assert.throws(() => ins('type, wordt_verkocht, zelf_geprint, naam', ['dienst', 1, 1, 'X']), /CHECK/);
  assert.throws(() => ins('type, wordt_verkocht, naam, min_voorraad', ['dienst', 1, 'Y', 2]), /CHECK/);
  ins('type, wordt_verkocht, naam', ['dienst', 1, 'Verzending']);
  // onbekend type; max kleiner dan min
  assert.throws(() => ins('type, wordt_gekocht, naam', ['gadget', 1, 'Z']), /CHECK/);
  assert.throws(() => ins('type, wordt_gekocht, naam, min_voorraad, max_voorraad', ['artikel', 1, 'M', 5, 2]), /CHECK/);
  // naam uniek (hoofdletterongevoelig), ook over artikel/dienst heen
  ins('type, wordt_gekocht, naam', ['artikel', 1, 'Sleutelring 25 mm']);
  assert.throws(() => ins('type, wordt_gekocht, naam', ['artikel', 1, 'sleutelring 25 MM']), /UNIQUE/);
  assert.throws(() => ins('type, wordt_verkocht, naam', ['dienst', 1, 'verzending']), /UNIQUE/);
  sluitDb();
});

test('migratie 003 zet bestaande artikelen om en behoudt partijen, mutaties en aankoopregels', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migreer(db, MIGRATIES.slice(0, 2));
  const pg = db.prepare(`INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg) VALUES (1, 1, 25)`).run().lastInsertRowid;
  const a = () => db.prepare(`INSERT INTO artikelen (soort, naam, filament_type_id, kleur_id, verkoopprijs, min_voorraad) VALUES (?,?,?,?,?,?)`);
  const fil = a().run('filament', null, pg, 2, null, 3).lastInsertRowid;
  const ond = a().run('onderdeel', 'Ring', null, null, 0.5, 100).lastInsertRowid;
  const ond2 = a().run('onderdeel', 'Lijm', null, null, null, null).lastInsertRowid;
  const eind = a().run('eindproduct', 'Hond', null, null, 8, 2).lastInsertRowid;
  const dienst = a().run('dienst', 'Verzending', null, null, 5, null).lastInsertRowid;
  const partij = db.prepare(`INSERT INTO voorraad_partijen (artikel_id, aantal_ontvangen, aantal_resterend) VALUES (?,5,4)`).run(fil).lastInsertRowid;
  db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden) VALUES (?,?,5,'ontvangst')`).run(fil, partij);
  const ak = db.prepare(`INSERT INTO aankopen (nummer) VALUES ('AK-2026-0001')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO aankoop_regels (aankoop_id, artikel_id, aantal) VALUES (?,?,10)`).run(ak, ond);

  migreer(db, MIGRATIES.slice(0, 3));
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'foreign keys staan terug aan');
  const rij = id => db.prepare(`SELECT a.*, c.naam cat FROM artikelen a LEFT JOIN categorieen c ON c.id = a.categorie_id WHERE a.id = ?`).get(id);
  let r = rij(fil);  assert.deepEqual([r.type, r.wordt_gekocht, r.wordt_verkocht, r.zelf_geprint, r.cat, r.min_voorraad], ['filament', 1, 0, 0, 'Filament', 3]);
  r = rij(ond);      assert.deepEqual([r.type, r.wordt_gekocht, r.wordt_verkocht, r.zelf_geprint, r.cat], ['artikel', 1, 1, 0, 'Onderdelen']);
  r = rij(ond2);     assert.deepEqual([r.type, r.wordt_gekocht, r.wordt_verkocht], ['artikel', 1, 0]);
  r = rij(eind);     assert.deepEqual([r.type, r.wordt_gekocht, r.wordt_verkocht, r.zelf_geprint, r.cat], ['artikel', 0, 1, 1, 'Eindproducten']);
  r = rij(dienst);   assert.deepEqual([r.type, r.wordt_verkocht, r.cat, r.verkoopprijs], ['dienst', 1, 'Diensten', 5]);
  // verwijzingen blijven werken, ook na de herbouw
  assert.equal(db.prepare('SELECT artikel_id FROM voorraad_partijen WHERE id = ?').get(partij).artikel_id, fil);
  assert.throws(() => db.prepare('DELETE FROM artikelen WHERE id = ?').run(fil), /FOREIGN KEY/);
  assert.throws(() => db.prepare(`INSERT INTO voorraad_partijen (artikel_id, aantal_ontvangen, aantal_resterend) VALUES (999,1,1)`).run(), /FOREIGN KEY/);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  // nieuwe kolommen op de prijsgroep
  const t = db.prepare('SELECT rolgewicht_g, max_rollen FROM filament_types WHERE id = ?').get(pg);
  assert.deepEqual([t.rolgewicht_g, t.max_rollen], [1000, null]);
  db.close();
});

test('artikel_leveranciers: productcode uniek per leverancier; weg met het artikel', () => {
  const db = initDb(':memory:');
  const lev = db.prepare(`INSERT INTO leveranciers (naam) VALUES ('Action')`).run().lastInsertRowid;
  const a1 = db.prepare(`INSERT INTO artikelen (type, wordt_gekocht, naam) VALUES ('artikel', 1, 'Ring')`).run().lastInsertRowid;
  const a2 = db.prepare(`INSERT INTO artikelen (type, wordt_gekocht, naam) VALUES ('artikel', 1, 'Magneet')`).run().lastInsertRowid;
  const ins = (a, code) => db.prepare(`INSERT INTO artikel_leveranciers (artikel_id, leverancier_id, productcode) VALUES (?,?,?)`).run(a, lev, code);
  ins(a1, 'R-25'); ins(a1, null); ins(a2, null);
  assert.throws(() => ins(a2, 'r-25'), /UNIQUE/);
  db.prepare('DELETE FROM artikelen WHERE id = ?').run(a1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM artikel_leveranciers').get().c, 1);
  sluitDb();
});

test('migratie met fkUit: verbroken verwijzing → alles teruggedraaid, foreign keys terug aan', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id)); INSERT INTO p VALUES (1); INSERT INTO c VALUES (1,1);`);
  const kapot = { versie: 1, naam: 'kapot', fkUit: true, up: d => d.exec('DELETE FROM p') };
  assert.throws(() => migreer(db, [kapot]), /verbroken verwijzing/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM p').get().c, 1);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

test('voorraadpartij: resterend kan niet negatief en niet hoger dan ontvangen', () => {
  const db = initDb(':memory:');
  const art = db.prepare(`INSERT INTO artikelen (type, wordt_gekocht, naam) VALUES ('artikel', 1, 'Magneet')`).run().lastInsertRowid;
  const zet = (o, r) => db.prepare(`INSERT INTO voorraad_partijen (artikel_id, aantal_ontvangen, aantal_resterend) VALUES (?,?,?)`).run(art, o, r);
  zet(20, 20);
  assert.throws(() => zet(20, 21), /CHECK/);
  assert.throws(() => zet(20, -1), /CHECK/);
  assert.throws(() => zet(0, 0), /CHECK/);
  sluitDb();
});

test('mutatie: aantal 0 of onbekende reden wordt geweigerd; artikel met partij kan niet weg', () => {
  const db = initDb(':memory:');
  const art = db.prepare(`INSERT INTO artikelen (type, wordt_gekocht, naam) VALUES ('artikel', 1, 'Inzetmoer M3')`).run().lastInsertRowid;
  const partij = db.prepare(`INSERT INTO voorraad_partijen (artikel_id, aantal_ontvangen, aantal_resterend) VALUES (?,100,100)`).run(art).lastInsertRowid;
  db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden) VALUES (?,?,100,'ontvangst')`).run(art, partij);
  assert.throws(() => db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, aantal, reden) VALUES (?,0,'correctie')`).run(art), /CHECK/);
  assert.throws(() => db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, aantal, reden) VALUES (?,-1,'weg')`).run(art), /CHECK/);
  assert.throws(() => db.prepare('DELETE FROM artikelen WHERE id = ?').run(art), /FOREIGN KEY/);
  sluitDb();
});

test('aankoopregel: artikel, plaatshouder of omschrijving (en niet artikel + plaatshouder)', () => {
  const db = initDb(':memory:');
  const ak = db.prepare(`INSERT INTO aankopen (nummer) VALUES ('AK-2026-0001')`).run().lastInsertRowid;
  const art = db.prepare(`INSERT INTO artikelen (type, wordt_gekocht, naam) VALUES ('artikel', 1, 'Magneet')`).run().lastInsertRowid;
  const regel = (o) => db.prepare(`INSERT INTO aankoop_regels (aankoop_id, artikel_id, plaatshouder_materiaal_id, omschrijving, aantal) VALUES (?,?,?,?,?)`)
    .run(ak, o.artikel ?? null, o.ph ?? null, o.oms ?? null, o.aantal ?? 1);
  regel({ artikel: art });
  regel({ ph: 1 });                        // "PLA, merk nog onbekend"
  regel({ oms: 'Verzending' });
  assert.throws(() => regel({}), /CHECK/);
  assert.throws(() => regel({ artikel: art, ph: 1 }), /CHECK/);
  assert.throws(() => regel({ artikel: art, aantal: 0 }), /CHECK/);
  // aankoop verwijderen neemt de regels mee
  db.prepare('DELETE FROM aankopen WHERE id = ?').run(ak);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM aankoop_regels').get().c, 0);
  sluitDb();
});

test('nummering: doorlopend per reeks en per jaar', () => {
  const db = initDb(':memory:');
  assert.equal(volgendNummer(db, 'AK', { jaar: 2026 }), 'AK-2026-0001');
  assert.equal(volgendNummer(db, 'AK', { jaar: 2026 }), 'AK-2026-0002');
  assert.equal(volgendNummer(db, 'PB', { jaar: 2026 }), 'PB-2026-001', 'pakbon: 3 cijfers (beslist 25-09)');
  assert.equal(volgendNummer(db, 'WB', { jaar: 2026 }), 'WB-2026-0001', 'werkbon: 4 cijfers zoals het oude pakket');
  assert.equal(volgendNummer(db, 'AK', { jaar: 2027 }), 'AK-2027-0001');
  assert.throws(() => volgendNummer(db, 'ak; DROP'), /Ongeldige reeks/);
  sluitDb();
});

test('hulp: een ingevulde 0 blijft 0; komma als decimaalteken', () => {
  assert.equal(getalOfDefault(0, 10), 0);
  assert.equal(getalOfDefault('0', 10), 0);
  assert.equal(getalOfDefault('', 10), 10);
  assert.equal(getalOfDefault(null, 10), 10);
  assert.equal(getalOfDefault('abc', 10), 10);
  assert.equal(getalOfDefault('0,35', 1), 0.35);
  assert.equal(optioneelGetal(''), null);
  assert.ok(Number.isNaN(optioneelGetal('x')));
  assert.equal(optioneelGetal('2,5'), 2.5);
});

test('migratie 002 behoudt bestaande klanten bij het herbouwen van de tabel', () => {
  const db = new Database(':memory:');
  migreer(db, MIGRATIES.slice(0, 1));
  db.prepare(`INSERT INTO klanten (naam, type, gemeente) VALUES ('Peeters', 'particulier', 'Geel')`).run();
  migreer(db, MIGRATIES);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIES.at(-1).versie);
  const k = db.prepare('SELECT * FROM klanten').get();
  assert.equal(k.id, 1);
  assert.equal(k.gemeente, 'Geel');
  db.prepare(`INSERT INTO klanten (type, bedrijfsnaam) VALUES ('zakelijk', 'Atelier bv')`).run();
  db.close();
});
