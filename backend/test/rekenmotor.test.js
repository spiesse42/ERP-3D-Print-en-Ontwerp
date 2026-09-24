// Tests voor de rekenmotor (stap 4).
// A. Referentie: de OUDE motor (test/fixtures/oude-regelmotor.js, letterlijke
//    kopie van 3D-ERP/backend/lib/regelmotor.js) en de nieuwe motor moeten
//    op de cent gelijk zijn voor alles wat NIET bewust veranderd is.
// B. De bewuste wijzigingen van 24-09, elk apart en met een voorbeeld.
// C. De API: POST /api/bereken met echte id's uit de databank.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bereken } from '../domein/rekenmotor.js';
import { berekenOfferteRegels as oudBereken } from './fixtures/oude-regelmotor.js';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';

const T = { kwh_prijs: 0.35, marge_grens_uur: 3, marge_klein_pct: 18, marge_groot_pct: 10, faalfactor_pct: 10,
  voorbereiding_min: 10, nabewerking_min: 5, ontwerp_tarief: 25, nabewerking_tarief: 20, arbeid_per_uur: 15, bmcu_per_job: 0.10 };

// ── A. Referentie tegen de oude motor ──────────────────────────────────────
// Kleine voorspelbare "willekeur" (zelfde reeks bij elke run).
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const PRINTERS = { 1: { naam: 'Bambu Lab A1 Mini', gem_verbruik_watt: 95, machine_kost_per_uur: 0.18 }, 2: { naam: 'AnyCubic Kobra S1', gem_verbruik_watt: 140, machine_kost_per_uur: 0.25 } };
const VAST_TYPE = 77;   // een "artikeltype" met vaste prijs in de oude databank (bv. verzending)
const nepDb = {
  prepare(sql) {
    return { get(id) {
      if (sql.includes('FROM printers')) return PRINTERS[id];
      if (sql.includes('FROM filament_types')) return id === VAST_TYPE ? { id, vaste_prijs: 1, inkoop_prijs_per_kg: 0 } : { id, vaste_prijs: 0, inkoop_prijs_per_kg: 0 };
      return undefined;
    } };
  },
};

function willekeurigeOfferte(r) {
  const n = 1 + Math.floor(r() * 5);
  const oud = [], nieuw = [];
  for (let i = 0; i < n; i++) {
    const soort = ['ontwerp', 'aanpassing', 'printen', 'printen', 'extra', 'vast'][Math.floor(r() * 6)];
    const hand = r() < 0.15 ? Math.round(r() * 5000) / 100 : undefined;
    if (soort === 'ontwerp' || soort === 'aanpassing') {
      const minuten = Math.floor(r() * 240);
      const tarief = r() < 0.3 ? Math.round(r() * 4000) / 100 : undefined;
      oud.push({ type: soort, minuten, tarief, handmatig_bedrag: hand });
      nieuw.push({ type: soort, minuten, tarief, handmatig_bedrag: hand });
    } else if (soort === 'printen') {
      const pid = 1 + Math.floor(r() * 2);
      const u = Math.floor(r() * 6), min = Math.floor(r() * 60);
      const voorb = Math.floor(r() * 30), nabew = Math.floor(r() * 30);
      // Vergelijkbaar deel: geen materiaal, aantal 1, multicolor (oude motor
      // rekende BMCU enkel bij multicolor; nieuw altijd).
      oud.push({ type: 'printen', printer_id: pid, geschatte_tijd_u: u, geschatte_tijd_min: min, voorbereiding_min: voorb, nabewerking_min: nabew, is_multicolor: true, aantal: 1, geschat_gewicht_g: 0, handmatig_bedrag: hand });
      nieuw.push({ type: 'printen', aantal: 1, printer: { naam: PRINTERS[pid].naam, machine_per_uur: PRINTERS[pid].machine_kost_per_uur, verbruik_watt: PRINTERS[pid].gem_verbruik_watt },
        materialen: [], tijd_min: u * 60 + min, voorbereiding_min: voorb, nabewerking_min: nabew, handmatig_bedrag: hand });
    } else if (soort === 'extra') {
      const bedrag = Math.round(r() * 3000) / 100;
      oud.push({ type: 'extra', bedrag, handmatig_bedrag: hand });
      nieuw.push({ type: 'extra', bedrag, per_stuk: false, handmatig_bedrag: hand });
    } else {
      const bedrag = Math.round(r() * 1500) / 100;
      oud.push({ type: 'extra', bedrag, filament_type_id: VAST_TYPE, handmatig_bedrag: hand });
      nieuw.push({ type: 'artikel', naam: 'Verzending', aantal: 1, prijs: bedrag, vaste_prijs: true, handmatig_bedrag: hand });
    }
  }
  return { oud, nieuw };
}

test('A. 500 willekeurige offertes: nieuwe motor = oude motor op de cent (voor alles wat niet bewust wijzigt)', () => {
  const r = rng(20260924);
  let met = 0;
  for (let k = 0; k < 500; k++) {
    const { oud, nieuw } = willekeurigeOfferte(r);
    const o = oudBereken(nepDb, oud, T);
    const n = bereken(nieuw, T);
    assert.equal(n.volledig, true);
    assert.equal(n.marge_pct, o.marge_pct, `marge #${k}`);
    assert.equal(n.totaal, o.verkoopprijs, `totaal #${k}: ${JSON.stringify(oud)}`);
    assert.equal(n.btw_grondslag, o.verkoopprijs_basis, `btw-grondslag #${k}`);
    if (o.marge_pct === T.marge_groot_pct) met++;
  }
  assert.ok(met > 50, 'beide margetrappen komen aan bod');
});

// ── B. Bewuste wijzigingen (24-09) ────────────────────────────────────────
const A1MINI = { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.18, verbruik_watt: 95 };
const print = (extra = {}) => ({ type: 'printen', aantal: 1, printer: A1MINI, materialen: [], tijd_min: 120, voorbereiding_min: 10, nabewerking_min: 5, ...extra });

test('B1. materiaal = gram × verkoopprijs/kg × faalfactor, ZONDER marge; multicolor per kleur', () => {
  const n = bereken([print({ materialen: [{ naam: 'Bambu PLA Matte · Zwart', gram: 85, prijs_per_kg: 32.5 }] })], T);
  const d = n.regels[0]._berekend.detail;
  assert.equal(Math.round(d.materiaal * 100000) / 100000, 3.03875);           // 85/1000 × 32,5 × 1,10
  // rest: energie 0,095×2×0,35 = 0,0665; machine 0,36; arbeid 3,75; bmcu 0,10 → 4,2765 × 1,18 (2 u < 3 u)
  assert.equal(n.totaal, Math.round((3.03875 + 4.2765 * 1.18) * 100) / 100);
  const multi = bereken([print({ materialen: [{ gram: 40, prijs_per_kg: 25 }, { gram: 10, prijs_per_kg: 40 }] })], T);
  assert.equal(Math.round(multi.regels[0]._berekend.detail.materiaal * 1e6) / 1e6, 1.54);   // (1,00 + 0,40) × 1,10
});

test('B2. geen × aantal: 10 sleutelhangers op één plaat = tijd en gewicht van die plaat; prijs per stuk', () => {
  const een = bereken([print({ aantal: 1 })], T).totaal;
  const tien = bereken([print({ aantal: 10 })], T);
  assert.equal(tien.totaal, een, 'aantal verandert het bedrag niet');
  assert.equal(tien.regels[0]._berekend.per_stuk, Math.round(een / 10 * 10000) / 10000);
});

test('B3. BMCU/AMS bij elke print, ook single-color; 1× per printregel', () => {
  const n = bereken([print(), print()], T);
  assert.equal(n.regels[0]._berekend.detail.bmcu, 0.10);
  assert.equal(n.regels[1]._berekend.detail.bmcu, 0.10, 'twee prints = 2 × € 0,10');
});

test('B4. geen terugval: geen printer, geen machinetarief of geen verbruik → duidelijke fout, geen bedrag', () => {
  let n = bereken([print({ printer: null })], T);
  assert.deepEqual([n.volledig, n.regels[0]._berekend.fout], [false, 'Kies een printer']);
  n = bereken([print({ printer: { naam: 'Bambu Lab A1', machine_per_uur: null, verbruik_watt: 100 } }), { type: 'extra', bedrag: 10 }], T);
  assert.match(n.fouten[0].fout, /machinetarief van Bambu Lab A1/);
  assert.equal(n.totaal, 11.8, 'de andere regels tellen wel');
  n = bereken([print({ printer: { naam: 'Bambu Lab A1', machine_per_uur: 0.2, verbruik_watt: null } })], T);
  assert.match(n.fouten[0].fout, /gemiddeld verbruik/);
  // werkelijk gemeten kWh: dan is het gemiddeld verbruik niet nodig
  n = bereken([print({ printer: { naam: 'Bambu Lab A1', machine_per_uur: 0.2, verbruik_watt: null }, werkelijk: { kwh: 0.3, uren: 2.5 } })], T, { stand: 'werkelijk' });
  assert.equal(n.volledig, true);
  assert.deepEqual([n.regels[0]._berekend.detail.energie_bron, Math.round(n.regels[0]._berekend.detail.energie * 1e6) / 1e6, n.regels[0]._berekend.detail.uren], ['gemeten', 0.105, 2.5]);
});

test('B5. artikelen tegen verkoopprijs zonder marge; vaste prijs buiten de btw-grondslag', () => {
  const n = bereken([
    { type: 'artikel', naam: 'Sleutelhanger hond', aantal: 3, prijs: 8, vaste_prijs: false },
    { type: 'artikel', naam: 'Verzending', aantal: 1, prijs: 6.99, vaste_prijs: true },
    { type: 'extra', omschrijving: 'Doosje', bedrag: 0.5, per_stuk: true, aantal: 3 },
  ], T);
  assert.equal(n.totaal, Math.round((24 + 6.99 + 1.5 * 1.18) * 100) / 100);
  assert.equal(n.btw_grondslag, Math.round((24 + 1.5 * 1.18) * 100) / 100);
  assert.deepEqual(n.regels.map(r => r._berekend.eindbedrag), [24, 6.99, 1.77]);
});

test('B6. handmatig eindbedrag komt er exact uit; ingevulde 0 blijft 0; tarief ontbreekt → fout', () => {
  let n = bereken([print({ handmatig_bedrag: '12,50' }), print({ voorbereiding_min: 0, nabewerking_min: 0 })], T);
  assert.equal(n.regels[0]._berekend.eindbedrag, 12.5);
  assert.equal(n.regels[1]._berekend.detail.arbeid, 0);
  n = bereken([print({ voorbereiding_min: '' })], T);
  assert.equal(n.regels[0]._berekend.detail.voorbereiding_min, 10, 'leeg = standaard uit de tarieven');
  const { bmcu_per_job, ...zonder } = T;
  assert.throws(() => bereken([print()], zonder), /bmcu_per_job/);
  assert.equal(bmcu_per_job, 0.10);
});

test('B7. eindbedragen per regel tellen altijd exact op tot het totaal (1000 willekeurige offertes)', () => {
  const r = rng(7);
  for (let k = 0; k < 1000; k++) {
    const regels = Array.from({ length: 1 + Math.floor(r() * 6) }, () => (r() < 0.5
      ? print({ tijd_min: Math.floor(r() * 600), materialen: [{ gram: Math.floor(r() * 300), prijs_per_kg: 20 + Math.floor(r() * 2000) / 100 }] })
      : { type: 'extra', bedrag: Math.floor(r() * 3333) / 100 }));
    const n = bereken(regels, T);
    const som = Math.round(n.regels.reduce((s, x) => s + x._berekend.eindbedrag, 0) * 100) / 100;
    assert.equal(som, n.totaal, `#${k}`);
  }
});

// ── C. API ───────────────────────────────────────────────────────────────
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

test('C1. printers: lijst, tarief invullen, deactiveren, dubbel geweigerd', async () => {
  let r = await vraag('GET', '/printers');
  assert.deepEqual(r.data.map(p => p.naam).sort(), ['AnyCubic Kobra S1', 'Bambu Lab A1', 'Bambu Lab A1 Mini']);
  const mini = r.data.find(p => p.naam === 'Bambu Lab A1 Mini');
  r = await vraag('PUT', `/printers/${mini.id}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: '0,18', verbruik_watt: 95 });
  assert.equal(r.status, 200);
  r = await vraag('POST', '/printers', { naam: 'bambu lab a1' });
  assert.equal(r.status, 400);
  r = await vraag('POST', '/printers', { naam: 'Oude Ender', machine_per_uur: -1 });
  assert.equal(r.status, 400);
  const ender = (await vraag('POST', '/printers', { naam: 'Oude Ender', machine_per_uur: 0.1, verbruik_watt: 150 })).data.id;
  await vraag('PATCH', `/printers/${ender}/actief`, { actief: false });
  r = await vraag('GET', '/printers?actief=1');
  assert.ok(!r.data.some(p => p.id === ender));
  r = await vraag('GET', `/historiek/printer/${mini.id}`);
  assert.match(r.data[0].tekst, /Machinetarief \(€\/u\) ingevuld: 0.18/);
});

test('C2. POST /api/bereken met id\'s: printer, filamentartikel, verkocht artikel', async () => {
  const db = getDb();
  const mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  const a1 = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1'`).get().id;
  const pg = db.prepare('INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg) VALUES (1, 4, 32.5)').run().lastInsertRowid;
  const zwart = (await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: 1 })).data.id;
  const hond = (await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Hond', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 8 })).data.id;
  const ring = (await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Ring', wordt_gekocht: true })).data.id;
  const r = await vraag('POST', '/bereken', { regels: [
    { type: 'printen', printer_id: mini, aantal: 10, tijd_min: 120, voorbereiding_min: 10, nabewerking_min: 5, materialen: [{ artikel_id: zwart, gram: 85 }] },
    { type: 'artikel', artikel_id: hond, aantal: 2 },
    { type: 'artikel', artikel_id: ring, aantal: 1 },
    { type: 'printen', printer_id: a1, tijd_min: 30, materialen: [] },
  ] });
  assert.equal(r.status, 200);
  const b = r.data;
  assert.equal(b.regels[0]._berekend.detail.materialen[0].naam, 'Bambu Lab PLA Matte · Zwart');
  assert.equal(Math.round(b.regels[0]._berekend.detail.materiaal * 1e5) / 1e5, 3.03875);
  assert.equal(b.regels[1]._berekend.eindbedrag, 16);
  assert.match(b.regels[2]._berekend.fout, /Geen verkoopprijs voor Ring/, 'een artikel dat niet verkocht wordt');
  assert.match(b.regels[3]._berekend.fout, /machinetarief van Bambu Lab A1/);
  assert.equal(b.volledig, false);
  assert.equal(b.totaal, Math.round((3.03875 + 4.2765 * 1.18 + 16) * 100) / 100);
  assert.equal((await vraag('POST', '/bereken', { regels: 'x' })).status, 400);
});
