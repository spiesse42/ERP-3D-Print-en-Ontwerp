// Slicerbestand inlezen (28-09): geslicet 3mf uit Bambu Studio → platen met
// tijd, grammen en kleuren; voorstel voor printer, prijsgroep en kleur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';
import { documentHtml } from '../documenten/sjabloon.js';
import { leesDossier } from '../domein/dossiers.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); stopWachter(); sluitDb(); });

async function lees(buffer, naam = 'figuurtjes.gcode.3mf') {
  const fd = new FormData();
  fd.append('bestand', new Blob([buffer]), naam);
  const res = await fetch(`${basis}/slicer`, { method: 'POST', body: fd });
  return { status: res.status, data: await res.json() };
}

// Zoals Bambu Studio het schrijft (ingekort): enkel geslicete platen in slice_info.
async function bambu3mf({ platen, namen = {}, zonderSlice = false }) {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', '<model/>');
  zip.file('Metadata/project_settings.config', JSON.stringify({
    printer_model: 'Bambu Lab A1',
    filament_vendor: ['eSUN', 'Bambu Lab', 'Generic', 'eSUN'],
    filament_type: ['PLA', 'PLA', 'PETG', 'PLA'],
    filament_settings_id: ['eSUN PLA+ @BBL A1', 'Bambu PLA Matte @BBL A1', 'Generic PETG @BBL A1', 'eSUN PLA+ @BBL A1'],
    filament_colour: ['#1E88E5', '#FFFFFF', '#000000', '#F57C00'],
  }));
  zip.file('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?><config>${
    Object.entries(namen).map(([n, naam]) => `<plate><metadata key="plater_id" value="${n}"/><metadata key="plater_name" value="${naam}"/></plate>`).join('')}</config>`);
  zip.file('Metadata/slice_info.config', `<?xml version="1.0" encoding="UTF-8"?><config><header><header_item key="X-BBL-Client-Type" value="slicer"/></header>${zonderSlice ? '' : platen.map(p => `
    <plate>
      <metadata key="index" value="${p.nr}"/><metadata key="printer_model_id" value="N2S"/>
      <metadata key="prediction" value="${p.sec}"/><metadata key="weight" value="${p.gewicht}"/>
      ${p.objecten.map(o => `<object identify_id="1" name="${o}" skipped="false"/>`).join('')}
      ${p.filamenten.map(f => `<filament id="${f.slot}" tray_info_idx="GFL99" type="${f.type}" color="${f.kleur}" used_m="1" used_g="${f.g}"/>`).join('')}
    </plate>`).join('')}</config>`);
  for (const p of platen) zip.file(`Metadata/plate_${p.nr}.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('S1. platen met tijd, gram, objecten, naam en afbeelding; voorstel printer en filament', async () => {
  const db = getDb();
  const pla = db.prepare(`INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg) VALUES (4, 2, 25)`).run().lastInsertRowid;   // eSUN PLA+
  const matte = db.prepare(`INSERT INTO filament_types (merk_id, materiaal_id, verkoopprijs_per_kg) VALUES (1, 4, 30)`).run().lastInsertRowid; // Bambu Lab PLA Matte
  const blauw = db.prepare(`INSERT INTO artikelen (type, filament_type_id, kleur_id, wordt_gekocht) VALUES ('filament', ?, 8, 1)`).run(pla).lastInsertRowid;
  const buf = await bambu3mf({
    namen: { 2: 'Bluey hoofd' },
    platen: [
      { nr: 1, sec: 48600, gewicht: 135.2, objecten: ['Bluey.stl'], filamenten: [
        { slot: 1, type: 'PLA', kleur: '#1E88E5', g: 60 }, { slot: 2, type: 'PLA', kleur: '#FFFFFF', g: 25 },
        { slot: 3, type: 'PETG', kleur: '#000000', g: 30 }, { slot: 4, type: 'PLA', kleur: '#F57C00', g: 20 }, { slot: 1, type: 'PLA', kleur: '#1E88E5', g: 0 }] },
      { nr: 2, sec: 3600, gewicht: 10, objecten: ['Oor links.stl', 'Oor rechts.stl'], filamenten: [{ slot: 1, type: 'PLA', kleur: '#1E88E5', g: 10 }] },
    ],
  });
  const { status, data } = await lees(buf);
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.printer_id, db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1'`).get().id);
  const [p1, p2] = data.platen;
  assert.equal(p1.nummer, 1); assert.equal(p1.naam, 'Bluey'); assert.equal(p1.tijd_min, 810); assert.equal(p1.gram, 135.2);
  assert.match(p1.afbeelding, /^data:image\/png;base64,/);
  assert.equal(p1.filamenten.length, 4, 'slot zonder gram valt weg');
  const [f1, f2, f3, f4] = p1.filamenten;
  assert.deepEqual([f1.keuze, f1.zeker], [`a:${blauw}`, true], 'eSUN PLA+ blauw → het artikel');
  assert.deepEqual([f2.keuze, f2.zeker], [`p:${matte}`, true], 'Bambu PLA Matte → prijsgroep (geen artikel in die kleur)');
  assert.deepEqual([f3.keuze, f3.zeker], [null, false], 'PETG: geen prijsgroep');
  assert.deepEqual([f4.keuze, f4.zeker], [`p:${pla}`, true], 'oranje: geen artikel dichtbij → prijsgroep');
  assert.equal(p2.naam, 'Bluey hoofd', 'naam van de plaat in Bambu Studio gaat voor');
  assert.deepEqual(p2.objecten, ['Oor links', 'Oor rechts']);
  assert.equal(p2.tijd_min, 60);
});

test('S2. enkel geslicete platen; niet geslicet of geen 3mf → duidelijke fout', async () => {
  const een = await lees(await bambu3mf({ platen: [{ nr: 3, sec: 600, gewicht: 5, objecten: ['X.stl'], filamenten: [{ slot: 1, type: 'PLA', kleur: '#1E88E5', g: 5 }] }] }));
  assert.deepEqual(een.data.platen.map(p => p.nummer), [3], '"Slice plate" → enkel die plaat');
  const leeg = await lees(await bambu3mf({ platen: [], zonderSlice: true }));
  assert.equal(leeg.status, 400); assert.match(leeg.data.error, /geen geslicete platen/);
  const geen = await lees(Buffer.from('geen zip'), 'x.3mf');
  assert.equal(geen.status, 400); assert.match(geen.data.error, /geen 3mf-bestand/);
  const niets = await fetch(`${basis}/slicer`, { method: 'POST', body: new FormData() });
  assert.equal(niets.status, 400);
});

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('S3. losse gcode van Bambu Studio: tijd, gram per gebruikt slot, kleuren, voorbeeld', async () => {
  const gcode = [
    '; HEADER_BLOCK_START', '; BambuStudio 01.09.00.70',
    '; model printing time: 1h 20m 5s; total estimated time: 1h 27m 40s',
    '; total layer number: 120', '; filament: 1,3',
    '; total filament length [mm] : 4031.26,120.5', '; total filament weight [g] : 12.02,0.36',
    '; HEADER_BLOCK_END', '', '; THUMBNAIL_BLOCK_START', '; thumbnail begin 50x50 20', '; iVBORw0KGgo', '; thumbnail end',
    '; thumbnail begin 300x300 40', `; ${PNG.slice(0, 40)}`, `; ${PNG.slice(40)}`, '; thumbnail end', '; THUMBNAIL_BLOCK_END',
    '; CONFIG_BLOCK_START',
    '; filament_colour = #1E88E5;#FFFFFF;#1A1A1A', '; filament_type = PLA;PLA;PETG',
    '; filament_vendor = "eSUN";"Bambu Lab";"Generic"',
    '; filament_settings_id = "eSUN PLA+ @BBL A1";"Bambu PLA Matte @BBL A1";"Generic PETG @BBL A1"',
    '; printer_model = Bambu Lab A1', '; CONFIG_BLOCK_END', 'G28', 'G1 X10 Y10',
  ].join('\n');
  const { status, data } = await lees(Buffer.from(gcode), 'Heksen_benen.gcode');
  assert.equal(status, 200, JSON.stringify(data));
  const [p] = data.platen;
  assert.equal(data.platen.length, 1);
  assert.equal(p.naam, 'Heksen benen');
  assert.equal(p.tijd_min, 88);
  assert.deepEqual(p.filamenten.map(f => [f.slot, f.type, f.kleur, f.gram]), [[1, 'PLA', '#1E88E5', 12.02], [3, 'PETG', '#1A1A1A', 0.36]]);
  assert.equal(p.gram, 12.38);
  assert.equal(p.afbeelding, `data:image/png;base64,${PNG}`, 'grootste voorbeeld');
  assert.ok(data.printer_id, 'printer herkend');
});

test('S4. losse gcode van OrcaSlicer/PrusaSlicer (instellingen achteraan); zonder slicergegevens → fout', async () => {
  const gcode = ['; generated by OrcaSlicer 2.1.1', 'G28', 'G1 X1',
    '; filament used [mm] = 3000.00, 500.00', '; filament used [g] = 9.50, 1.50',
    '; estimated printing time (normal mode) = 2h 5m 30s',
    '; filament_colour = #FDD835;#1A1A1A', '; filament_type = PLA;PLA', '; filament_vendor = eSUN;eSUN'].join('\n');
  const { status, data } = await lees(Buffer.from(gcode), 'kubus.gcode');
  assert.equal(status, 200, JSON.stringify(data));
  const [p] = data.platen;
  assert.equal(p.tijd_min, 126);
  assert.deepEqual(p.filamenten.map(f => [f.slot, f.gram, f.kleur]), [[1, 9.5, '#FDD835'], [2, 1.5, '#1A1A1A']]);
  const leeg = await lees(Buffer.from('G28\nG1 X1\n; niets\n'), 'leeg.gcode');
  assert.equal(leeg.status, 400); assert.match(leeg.data.error, /geen printtijd en filamentgewicht/);
});

test('S5. afbeelding per printregel: bewaard, gecontroleerd, op offerte en werkbon', async () => {
  const afb = `data:image/png;base64,${PNG}`;
  const maak = regels => fetch(`${basis}/dossiers`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titel: 'Met afbeelding', regels }) }).then(async r => ({ status: r.status, data: await r.json() }));
  const ok = await maak([{ type: 'printen', omschrijving: 'Bluey', printer_id: 2, tijd_min: 60, afbeelding: afb, materialen: [] }]);
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.regels[0].afbeelding, afb);
  // PDF's lezen het dossier rechtstreeks: daar staat de afbeelding in de documentinhoud
  const overname = leesDossier(getDb(), ok.data.id).overname;
  assert.equal(overname.regels[0].afbeelding, afb, 'in de documentinhoud (offerte/werkbon)');
  assert.equal(ok.data.overname.regels[0].afbeelding, undefined, 'niet dubbel naar de browser');
  const fout = await maak([{ type: 'printen', omschrijving: 'X', tijd_min: 1, afbeelding: 'javascript:alert(1)', materialen: [] }]);
  assert.equal(fout.status, 400); assert.match(fout.data.error, /ongeldige afbeelding/);
  const html = documentHtml({ soort: 'OFFERTE', nummer: 'OFF-1', datum: '2026-09-28', inhoud: overname });
  assert.ok(html.includes(`<img class="afb" src="${afb}"`));
});

test('S6. slicerbestand als bijlage van het dossier, gekoppeld aan de printregel (plaat); download; printopdracht kent het', async () => {
  const json = (m, pad, body) => fetch(`${basis}${pad}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    .then(async r => ({ status: r.status, data: await r.json() }));
  const bestand = await bambu3mf({ platen: [{ nr: 2, sec: 600, gewicht: 5, objecten: ['X.stl'], filamenten: [{ slot: 1, type: 'PLA', kleur: '#1E88E5', g: 5 }] }] });
  const d0 = (await json('POST', '/dossiers', { titel: 'Met bestand', regels: [{ type: 'printen', omschrijving: 'X', printer_id: 2, tijd_min: 10, materialen: [] }] })).data;
  const upload = async (dossierId, naam, inhoud = bestand) => {
    const fd = new FormData(); fd.append('bestand', new Blob([inhoud]), naam);
    const r = await fetch(`${basis}/bijlagen/dossier/${dossierId}`, { method: 'POST', body: fd });
    return { status: r.status, data: await r.json() };
  };
  const b = await upload(d0.id, 'figuurtjes.gcode.3mf');
  assert.equal(b.status, 201, JSON.stringify(b.data));
  const regels = d0.regels.map(r => ({ ...r, slicer_bijlage_id: b.data.id, slicer_plaat: 2 }));
  let d = (await json('PUT', `/dossiers/${d0.id}`, { titel: d0.titel, soort: d0.soort, regels })).data;
  assert.deepEqual([d.regels[0].slicer_bijlage_id, d.regels[0].slicer_plaat, d.regels[0].slicer_bestandsnaam], [b.data.id, 2, 'figuurtjes.gcode.3mf']);
  const dl = await fetch(`${basis}/bijlagen/bestand/${b.data.id}`);
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /^attachment;/);
  assert.equal(Buffer.from(await dl.arrayBuffer()).length, bestand.length);
  // printopdracht na starten kent bestand en plaat
  const x = (await json('POST', `/dossiers/${d0.id}/starten`)).data;
  const o = (await json('GET', `/productie/opdrachten/${x.productie.regels[0].opdrachten[0].id}`)).data;
  assert.deepEqual([o.slicer_bijlage_id, o.slicer_plaat, o.slicer_bestandsnaam], [b.data.id, 2, 'figuurtjes.gcode.3mf']);
  // bestand van een ANDER dossier → koppeling vervalt
  const ander = (await json('POST', '/dossiers', { titel: 'Ander' })).data;
  const b2 = await upload(ander.id, 'ander.gcode');
  d = (await json('PUT', `/dossiers/${d0.id}`, { titel: d0.titel, soort: d0.soort, regels: d.regels.map(r => ({ ...r, slicer_bijlage_id: b2.data.id })) })).data;
  assert.equal(d.regels[0].slicer_bijlage_id, null);
  // bijlage verwijderd → regel verliest de koppeling (ON DELETE SET NULL)
  await json('PUT', `/dossiers/${d0.id}`, { titel: d0.titel, soort: d0.soort, regels: d.regels.map(r => ({ ...r, slicer_bijlage_id: b.data.id, slicer_plaat: 2 })) });
  await fetch(`${basis}/bijlagen/bestand/${b.data.id}`, { method: 'DELETE' });
  d = (await json('GET', `/dossiers/${d0.id}`)).data;
  assert.equal(d.regels[0].slicer_bijlage_id, null);
  // andere bestandstypes: niet bij een dossier
  assert.equal((await upload(d0.id, 'notities.txt', Buffer.from('x'))).status, 400);
});

test('S7. Onderhoud: ruimte per soort bijlage; slicerbestanden van lang afgesloten dossiers opruimen', async () => {
  const json = (m, pad, body) => fetch(`${basis}${pad}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    .then(async r => ({ status: r.status, data: await r.json() }));
  const upload = async (dossierId, naam, inhoud) => {
    const fd = new FormData(); fd.append('bestand', new Blob([inhoud]), naam);
    return (await fetch(`${basis}/bijlagen/dossier/${dossierId}`, { method: 'POST', body: fd })).json();
  };
  const maak = async titel => (await json('POST', '/dossiers', { titel, regels: [{ type: 'printen', omschrijving: 'X', printer_id: 2, tijd_min: 10, materialen: [] }] })).data;
  const oud = await maak('Oud'), recent = await maak('Recent');
  const bOud = await upload(oud.id, 'oud.gcode', Buffer.from('; filament used [g] = 1\n'.repeat(100)));
  await upload(recent.id, 'recent.gcode', Buffer.from('; x\n'));
  await json('PUT', `/dossiers/${oud.id}`, { titel: 'Oud', soort: 'klant', regels: oud.regels.map(r => ({ ...r, slicer_bijlage_id: bOud.id, slicer_plaat: 1 })) });
  // oud: afgerekend acht maanden geleden; recent: vorige week
  getDb().prepare(`UPDATE dossiers SET afgerekend_soort = 'factuur', afgerekend_nummer = 'F-oud', afgerekend_bedrag = 1, afgerekend_op = date('now', '-8 months') WHERE id = ?`).run(oud.id);
  getDb().prepare(`UPDATE dossiers SET afgerekend_soort = 'factuur', afgerekend_nummer = 'F-new', afgerekend_bedrag = 1, afgerekend_op = date('now', '-7 days') WHERE id = ?`).run(recent.id);
  let o = (await json('GET', '/onderhoud')).data;
  assert.ok(o.versie, 'versie getoond');
  assert.ok(o.bijlagen.per.slicer.aantal >= 2);
  assert.equal(o.bijlagen.opruimbaar.aantal, 1); assert.equal(o.bijlagen.opruimbaar.maanden, 6);
  const r = (await json('POST', '/onderhoud/slicer-opruimen', { maanden: 6 })).data;
  assert.equal(r.aantal, 1); assert.ok(r.grootte > 0);
  o = (await json('GET', '/onderhoud')).data;
  assert.equal(o.bijlagen.opruimbaar.aantal, 0);
  const d = (await json('GET', `/dossiers/${oud.id}`)).data;
  assert.equal(d.regels[0].slicer_bijlage_id, null, 'regel verliest enkel de link');
  assert.equal((await json('GET', `/bijlagen/dossier/${recent.id}`)).data.length, 1, 'recent dossier blijft');
});
