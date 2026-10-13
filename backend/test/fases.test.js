// 13-10: "Klaar voor productie" (gestart, nog geen run) en "Afgerond" (eigen product / intern, alles geprint)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faseVan, stappenVan } from '../domein/status/dossier.js';

test('F-gepland: gestart zonder run → klaar voor productie; met run → in productie', () => {
  assert.equal(faseVan({ soort: 'klant', gestart_op: '2026-10-13' }, { prod: 'gepland' }), 'gepland');
  assert.equal(faseVan({ soort: 'klant', gestart_op: '2026-10-13' }, { prod: 'geen' }), 'gepland');
  assert.equal(faseVan({ soort: 'klant', gestart_op: '2026-10-13' }, { prod: 'productie' }), 'productie');
  assert.equal(faseVan({ soort: 'klant' }, { prod: null }), 'nieuw');
});
test('F-afgerond: eigen product / intern met alles geprint → afgerond; klant → klaar', () => {
  assert.equal(faseVan({ soort: 'eigen', gestart_op: 'x' }, { prod: 'klaar' }), 'afgerond');
  assert.equal(faseVan({ soort: 'intern', gestart_op: 'x' }, { prod: 'klaar' }), 'afgerond');
  assert.equal(faseVan({ soort: 'klant', gestart_op: 'x' }, { prod: 'klaar' }), 'klaar');
  assert.deepEqual(stappenVan({ soort: 'eigen' }, { prod: 'klaar' }), ['nieuw', 'gepland', 'productie', 'afgerond']);
});
