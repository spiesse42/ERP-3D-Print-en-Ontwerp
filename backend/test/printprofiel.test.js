// 06-10: vaste producten — printregel per stuk, stuks per plaat (één
// printopdracht per plaat, BMCU per plaat), printprofiel op het artikel en
// bijprinten volgens het profiel.
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
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
let mini, zwart, pg, medaillon, klant;

test('P0. voorbereiding', async () => {
  const db = getDb();
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  ok(await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 95 }));
  pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: db.prepare(`SELECT id FROM filament_kleuren WHERE naam = 'Zwart'`).get().id }), 201).id;
  medaillon = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Medaillon', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 6 }), 201).id;
  klant = ok(await vraag('POST', '/klanten', { type: 'particulier', naam: 'Leijs' }), 201).id;
});

test('P1. per_plaat: BMCU en standaard-voorbereiding per plaat', async () => {
  const regel = { type: 'printen', printer_id: mini, aantal: 22, tijd_min: 22 * 30, materialen: [{ artikel_id: zwart, gram: 22 * 12 }] };
  const een = ok(await vraag('POST', '/bereken', { regels: [regel] })).regels[0]._berekend.detail;
  const drie = ok(await vraag('POST', '/bereken', { regels: [{ ...regel, per_plaat: 8 }] })).regels[0]._berekend.detail;
  assert.equal(een.platen, 1); assert.equal(drie.platen, 3);
  assert.ok(Math.abs(drie.bmcu - 3 * een.bmcu) < 1e-9);
  assert.equal(drie.voorbereiding_min, 3 * een.voorbereiding_min);
  assert.equal(drie.materiaal, een.materiaal, 'materiaal blijft hetzelfde');
});

test('P2. klantdossier 22 stuks, 8 per plaat → printopdrachten 8 + 8 + 6; per_stuk blijft bewaard', async () => {
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Medaillons', regels: [
    { type: 'printen', omschrijving: 'Medaillon', printer_id: mini, aantal: 22, tijd_min: 660, per_stuk: true, per_plaat: 8, materialen: [{ artikel_id: zwart, gram: 264 }] }] }), 201);
  assert.equal(d.regels[0].per_stuk, true); assert.equal(d.regels[0].per_plaat, 8);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  const aantallen = s.productie.regels[0].opdrachten.map(o => o.aantal).sort((a, b) => b - a);
  assert.deepEqual(aantallen, [8, 8, 6]);
  // aantal verhogen naar 30 → aangevuld tot volle platen: 8 + 8 + 8 + 6
  const w = ok(await vraag('PUT', `/dossiers/${d.id}`, { soort: 'klant', klant_id: klant, titel: 'Medaillons', regels: [{ ...s.regels[0], aantal: 30, tijd_min: 900, materialen: [{ artikel_id: zwart, gram: 360 }] }] }));
  assert.deepEqual(w.productie.regels[0].opdrachten.map(o => o.aantal).sort((a, b) => b - a), [8, 8, 8, 6]);
});

test('P3. printprofiel bewaren (validatie) en bijprinten volgens profiel', async () => {
  assert.match((await vraag('PUT', `/productie/printprofiel/${zwart}`, { profiel: { tijd_min: 30 } })).data.error, /zelf printen/);
  assert.match((await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: { per_plaat: 8 } })).data.error, /printtijd of het gewicht/);
  const p = ok(await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: { printer_id: mini, tijd_min: 30, per_plaat: 8, voorbereiding_min: 5, nabewerking_min: 1, materialen: [{ artikel_id: zwart, gram: 12 }] } })).profiel;
  assert.equal(p.per_plaat, 8);
  const lijst = ok(await vraag('GET', '/productie/printprofielen'));
  assert.equal(lijst.length, 1); assert.equal(lijst[0].id, medaillon);
  // bijprinten zonder printer: die van het profiel
  const u = ok(await vraag('POST', '/productie/eigen-product', { artikel_id: medaillon, aantal: 22 }), 201);
  assert.equal(u.profiel, true); assert.equal(u.opdrachten, 3);
  const d = ok(await vraag('GET', `/dossiers/${u.dossier_id}`));
  const r = d.regels[0];
  assert.equal(r.tijd_min, 660); assert.equal(r.materialen[0].gram, 264);
  assert.equal(r.voorbereiding_min, 15, '5 min × 3 platen'); assert.equal(r.nabewerking_min, 22);
  assert.equal(r.per_stuk, true); assert.equal(r.artikel_id, medaillon);
  // profiel wissen
  assert.equal(ok(await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: null })).profiel, null);
});

test('P4. volledig geleverde printregel: geplande printopdrachten vervallen; levering ongedaan → komen terug', async () => {
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Geleverd', regels: [
    { type: 'printen', omschrijving: 'Testprint', printer_id: mini, aantal: 1, tijd_min: 30, materialen: [{ artikel_id: zwart, gram: 10 }] }] }), 201);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  assert.equal(s.productie.regels[0].opdrachten.length, 1);
  const na = ok(await vraag('POST', `/dossiers/${d.id}/leveringen`, { datum: '2026-10-07', regels: [{ regel_id: s.regels[0].id, aantal: 1 }] }), 201);
  assert.equal(na.productie.regels[0].opdrachten.filter(o => !o.geannuleerd_op).length, 0, 'geplande opdracht weg');
  const lev = getDb().prepare('SELECT id FROM leveringen WHERE dossier_id = ?').get(d.id).id;
  const terug = ok(await vraag('DELETE', `/leveringen/${lev}`));
  assert.equal(terug.productie.regels[0].opdrachten.length, 1, 'levering ongedaan → opdracht terug');
});

test('P5. productiekost (schatting) per printregel, totaal en per geplande printopdracht', async () => {
  getDb().prepare('UPDATE artikelen SET inkoopprijs = 20 WHERE id = ?').run(zwart);   // 20 €/rol van 1 kg
  const regel = { type: 'printen', printer_id: mini, aantal: 2, tijd_min: 120, materialen: [{ artikel_id: zwart, gram: 100 }] };
  const b = ok(await vraag('POST', '/bereken', { regels: [regel] }));
  const k = b.regels[0]._berekend.kost;
  const rolg = getDb().prepare('SELECT rolgewicht_g g FROM filament_types WHERE id = ?').get(pg).g;
  assert.equal(k.filament, Math.round(100 / 1000 * 20 / rolg * 1000 * 10000) / 10000, 'filament aan inkoopprijs, zonder faalfactor');
  assert.equal(k.machine, 0.4, '2 u × 0,20');
  assert.ok(Math.abs(k.kost - (k.filament + k.energie + k.machine + k.bmcu)) < 1e-3);
  assert.ok(Math.abs(k.winst - (b.regels[0]._berekend.eindbedrag - k.kost)) < 1e-3);
  assert.equal(b.productiekost.kost, k.kost);
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Kost', regels: [{ ...regel, omschrijving: 'Kost' }] }), 201);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  const o = s.productie.regels[0].opdrachten[0];
  assert.ok(o.kost_schatting && Math.abs(o.kost_schatting.machine - 0.4) < 1e-3, 'geplande opdracht krijgt een schatting');
});

test('P6. printuurmodel: winst per printuur, materiaal minstens inkoop × opslag, oude berekening ter vergelijking', async () => {
  ok(await vraag('PUT', '/tarieven', { winst_per_printuur: 1, materiaal_opslag_pct: 200, winst_lang_grens_uur: 12, winst_lang_pct: 60 }));
  try {
    getDb().prepare('UPDATE artikelen SET inkoopprijs = 20 WHERE id = ?').run(zwart);
    const regel = { type: 'printen', printer_id: mini, aantal: 1, tijd_min: 20 * 60, materialen: [{ artikel_id: zwart, gram: 100 }] };
    const b = ok(await vraag('POST', '/bereken', { regels: [regel] }));
    const d = b.regels[0]._berekend.detail;
    assert.equal(b.model, 'printuur');
    assert.equal(b.marge_pct, 0);
    assert.ok(Math.abs(d.winst - (12 + 8 * 0.6)) < 1e-9, '12 u × € 1 + 8 u × € 0,60');
    const kg = d.materialen[0].prijs_per_kg;
    assert.ok(kg >= 25 && Math.abs(kg - Math.max(25, 20 / (getDb().prepare('SELECT rolgewicht_g g FROM filament_types WHERE id = ?').get(pg).g / 1000) * 2)) < 0.01, 'max(verkoop, inkoop × 2)');
    assert.ok(b.oud && b.oud.totaal < b.totaal, 'oude berekening lager');
    assert.equal(b.regels[0]._berekend.oud, b.oud.regels[0]);
  } finally {
    ok(await vraag('PUT', '/tarieven', { winst_per_printuur: 0, materiaal_opslag_pct: 0 }));
  }
});

test('P7. adviesprijs per stuk uit het printprofiel; slicerbestand als bijlage bij het artikel', async () => {
  ok(await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: { printer_id: mini, tijd_min: 30, per_plaat: 8, materialen: [{ artikel_id: zwart, gram: 12 }] } }));
  const k = ok(await vraag('GET', `/producten/${medaillon}/kost`));
  assert.ok(k.advies?.stuk > 0, 'adviesprijs voor 1 stuk');
  assert.equal(k.advies.per_plaat, 8);
  assert.ok(k.advies.plaat_stuk > 0 && k.advies.plaat_stuk <= k.advies.stuk, 'volle plaat: per stuk niet duurder');
  const p = ok(await vraag('PUT', `/productie/printprofiel/${medaillon}`, { profiel: { printer_id: mini, tijd_min: 30, slicer_bijlage_id: 999999, materialen: [] } }));
  assert.equal(p.profiel?.slicer_bijlage_id ?? p.slicer_bijlage_id ?? undefined, undefined, 'onbekende bijlage valt weg');
});

test('P8. foto per run: bewaren en ophalen', async () => {
  const { bewaarRunFoto } = await import('../productie/runfoto.js');
  const x = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: new Date(Date.now() - 2 * 3600e3).toISOString(), geeindigd_op: new Date(Date.now() - 3600e3).toISOString(), uitkomst: 'klaar' }), 201);
  assert.equal(ok(await vraag('GET', `/productie/runs/${x.id}`)).foto, false);
  bewaarRunFoto(getDb(), x.id, { type: 'image/png', data: Buffer.from([137, 80, 78, 71]) });
  assert.equal(ok(await vraag('GET', `/productie/runs/${x.id}`)).foto, true);
  const res = await fetch(`${basis}/productie/runs/${x.id}/foto`);
  assert.equal(res.status, 200);
  assert.equal((await res.arrayBuffer()).byteLength, 4);
});

test('P9. geplande printopdracht verwijderen verlaagt de regel (per stuk: tijd en gram mee), en komt niet terug', async () => {
  const d = ok(await vraag('POST', '/dossiers', { soort: 'eigen', titel: 'Kerstballen', regels: [
    { type: 'printen', omschrijving: 'Kerstbal', printer_id: mini, aantal: 4, per_stuk: true, per_plaat: 1, tijd_min: 4 * 60, materialen: [{ artikel_id: zwart, gram: 4 * 20 }] }] }), 201);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  const ops = s.productie.regels[0].opdrachten;
  assert.equal(ops.length, 4);
  ok(await vraag('DELETE', `/productie/opdrachten/${ops[3].id}?regel=1`));
  const na = ok(await vraag('GET', `/dossiers/${d.id}`));
  const r = na.regels[0];
  assert.equal(r.aantal, 3); assert.equal(r.tijd_min, 180); assert.equal(r.materialen[0].gram, 60);
  assert.equal(na.productie.regels[0].opdrachten.filter(o => !o.geannuleerd_op).length, 3, 'niet opnieuw aangemaakt');
  // zonder ?regel=1 blijft de oude regel gelden (fout)
  assert.equal((await vraag('DELETE', `/productie/opdrachten/${ops[2].id}`)).status, 400);
});

test('P10. kostenopbouw over het dossier: som van de regels, schatting per opdracht klopt, gemeten naast de schatting', async () => {
  const db = getDb();
  db.prepare('UPDATE artikelen SET inkoopprijs = 20 WHERE id = ?').run(zwart);
  const regels = [
    { type: 'printen', omschrijving: 'A', printer_id: mini, aantal: 6, per_stuk: true, per_plaat: 3, tijd_min: 6 * 30, materialen: [{ artikel_id: zwart, gram: 6 * 10 }] },
    { type: 'printen', omschrijving: 'B', printer_id: mini, aantal: 1, tijd_min: 90, materialen: [{ artikel_id: zwart, gram: 50 }] },
  ];
  const b = ok(await vraag('POST', '/bereken', { regels }));
  const k = b.regels.map(r => r._berekend.kost), o = b.productiekost.opbouw;
  for (const veld of ['filament', 'energie', 'machine', 'bmcu', 'arbeid', 'kost']) assert.ok(Math.abs(o[veld] - (k[0][veld] + k[1][veld])) < 0.01, veld);
  assert.equal(o.gram, 110); assert.equal(o.runs, 3); assert.equal(o.uren, 4.5);
  assert.ok(Math.abs(o.kwh - 4.5 * 0.095) < 1e-3, 'kWh = watt × uren');
  assert.equal(o.filamenten.length, 1); assert.equal(o.filamenten[0].gram, 110);
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Opbouw', regels }), 201);
  const s = ok(await vraag('POST', `/dossiers/${d.id}/starten`));
  const ops = s.productie.regels.flatMap(r => r.opdrachten);
  assert.equal(ops.length, 3);
  for (const veld of ['filament', 'machine', 'bmcu', 'arbeid']) {
    assert.ok(Math.abs(ops.reduce((t, x) => t + x.kost_schatting[veld], 0) - o[veld]) < 0.01, `schatting opdrachten = regels (${veld})`);
  }
  // één opdracht voltooien met een gemeten run van 2 u en 0,3 kWh
  const x = ops.find(y => y.aantal === 1);
  db.prepare(`INSERT INTO printruns (printer_id, printopdracht_id, gestart_op, geeindigd_op, uitkomst, kwh) VALUES (?, ?, ?, ?, 'klaar', 0.3)`)
    .run(mini, x.id, new Date(Date.now() - 3 * 3600e3).toISOString(), new Date(Date.now() - 3600e3).toISOString());
  ok(await vraag('POST', `/productie/opdrachten/${x.id}/bevestig`, { aantal_goed: 1 }));
  assert.ok(db.prepare('SELECT kost_detail FROM printopdrachten WHERE id = ?').get(x.id).kost_detail, 'opbouw bewaard');
  const g = ok(await vraag('GET', `/dossiers/${d.id}`)).productie.gemeten;
  assert.equal(g.voltooid, 1);
  assert.equal(g.opbouw.kwh, 0.3); assert.ok(Math.abs(g.opbouw.uren - 2) < 0.01);
  assert.ok(Math.abs(g.opbouw.kost - g.kost) < 0.01, 'opbouw = gemeten kost');
  assert.ok(Math.abs(g.schatting_voltooid.uren - 1.5) < 1e-3, 'schatting van dezelfde opdracht: 1,5 u');
});

test('P11. prijsopbouw: de posten samen geven exact het totaal (ook met handmatig bedrag, ontwerp en artikel)', async () => {
  const regels = [
    { type: 'printen', printer_id: mini, aantal: 3, tijd_min: 200, materialen: [{ artikel_id: zwart, gram: 75 }] },
    { type: 'printen', printer_id: mini, aantal: 1, tijd_min: 60, materialen: [{ artikel_id: zwart, gram: 20 }], handmatig_bedrag: 9.99 },
    { type: 'ontwerp', minuten: 45 },
    { type: 'artikel', artikel_id: medaillon, aantal: 2 },
    { type: 'extra', omschrijving: 'Doos', bedrag: 1.5 },
  ];
  for (const winst of [0, 1]) {
    ok(await vraag('PUT', '/tarieven', { winst_per_printuur: winst }));
    const b = ok(await vraag('POST', '/bereken', { regels }));
    const p = b.prijsopbouw;
    const som = ['materiaal', 'energie', 'machine', 'arbeid', 'bmcu', 'winst', 'marge', 'ontwerp', 'aanpassing', 'artikelen', 'extra', 'handmatig', 'afronding'].reduce((x, k) => x + p[k], 0);
    assert.ok(Math.abs(som - b.totaal) < 0.001, `${som} ≠ ${b.totaal}`);
    assert.ok(Math.abs(p.afronding) < 0.01, 'enkel afronding');
    assert.equal(p.artikelen, 12); assert.equal(p.ontwerp_min, 45); assert.equal(p.gram, 95);
    if (winst) assert.equal(p.marge, 0); else assert.ok(p.marge > 0);
  }
  ok(await vraag('PUT', '/tarieven', { winst_per_printuur: 0 }));
});

test('P12. prijsopbouw-overzicht: stroom en kost per uur per printer, filament per kg met faalfactor', async () => {
  const x = ok(await vraag('GET', '/tarieven/prijsopbouw'));
  const t = Object.fromEntries(x.tarieven.map(r => [r.sleutel, r.waarde]));
  const p = x.printers.find(y => y.id === mini);
  assert.ok(Math.abs(p.stroom_per_uur - 95 / 1000 * t.kwh_prijs) < 1e-4);
  assert.ok(Math.abs(p.kost_per_uur - (p.stroom_per_uur + 0.2)) < 1e-4);
  const g = x.groepen.find(y => y.verkoopprijs_per_kg === 25);
  assert.ok(Math.abs(g.prijs_per_kg - 25 * (1 + t.faalfactor_pct / 100)) < 1e-4, 'oud model: verkoopprijs × faalfactor');
});

test('P13. kortingen: filament, printuren en regel in % of €; korting op het totaal als regel; prijsopbouw sluit', async () => {
  const regel = { type: 'printen', printer_id: mini, aantal: 1, tijd_min: 600, materialen: [{ artikel_id: zwart, gram: 1000 }] };
  const zonder = ok(await vraag('POST', '/bereken', { regels: [regel] }));
  const d0 = zonder.regels[0]._berekend.detail;
  // 35 % op het filament
  const a = ok(await vraag('POST', '/bereken', { regels: [{ ...regel, korting: { materiaal: { waarde: 35, soort: 'pct' } } }] }));
  assert.ok(Math.abs((zonder.totaal - a.totaal) - d0.materiaal * 0.35) < 0.011, 'totaal daalt met 35 % van het filament');
  assert.ok(Math.abs(a.prijsopbouw.korting_materiaal + d0.materiaal * 0.35) < 0.001);
  // € 1 op de printuren + 10 % op de regel
  const b = ok(await vraag('POST', '/bereken', { regels: [{ ...regel, korting: { printuren: { waarde: 1, soort: 'eur' }, regel: { waarde: 10, soort: 'pct' } } }] }));
  assert.ok(Math.abs(b.totaal - (zonder.totaal - 1) * 0.9) < 0.011);
  // korting op het totaal: € 5 als aparte regel, niet op een vaste prijs
  const c = ok(await vraag('POST', '/bereken', { regels: [regel, { type: 'korting', korting: { totaal: { waarde: 5, soort: 'eur' } } }] }));
  assert.equal(c.regels[1]._berekend.eindbedrag, -5);
  assert.ok(Math.abs(c.totaal - (zonder.totaal - 5)) < 0.011);
  const som = ['materiaal', 'energie', 'machine', 'arbeid', 'bmcu', 'winst', 'marge', 'ontwerp', 'aanpassing', 'artikelen', 'extra', 'handmatig',
    'korting_materiaal', 'korting_printuren', 'korting_regels', 'korting_totaal', 'afronding'].reduce((x, k) => x + c.prijsopbouw[k], 0);
  assert.ok(Math.abs(som - c.totaal) < 0.001, 'posten = totaal');
  // bewaren in een dossier en terug lezen; > 100 % geweigerd
  const d = ok(await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Korting', regels: [
    { ...regel, korting: { materiaal: { waarde: '35,06', soort: 'pct' } } }, { type: 'korting', korting: { totaal: { waarde: 10, soort: 'pct' } } }] }), 201);
  const l = ok(await vraag('GET', `/dossiers/${d.id}`));
  assert.deepEqual(l.regels[0].korting, { materiaal: { waarde: 35.06, soort: 'pct' } });
  assert.equal(l.regels[1].type, 'korting');
  assert.ok(l.berekening.regels[1]._berekend.eindbedrag < 0);
  assert.equal((await vraag('POST', '/dossiers', { soort: 'klant', klant_id: klant, titel: 'Fout', regels: [{ ...regel, korting: { regel: { waarde: 120, soort: 'pct' } } }] })).status, 400);
});
