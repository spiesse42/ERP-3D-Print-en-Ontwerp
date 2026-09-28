// Slicerbestand inlezen (28-09): geslicet 3mf uit Bambu Studio → platen met
// tijd, grammen en kleuren; voorstel voor printer, prijsgroep en kleur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
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
