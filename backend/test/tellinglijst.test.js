// 23-11: tellingslijst als Excel en terug inlezen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { initDb, sluitDb } from '../db/index.js';
import { maakApp } from '../app.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); sluitDb(); });
const json = async (m, p, b) => { const r = await fetch(basis + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json() }; };

test('T1. export: ID, Systeem, lege kolom Geteld, waarde; inlezen geeft de ingevulde rijen', async () => {
  const ring = (await json('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelring', wordt_gekocht: true })).data.id;
  const zak = (await json('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Zakje', wordt_gekocht: true })).data.id;
  await json('POST', `/voorraad/artikelen/${ring}/boeking`, { richting: 'in', aantal: 100, prijs_per_eenheid: 0.08 });
  const res = await fetch(`${basis}/voorraad/telling.xlsx`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /voorraadtelling-\d{4}-\d{2}-\d{2}\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.worksheets[0];
  assert.deepEqual(ws.getRow(3).values.slice(1), ['ID', 'Artikel', 'Soort', 'Categorie', 'Locatie', 'Eenheid', 'Systeem', 'Geteld', 'Verschil', 'Waarde (€)']);
  const rijen = [];
  ws.eachRow((row, n) => { if (n > 3 && Number.isInteger(row.getCell(1).value)) rijen.push(n); });
  const rijVan = id => rijen.find(n => ws.getRow(n).getCell(1).value === id);
  assert.equal(ws.getRow(rijVan(ring)).getCell(7).value, 100);
  assert.equal(ws.getRow(rijVan(ring)).getCell(10).value, 8);
  assert.equal(ws.getRow(rijVan(ring)).getCell(8).value, null);
  // invullen: ring 95, zakje leeg, één foute
  ws.getRow(rijVan(ring)).getCell(8).value = 95;
  ws.getRow(rijVan(zak)).getCell(8).value = 'veel';
  const fd = new FormData();
  fd.append('bestand', new Blob([await wb.xlsx.writeBuffer()]), 'telling.xlsx');
  const r = await (await fetch(`${basis}/voorraad/telling/inlezen`, { method: 'POST', body: fd })).json();
  assert.deepEqual(r.regels, [{ artikel_id: ring, geteld: 95 }]);
  assert.equal(r.fouten.length, 1);
  assert.match(r.fouten[0], /geen geldig aantal/);
  // geen excel
  const fd2 = new FormData();
  fd2.append('bestand', new Blob(['hallo']), 'x.xlsx');
  assert.match((await (await fetch(`${basis}/voorraad/telling/inlezen`, { method: 'POST', body: fd2 })).json()).error, /geen geldig Excel/);
});
