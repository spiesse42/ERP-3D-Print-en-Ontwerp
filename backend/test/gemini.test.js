// Tests voor de Gemini-oproep zelf (stap 3c, 24-09): herhalen bij tijdelijke
// fouten en begrijpelijke meldingen. Geen echte oproep: fetch is nagebootst.
process.env.NODE_ENV = 'test';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { roepGeminiAan, vertaalFout, reserveModellen, STANDAARD_RESERVE } from '../integraties/gemini.js';

const ARGS = { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', instructie: 'lees' };
const antwoord = obj => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const fout = (status, tekst = '') => ({ ok: false, status, text: async () => tekst });
// fetch die een reeks antwoorden teruggeeft; houdt bij hoe vaak hij opgeroepen werd
function nepFetch(...antwoorden) {
  const f = async (url, opties) => { f.oproepen.push({ url, opties }); const a = antwoorden[Math.min(f.oproepen.length - 1, antwoorden.length - 1)]; if (a instanceof Error) throw a; return a; };
  f.oproepen = [];
  return f;
}
let gewacht;
const wacht = async ms => { gewacht.push(ms); };
beforeEach(() => { gewacht = []; process.env.GEMINI_API_KEY = 'test-sleutel'; });

test('503 twee keer, dan gelukt: opnieuw geprobeerd na 2 en 5 s', async () => {
  const f = nepFetch(fout(503, 'overloaded'), fout(503), antwoord({ regels: [] }));
  const uit = await roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: [] });
  assert.deepEqual(uit.data, { regels: [] });
  assert.equal(f.oproepen.length, 3);
  assert.deepEqual(gewacht, [2000, 5000]);
  // sleutel in de header, niet in de URL
  assert.equal(f.oproepen[0].opties.headers['x-goog-api-key'], 'test-sleutel');
  assert.ok(!f.oproepen[0].url.includes('test-sleutel'));
});

test('blijvend overbelast: 4 pogingen, dan een begrijpelijke melding zonder technische tekst', async () => {
  const f = nepFetch(fout(503, '{"error":{"code":503,"status":"UNAVAILABLE"}}'));
  await assert.rejects(roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: [] }), e => {
    assert.match(e.message, /Gemini is even overbelast/);
    assert.match(e.message, /4 pogingen met het model/);
    assert.ok(!e.message.includes('UNAVAILABLE'));
    return true;
  });
  assert.equal(f.oproepen.length, 4);
  assert.deepEqual(gewacht, [2000, 5000, 10000]);
});

test('429 en geen verbinding worden ook herhaald', async () => {
  let f = nepFetch(fout(429), antwoord({ regels: [1] }));
  assert.deepEqual((await roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: [] })).data, { regels: [1] });
  f = nepFetch(new TypeError('fetch failed'), antwoord({ regels: [2] }));
  assert.deepEqual((await roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: [] })).data, { regels: [2] });
});

test('blijvende fouten: meteen melden, niet herhalen', async () => {
  for (const [status, tekst, patroon] of [
    [400, '{"error":{"message":"API key not valid","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}', /sleutel is ongeldig/],
    [403, 'PERMISSION_DENIED', /weigert de toegang/],
    [404, 'model not found', /bestaat niet \(meer\)/],
    [400, 'bad pdf', /kon dit bestand niet verwerken/],
  ]) {
    const f = nepFetch(fout(status, tekst));
    await assert.rejects(roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: [] }), patroon);
    assert.equal(f.oproepen.length, 1, `status ${status} niet herhaald`);
  }
  assert.deepEqual(gewacht, []);
});

test('geen sleutel of onleesbaar antwoord: duidelijke melding', async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(roepGeminiAan(ARGS, { fetchFn: nepFetch(antwoord({})), wacht, reserves: [] }), /niet ingesteld/);
  process.env.GEMINI_API_KEY = 'x';
  const kapot = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'geen json' }] } }] }) };
  await assert.rejects(roepGeminiAan(ARGS, { fetchFn: nepFetch(kapot), wacht, reserves: [] }), /kon niet gelezen worden/);
  assert.equal(vertaalFout(502).tijdelijk, true);
  assert.equal(vertaalFout(404).tijdelijk, false);
});

// ── Reservemodellen (optie 3) ──
const modelVan = url => decodeURIComponent(url.match(/models\/([^:]+):/)[1]);

test('hoofdmodel blijvend overbelast → reservemodel leest de factuur', async () => {
  delete process.env.GEMINI_MODEL;
  const f = async (url, opties) => { f.oproepen.push(modelVan(url)); return modelVan(url) === 'reserve-a' ? antwoord({ regels: ['ok'] }) : fout(503); };
  f.oproepen = [];
  const uit = await roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: ['reserve-a', 'reserve-b'] });
  assert.deepEqual([uit.model, uit.data], ['reserve-a', { regels: ['ok'] }]);
  assert.deepEqual(f.oproepen, ['gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.6-flash', 'reserve-a']);
  assert.deepEqual(gewacht, [2000, 5000, 10000]);
});

test('alles overbelast: elk reservemodel 2 pogingen, onbekend reservemodel overgeslagen, één duidelijke melding', async () => {
  const f = async url => { f.oproepen.push(modelVan(url)); return modelVan(url) === 'bestaat-niet' ? fout(404) : fout(503); };
  f.oproepen = [];
  await assert.rejects(roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: ['bestaat-niet', 'reserve-b'] }), e => {
    assert.match(e.message, /Gemini is even overbelast/);
    assert.match(e.message, /7 pogingen met 3 modellen/);
    return true;
  });
  assert.deepEqual(f.oproepen, ['gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.6-flash', 'gemini-3.6-flash', 'bestaat-niet', 'reserve-b', 'reserve-b']);
});

test('ongeldige sleutel: geen reservemodellen proberen', async () => {
  const f = nepFetch(fout(400, 'API_KEY_INVALID'));
  await assert.rejects(roepGeminiAan(ARGS, { fetchFn: f, wacht, reserves: ['reserve-a'] }), /sleutel is ongeldig/);
  assert.equal(f.oproepen.length, 1);
});

test('GEMINI_MODEL_RESERVE: eigen lijst, "geen", standaard; hoofdmodel nooit dubbel', () => {
  const oud = { m: process.env.GEMINI_MODEL, r: process.env.GEMINI_MODEL_RESERVE };
  delete process.env.GEMINI_MODEL; delete process.env.GEMINI_MODEL_RESERVE;
  assert.deepEqual(reserveModellen(), STANDAARD_RESERVE);
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  assert.deepEqual(reserveModellen(), ['gemini-3.5-flash-lite']);
  process.env.GEMINI_MODEL_RESERVE = ' x , y,x ';
  assert.deepEqual(reserveModellen(), ['x', 'y']);
  process.env.GEMINI_MODEL_RESERVE = 'Geen';
  assert.deepEqual(reserveModellen(), []);
  if (oud.m === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = oud.m;
  if (oud.r === undefined) delete process.env.GEMINI_MODEL_RESERVE; else process.env.GEMINI_MODEL_RESERVE = oud.r;
});
