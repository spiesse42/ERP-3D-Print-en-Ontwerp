// 29-09: factuur gemaakt door het ERP (reeks FAC, "Factuur 2026-004"), altijd
// gemaild naar inkomsten@accountable.eu, optioneel naar de klant; niet meteen
// betaald, met een vervaldatum. Plus: klant opzoeken op btw-nummer (VIES +
// Peppol), met nagebootste netwerk-antwoorden.
process.env.MAIL_NEP = '1';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && (await import('fs')).existsSync('/opt/pw-browsers/chromium')) process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { nepPostvak } from '../documenten/mail.js';
import { sluitBrowser, vindBrowser } from '../documenten/pdf.js';
import { epcTekst, factuurHtml, peppolVerplicht } from '../documenten/factuur.js';
import { leesBtw, kandidaten, smlNamen, splitsAdres, zoekKlant } from '../domein/peppol.js';
import { stopWachter } from '../productie/wachter.js';

let server, basis;
before(async () => {
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); stopWachter(); sluitDb(); await sluitBrowser(); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  if (type.includes('pdf')) return { status: res.status, pdf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
const fout = (r, patroon) => { assert.equal(r.status, 400, JSON.stringify(r.data)); assert.match(r.data.error, patroon); };
const jaar = new Date().getFullYear();
const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
const plus = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ACC = 'inkomsten@accountable.eu';
const pdfOk = !!vindBrowser();
let nl, be, zonder, d1, d2;
const dossier = async (titel, klant_id) => ok(await vraag('POST', '/dossiers', { titel, klant_id, regels: [{ type: 'ontwerp', omschrijving: '3D-ontwerp: Emmer DPA', minuten: 72, tarief: 25 }] }), 201);

test('FA0. voorbereiding: bedrijf, klanten (NL, BE met btw), nummering verder vanaf 2026-003 uit Accountable', async () => {
  ok(await vraag('PUT', '/instellingen', { bedrijf_naam: 'Spiesschaert, David', bedrijf_adres: 'Constant Vanden Berghestraat 14, 8700 Aarsele', bedrijf_btw: 'BE0543857422',
    bedrijf_iban: 'BE59 0020 3763 3126', bedrijf_bic: 'GEBABEBB', bedrijf_rekeninghouder: 'David Spiesschaert', bedrijf_email: 'info@3dprintenontwerp.be', factuur_betaaltermijn: '7' }));
  fout(await vraag('PUT', '/instellingen', { factuur_betaaltermijn: 'een week' }), /Betaaltermijn/);
  nl = ok(await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'The ClipCompany', voornaam: 'Danny', naam: 'van Schaik', straat: 'Amsteldiep', huisnummer: '9', postcode: '3891 CH', gemeente: 'Zeewolde', land: 'nl', email: 'danny@voorbeeld.nl' }), 201).id;
  assert.equal(ok(await vraag('GET', `/klanten/${nl}`)).land, 'NL');
  be = ok(await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'Bouw BV', straat: 'Markt', huisnummer: '1', postcode: '9000', gemeente: 'Gent', btw_nummer: 'be 0123.456.789' }), 201).id;
  assert.equal(ok(await vraag('GET', `/klanten/${be}`)).btw_nummer, 'BE0123456789', 'btw-nummer zonder puntjes en spaties');
  fout(await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'X', land: 'Nederland' }), /landcode/);
  zonder = await dossier('Zonder klant', null);
  d1 = await dossier('Emmer DPA', nl);
  d2 = await dossier('Werfbord', be);
  // een factuur die vroeger met de hand uit Accountable kwam telt mee: volgende = 004
  getDb().prepare(`INSERT INTO dossiers (nummer, soort, klant_id, titel, afgerekend_soort, afgerekend_nummer, afgerekend_op, afgerekend_bedrag)
    VALUES ('D-OUD', 'klant', ?, 'Oud', 'factuur', '${jaar}-003', '${jaar}-01-10', 30)`).run(nl);
  const fac = ok(await vraag('GET', '/nummering')).find(x => x.reeks === 'FAC');
  assert.equal(fac.minimum, 4);
  ok(await vraag('PUT', '/nummering/FAC', { volgend: 4 }));
  fout(await vraag('PUT', '/nummering/FAC', { volgend: 3 }), /niet lager dan 4/);
});

test('FA1. voorstel: nummer, vervaldatum volgens de betaaltermijn, Peppol enkel voor een Belgische btw-plichtige klant', async () => {
  fout(await vraag('GET', `/dossiers/${zonder.id}/factuur/voorstel`), /altijd op naam/);
  const v = ok(await vraag('GET', `/dossiers/${d1.id}/factuur/voorstel?datum=${vandaag}`));
  assert.equal(v.nummer, `Factuur ${jaar}-004`);
  assert.equal(v.vervaldatum, plus(vandaag, 7));
  assert.equal(v.peppol_verplicht, false, 'Nederlandse klant: geen Peppol-plicht');
  assert.deepEqual(v.ontbreekt, []);
  assert.equal(ok(await vraag('GET', `/dossiers/${d2.id}/factuur/voorstel`)).peppol_verplicht, true);
  assert.equal(ok(await vraag('GET', `/dossiers/${d1.id}`)).werkbon, null, 'voorstel bewaart niets');
});

test('FA2. maken: afgerekend (niet betaald), vervaldatum, naar Accountable; PDF met de verplichte gegevens', { skip: !pdfOk && 'geen Chromium' }, async () => {
  fout(await vraag('POST', `/dossiers/${d1.id}/factuur`, { datum: vandaag, vervaldatum: plus(vandaag, -1) }), /vervaldatum kan niet vóór/);
  fout(await vraag('POST', `/dossiers/${d1.id}/factuur`, { datum: plus(vandaag, 1) }), /niet in de toekomst/);
  const postvak = nepPostvak().length;
  const d = ok(await vraag('POST', `/dossiers/${d1.id}/factuur`, { datum: vandaag, naar_klant: true, aan: 'danny@voorbeeld.nl' }), 201);
  assert.equal(d.mail_fout, null);
  assert.equal(d.fase, 'afgerekend');
  assert.equal(d.afgerekend_soort, 'factuur');
  assert.equal(d.afgerekend_nummer, `Factuur ${jaar}-004`);
  assert.equal(d.betaald_op, null);
  assert.equal(d.afrekening_vervaldatum, plus(vandaag, 7));
  assert.ok(d.afrekening_gemaild_op);
  assert.equal(d.volgende_stap.soort, 'betaling');
  assert.match(d.volgende_stap.tekst, /Factuur \d{4}-004 gemaakt en naar Accountable gemaild; vervalt op/);
  const m = nepPostvak().slice(postvak);
  assert.equal(m.length, 1);
  assert.equal(m[0].to, 'danny@voorbeeld.nl'); assert.equal(m[0].cc, ACC);
  assert.equal(m[0].attachments[0].filename, `Factuur ${jaar}-004.pdf`);
  // opvolging: onbetaald met vervaldatum
  const o = ok(await vraag('GET', '/financien/opvolging')).onbetaald.find(x => x.id === d1.id);
  assert.equal(o.vervaldatum, plus(vandaag, 7)); assert.equal(o.vervallen, false);
  // PDF opnieuw op te vragen; nog eens naar Accountable kan niet
  const pdf = await vraag('GET', `/dossiers/${d1.id}/factuur/pdf`);
  assert.equal(pdf.pdf.subarray(0, 5).toString(), '%PDF-');
  fout(await vraag('POST', `/dossiers/${d1.id}/factuur/mail`, { naar_accountable: true }), /al naar Accountable gemaild/);
  fout(await vraag('GET', `/dossiers/${d1.id}/bonnetje/pdf`), /geen bonnetje/);
  // betaald → afgerond
  const b = ok(await vraag('POST', `/dossiers/${d1.id}/betaald`, { datum: vandaag }));
  assert.equal(b.volgende_stap.soort, 'afgerond');
  // Belgische btw-plichtige klant: tip om via Peppol te versturen
  const e = ok(await vraag('POST', `/dossiers/${d2.id}/factuur`, { datum: vandaag }), 201);
  assert.equal(e.afgerekend_nummer, `Factuur ${jaar}-005`);
  assert.ok(e.volgende_stap.extra.some(t => /via Peppol/.test(t)));
});

test('FA3. factuurdocument: FACTUUR-nummer, Van/Aan met land, vervaldatum, rekening, mededeling, EPC-QR, vrijstelling', async () => {
  const inhoud = { bedrijf: { naam: 'Spiesschaert, David', adres: 'Constant Vanden Berghestraat 14, 8700 Aarsele', btw: 'BE0543857422', iban: 'BE59 0020 3763 3126', bic: 'GEBABEBB', rekeninghouder: 'David Spiesschaert', email: 'info@3dprintenontwerp.be', telefoon: '+32468436389' },
    klant: { type: 'zakelijk', bedrijfsnaam: 'The ClipCompany', voornaam: 'Danny', naam: 'van Schaik', straat: 'Amsteldiep', huisnummer: '9', postcode: '3891 CH', gemeente: 'Zeewolde', land: 'NL' },
    dossier: { nummer: 'D-2026-010', titel: 'Emmer' }, regels: [{ omschrijving: '3D-ontwerp: Emmer DPA', aantal: 1, per_stuk: 30, bedrag: 30 }], totaal: 30, vast: 0 };
  const html = await factuurHtml({ inhoud, nummer: 'Factuur 2026-003', datum: '2026-09-28', vervaldatum: '2026-10-05' });
  for (const t of ['FACTUUR 2026-003', 'Factuurdatum: 28-09-2026', 'Datum uitvoering: 28-09-2026', 'Vervaldatum: 05-10-2026', 'Nederland', 'Rekeninghouder: David Spiesschaert',
    'BE59 0020 3763 3126', 'BIC: GEBABEBB', 'Mededeling: <strong>2026-003', 'Bijzondere vrijstellingsregeling kleine ondernemingen - btw niet van toepassing', 'Prijs (excl. btw)', 'TE BETALEN', '<svg', '+32468436389']) {
    assert.ok(html.includes(t), `ontbreekt: ${t}`);
  }
  assert.equal(epcTekst({ naam: 'David Spiesschaert', iban: 'BE59 0020 3763 3126', bic: 'GEBABEBB', bedrag: 30, mededeling: '2026-003' }),
    'BCD\n002\n1\nSCT\nGEBABEBB\nDavid Spiesschaert\nBE59002037633126\nEUR30.00\n\n\n2026-003');
  assert.equal(epcTekst({ naam: 'X', iban: '', bedrag: 30 }), null, 'zonder IBAN geen QR');
  assert.equal(peppolVerplicht({ type: 'zakelijk', btw_nummer: 'BE0123456789' }), true);
  assert.equal(peppolVerplicht({ type: 'zakelijk', btw_nummer: 'NL123456789B01', land: 'NL' }), false);
  assert.equal(peppolVerplicht({ type: 'particulier' }), false);
});

test('FA4. btw-nummer lezen, Peppol-ID\'s en SML-namen (voorbeeld uit de Peppol-specificatie)', () => {
  assert.deepEqual(leesBtw('be 0543.857.422'), { land: 'BE', nummer: '0543857422', btw: 'BE0543857422' });
  assert.deepEqual(leesBtw('543857422'), { land: 'BE', nummer: '0543857422', btw: 'BE0543857422' });
  assert.equal(leesBtw('NL123456789B01').land, 'NL');
  assert.throws(() => leesBtw('BE123'), /10 cijfers/);
  assert.deepEqual(kandidaten(leesBtw('BE0543857422')), ['0208:0543857422', '9925:BE0543857422']);
  assert.deepEqual(kandidaten(leesBtw('NL123456789B01')), ['9944:NL123456789B01']);
  assert.deepEqual(kandidaten(leesBtw('DE123456789')), ['9930:DE123456789']);
  const n = smlNamen('0088:123abc');
  assert.equal(n.naptr, 'Y7DZFXAF3D4CJZ4KCGRXTEC6TWVCGA4KY7ZWA5BOIF6MSWD4TDRQ.iso6523-actorid-upis.edelivery.tech.ec.europa.eu');
  assert.equal(n.cname, 'B-f5e78500450d37de5aabe6648ac3bb70.iso6523-actorid-upis.edelivery.tech.ec.europa.eu');
  assert.deepEqual(splitsAdres('Constant Vanden Berghestraat 14\n8700 AARSELE'), { postcode: '8700', gemeente: 'Aarsele', straat: 'Constant Vanden Berghestraat', huisnummer: '14' });
});

test('FA5. opzoeken: VIES naam/adres, Peppol-ID bevestigd in het register, voorstellen uit de Directory; netwerkfout = melding', async () => {
  const geregistreerd = new Set([smlNamen('0208:0543857422').naptr]);
  const dns = {
    resolveNaptr: async h => { if (geregistreerd.has(h)) return [{ service: 'Meta:SMP' }]; throw Object.assign(new Error('nee'), { code: 'ENOTFOUND' }); },
    resolveCname: async () => { throw Object.assign(new Error('nee'), { code: 'ENODATA' }); },
  };
  const antwoord = data => ({ ok: true, json: async () => data });
  const fetchFn = async url => {
    if (url.includes('vies')) return antwoord({ isValid: true, name: 'SPIESSCHAERT, DAVID', address: 'Constant Vanden Berghestraat 14\n8700 Aarsele' });
    if (url.includes('directory')) return antwoord({ matches: [] });
    throw new Error('onverwacht');
  };
  const r = await zoekKlant('BE0543857422', { fetchFn, dns });
  assert.equal(r.vies.geldig, true); assert.equal(r.vies.naam, 'SPIESSCHAERT, DAVID'); assert.equal(r.vies.postcode, '8700');
  assert.deepEqual(r.peppol, { id: '0208:0543857422', bevestigd: true });
  assert.deepEqual(r.fouten, []);
  // Nederland: VIES geeft geen naam ("---"), niet in het register met het btw-nummer, wel in de Directory op KvK
  const nlFetch = async url => (url.includes('vies') ? antwoord({ isValid: true, name: '---', address: '---' })
    : antwoord({ matches: [{ participantID: { scheme: 'iso6523-actorid-upis', value: '0106:12345678' }, entities: [{ name: [{ name: 'The ClipCompany' }], countryCode: 'NL' }] }] }));
  const n = await zoekKlant('NL123456789B01', { fetchFn: nlFetch, dns });
  assert.equal(n.vies.geldig, true); assert.equal(n.vies.naam, null);
  assert.equal(n.peppol, null);
  assert.deepEqual(n.suggesties, [{ id: '0106:12345678', naam: 'The ClipCompany', land: 'NL' }]);
  // geen internet: geen crash, wel een melding per bron
  const x = await zoekKlant('BE0543857422', { fetchFn: async () => { throw new Error('geen verbinding'); }, dns: { resolveNaptr: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); }, resolveCname: async () => [] } });
  assert.equal(x.fouten.length, 3);
  // via de API: ongeldige invoer
  fout(await vraag('GET', '/klanten/opzoeken?btw='), /btw-nummer/);
});
