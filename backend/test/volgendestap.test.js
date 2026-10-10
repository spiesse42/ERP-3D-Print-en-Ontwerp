import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volgendeStap } from '../domein/dossiers.js';

const basis = { soort: 'klant', fase: 'klaar', regels: [{ id: 1, type: 'printen' }], offertes: [], acties: {},
  productie: { status: 'klaar', regels: [] }, werkbon: { volledig: true } };

test('V1. alles geprint, niets geleverd → eerst leveren of ophalen', () => {
  const s = volgendeStap({ ...basis, lever_status: 'geen', leverbaar: [{ regel_id: 1, omschrijving: 'Pony', besteld: 1, geleverd: 0, rest: 1 }] });
  assert.equal(s.soort, 'leveren_of_ophalen');
});
test('V2. alles geleverd → afrekenen', () => {
  const s = volgendeStap({ ...basis, lever_status: 'geleverd', leverbaar: [{ regel_id: 1, omschrijving: 'Pony', besteld: 1, geleverd: 1, rest: 0 }] });
  assert.equal(s.soort, 'afrekenen');
});
