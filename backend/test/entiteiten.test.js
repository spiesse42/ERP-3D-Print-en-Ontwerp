// 26-10: integratie opnieuw toegevoegd (nieuw IP-adres) → entiteiten "_2";
// de oude blijven "niet beschikbaar". Het ERP neemt de werkende versie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { werkendeEntiteit, leesPrinter } from '../productie/adapters.js';

const staten = lijst => new Map(Object.entries(lijst).map(([id, state]) => [id, { entity_id: id, state, attributes: {} }]));

test('E1. werkende entiteit: ingesteld en beschikbaar gaat voor; anders het hoogste werkende volgnummer', () => {
  const s = staten({ 'sensor.a': 'printing', 'sensor.a_2': 'standby', 'sensor.b': 'unavailable', 'sensor.b_2': 'printing', 'sensor.b_3': 'unavailable', 'sensor.b_10': 'complete', 'sensor.bx_4': 'x' });
  assert.equal(werkendeEntiteit('sensor.a', s), 'sensor.a');
  assert.equal(werkendeEntiteit('sensor.b', s), 'sensor.b_10');
  assert.equal(werkendeEntiteit('sensor.c', s), 'sensor.c', 'niets gevonden = zoals ingesteld');
  assert.equal(werkendeEntiteit('sensor.b', staten({ 'sensor.b': 'unavailable', 'sensor.b_2': 'unavailable' })), 'sensor.b');
});

test('E2. Snapmaker U1 na opnieuw toevoegen: status uit de "_2"-entiteiten', () => {
  const p = { koppeling: 'moonraker_ha', ha_prefix: 'lava_' };
  const s = staten({ 'sensor.lava_current_print_state': 'unavailable', 'sensor.lava_filename': 'unavailable',
    'sensor.lava_current_print_state_2': 'printing', 'sensor.lava_filename_2': 'draak.gcode', 'sensor.lava_progress_2': '42' });
  const l = leesPrinter(p, s);
  assert.equal(l.status, 'bezig'); assert.equal(l.bestand, 'draak.gcode'); assert.equal(l.voortgang, 42);
});
