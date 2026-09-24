// Stap 8: info, backups maken/lijst/download, opruimen, geen padtrucs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { initDb, sluitDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { maakBackup, lijstBackups, startAutoBackup, stopAutoBackup } from '../domein/onderhoud.js';

const map = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-backup-'));
let server, basis;
before(async () => {
  initDb(path.join(map, 'erp.db'));
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { stopAutoBackup(); server.close(); sluitDb(); fs.rmSync(map, { recursive: true, force: true }); });

test('O1. info en een backup met de hand; download is een geldige databank', async () => {
  let r = await (await fetch(`${basis}/onderhoud`)).json();
  assert.equal(r.versie, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
  assert.ok(r.db_versie >= 11);
  assert.equal(r.backup_map, path.join(map, 'backups'));
  const m = await fetch(`${basis}/onderhoud/backups`, { method: 'POST' });
  assert.equal(m.status, 201);
  const { naam } = await m.json();
  assert.match(naam, /^erp-\d{4}-\d{2}-\d{2}_\d{6}-manueel\.db$/);
  const d = await fetch(`${basis}/onderhoud/backups/${naam}`);
  assert.equal(d.status, 200);
  const bestand = path.join(map, 'download.db');
  fs.writeFileSync(bestand, Buffer.from(await d.arrayBuffer()));
  const kopie = new Database(bestand, { readonly: true });
  assert.ok(kopie.prepare('SELECT COUNT(*) n FROM printers').get().n >= 3);
  kopie.close();
  assert.equal((await fetch(`${basis}/onderhoud/backups/..%2Ferp.db`)).status, 404);
  assert.equal((await fetch(`${basis}/onderhoud/backups/erp-2020-01-01_000000-manueel.db`)).status, 404);
});

test('O2. automatische backup bij het opstarten; oude worden opgeruimd', async () => {
  startAutoBackup();
  await new Promise(r => setTimeout(r, 300));
  assert.equal(lijstBackups().filter(b => b.soort === 'automatisch').length, 1);
  // 16 oude automatische → enkel de laatste 14 blijven
  for (let i = 1; i <= 16; i++) fs.writeFileSync(path.join(map, 'backups', `erp-2020-01-${String(i).padStart(2, '0')}_000000-automatisch.db`), 'x');
  await maakBackup('automatisch');
  const auto = lijstBackups().filter(b => b.soort === 'automatisch');
  assert.equal(auto.length, 14);
  assert.ok(!auto.some(b => b.naam.startsWith('erp-2020-01-01')), 'de oudste zijn weg');
});
