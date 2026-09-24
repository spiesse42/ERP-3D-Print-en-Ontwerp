// Stap 7: financieel overzicht (omzet, ontvangen, aankopen, saldo),
// drempels pro rata, opvolging, marges (echte kost), statistieken, CSV,
// instellingen met controle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); stopWachter(); sluitDb(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = res.headers.get('content-type') || '';
  if (t.includes('csv')) return { status: res.status, tekst: await res.text() };
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
const J = 2025;   // vast jaar in het verleden: niets van "vandaag" loopt mee
let klant, d1, d2, d3, mini;

test('W0. voorbereiding: afgerekende dossiers, aankopen, printopdrachten, runs', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  klant = ok(await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Sofie', naam: 'Maes' }), 201).id;
  d1 = ok(await vraag('POST', '/dossiers', { titel: 'Factuur', klant_id: klant, regels: [{ type: 'printen', omschrijving: 'A', printer_id: mini, aantal: 2, tijd_min: 60 }] }), 201);
  d2 = ok(await vraag('POST', '/dossiers', { titel: 'Bonnetje', klant_id: klant, regels: [{ type: 'printen', omschrijving: 'B', printer_id: mini, aantal: 1, tijd_min: 30 }] }), 201);
  d3 = ok(await vraag('POST', '/dossiers', { titel: 'Nog af te rekenen', klant_id: klant, regels: [{ type: 'printen', omschrijving: 'C', printer_id: mini, aantal: 1, tijd_min: 30 }] }), 201);
  const af = db.prepare(`UPDATE dossiers SET afgerekend_soort = ?, afgerekend_nummer = ?, afgerekend_op = ?, afgerekend_bedrag = ?, betaald_op = ? WHERE id = ?`);
  af.run('factuur', 'F2025-001', `${J}-03-10`, 100, null, d1.id);           // onbetaald
  af.run('bonnetje', 'B2025-007', `${J}-03-20`, 40, `${J}-03-20`, d2.id);    // meteen betaald
  // aankopen: één besteld (telt), één concept (telt niet), één geannuleerd (telt niet)
  const ak = db.prepare(`INSERT INTO aankopen (nummer, datum, besteld_op, geannuleerd_op) VALUES (?,?,?,?)`);
  const rg = db.prepare(`INSERT INTO aankoop_regels (aankoop_id, omschrijving, aantal, prijs_per_eenheid) VALUES (?,?,?,?)`);
  let id = ak.run('AK-1', `${J}-03-05`, `${J}-03-05`, null).lastInsertRowid; rg.run(id, 'PLA', 2, 20); rg.run(id, 'Verzending', 1, 5);
  id = ak.run('AK-2', `${J}-04-05`, null, null).lastInsertRowid; rg.run(id, 'x', 1, 999);
  id = ak.run('AK-3', `${J}-04-06`, `${J}-04-06`, `${J}-04-07`).lastInsertRowid; rg.run(id, 'x', 1, 999);
  // printopdracht voor d1 met productiekost; d2 zonder metingen
  const po = db.prepare(`INSERT INTO printopdrachten (printer_id, dossier_regel_id, soort, naam, aantal, aantal_goed, voltooid_op, productiekost_stuk, arbeid_stuk)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(mini, d1.regels[0].id, 'klant', 'A', 2, 2, `${J}-03-09 10:00:00`, 3.5, 1).lastInsertRowid;
  const run = db.prepare(`INSERT INTO printruns (printer_id, gestart_op, geeindigd_op, uitkomst, kwh, printopdracht_id, bron) VALUES (?,?,?,?,?,?,'manueel')`);
  run.run(mini, `${J}-03-09T08:00:00Z`, `${J}-03-09T10:00:00Z`, 'klaar', 0.2, po);
  run.run(mini, `${J}-03-08T08:00:00Z`, `${J}-03-08T09:00:00Z`, 'mislukt', 0.1, po);
});

test('W1. jaaroverzicht: omzet op afrekendatum, ontvangen op betaaldatum, enkel bestelde aankopen', async () => {
  const o = ok(await vraag('GET', `/financien/overzicht?jaar=${J}`));
  const maart = o.maanden.find(m => m.maand === `${J}-03`);
  assert.deepEqual([maart.omzet, maart.facturen, maart.bonnetjes, maart.ontvangen, maart.aankopen, maart.saldo], [140, 1, 1, 40, 45, -5]);
  assert.equal(o.maanden.find(m => m.maand === `${J}-04`).aankopen, 0, 'concept en geannuleerd tellen niet');
  assert.deepEqual([o.totaal.omzet, o.totaal.winst], [140, 95]);
  assert.ok(o.jaren.includes(J));
  // drempels: standaard, volledig jaar (geen startdatum)
  assert.equal(o.drempels.omzet.drempel, 25000); assert.equal(o.drempels.pro_rata, false);
  assert.equal(o.drempels.winst.drempel, 1881.76);
  assert.equal((await vraag('GET', '/financien/overzicht?jaar=abc')).status, 400);
});

test('W2. drempels: pro rata vanaf de startdatum, instelbaar, met controle', async () => {
  assert.match((await vraag('PUT', '/instellingen', { bedrijf_startdatum: '1-7-2025' })).data.error, /JJJJ-MM-DD/);
  assert.match((await vraag('PUT', '/instellingen', { drempel_omzet_jaar: 'veel' })).data.error, /bedrag/);
  ok(await vraag('PUT', '/instellingen', { bedrijf_startdatum: `${J}-07-01`, drempel_omzet_jaar: '25000', drempel_winst_jaar: '2000' }));
  const d = ok(await vraag('GET', `/financien/overzicht?jaar=${J}`)).drempels;
  assert.equal(d.dagen, 184); assert.equal(d.pro_rata, true);
  assert.equal(d.omzet.drempel, Math.round(25000 * 184 / 365 * 100) / 100);
  assert.equal(d.winst.drempel_vol, 2000);
  // een later jaar: volle drempel
  assert.equal(ok(await vraag('GET', `/financien/overzicht?jaar=${J + 1}`)).drempels.pro_rata, false);
  ok(await vraag('PUT', '/instellingen', { drempel_winst_jaar: '' }));
  assert.equal(ok(await vraag('GET', `/financien/overzicht?jaar=${J}`)).drempels.winst.drempel_vol, 1881.76, 'leeg = standaard');
});

test('W3. opvolging: onbetaalde factuur met ouderdom; klare maar niet afgerekende opdracht', async () => {
  // d3 klaar maken: printopdracht met genoeg goede stuks
  const db = getDb();
  db.prepare(`INSERT INTO printopdrachten (printer_id, dossier_regel_id, soort, naam, aantal, aantal_goed, voltooid_op) VALUES (?,?,?,?,?,?,datetime('now'))`)
    .run(mini, d3.regels[0].id, 'klant', 'C', 1, 1);
  const o = ok(await vraag('GET', '/financien/opvolging'));
  assert.deepEqual(o.onbetaald.map(x => x.afgerekend_nummer), ['F2025-001']);
  assert.ok(o.onbetaald[0].dagen_open > 100);
  assert.equal(o.onbetaald_totaal, 100);
  assert.deepEqual(o.te_afrekenen.map(x => x.id), [d3.id]);
  assert.equal(o.te_afrekenen[0].fase, 'klaar');
});

test('W4. marges: echte kost uit de printopdrachten, arbeid apart, onvolledig zonder metingen', async () => {
  const m = ok(await vraag('GET', `/financien/marges?jaar=${J}`));
  const f = m.rijen.find(x => x.id === d1.id), b = m.rijen.find(x => x.id === d2.id);
  assert.deepEqual([f.kost, f.arbeid, f.marge, f.marge_met_arbeid, f.marge_pct, f.onvolledig], [7, 2, 93, 91, 93, false]);
  assert.equal(b.onvolledig, true); assert.deepEqual(b.redenen, ['printwerk zonder metingen']);
  assert.deepEqual([m.totaal.bedrag, m.totaal.kost], [140, 7]);
  const csv = await vraag('GET', `/financien/csv/marges?jaar=${J}`);
  assert.ok(csv.tekst.startsWith('"Dossier";"Titel"'));
  assert.ok(csv.tekst.includes(';100;7;2;93;91;93'));
  assert.ok((await vraag('GET', `/financien/csv/overzicht?jaar=${J}`)).tekst.includes(`"${J}-03";140;1;1;40;45;-5`));
});

test('W5. statistieken: runs per maand en per printer, energie, omzet', async () => {
  const s = ok(await vraag('GET', `/financien/statistieken?jaar=${J}`));
  const maart = s.maanden.find(m => m.maand === `${J}-03`);
  assert.deepEqual([maart.runs, maart.geslaagd, maart.mislukt, maart.uren, maart.kwh, maart.afgerekend, maart.omzet], [2, 1, 1, 3, 0.3, 2, 140]);
  assert.equal(maart.energiekost, Math.round(0.3 * s.kwh_prijs * 100) / 100);
  const p = s.printers.find(x => x.id === mini);
  assert.deepEqual([p.runs, p.geslaagd, p.mislukt, p.slaagpct], [2, 1, 1, 50]);
  assert.deepEqual(s.klanten.map(k => [k.naam, k.dossiers, k.omzet]), [['Sofie Maes', 2, 140]]);
});
