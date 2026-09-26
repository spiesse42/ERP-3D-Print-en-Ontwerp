// 26-09: bonnetje gemaakt door het ERP (reeks BON, "Bonnetje 2026-021"),
// altijd gemaild naar inkomsten@accountable.eu, optioneel naar de klant
// (Accountable dan in cc). Accountable krijgt elk bonnetje exact één keer.
process.env.MAIL_NEP = '1';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && (await import('fs')).existsSync('/opt/pw-browsers/chromium')) process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { nepPostvak } from '../documenten/mail.js';
import { sluitBrowser } from '../documenten/pdf.js';
import { documentHtml, VRIJSTELLING } from '../documenten/sjabloon.js';
import { vergelijk } from '../domein/accountable.js';
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
const nu = new Date();
const vandaag = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`;
const ACC = 'inkomsten@accountable.eu';
const volgendBon = async () => ok(await vraag('GET', '/nummering')).find(x => x.reeks === 'BON').voorbeeld;
const nieuwDossier = async (titel, extra = {}) => ok(await vraag('POST', '/dossiers', { titel, klant_id: klant, regels: [{ type: 'extra', omschrijving: 'Lithofaankubus', bedrag: 28, per_stuk: true, aantal: 2 }], ...extra }), 201);
let klant, zakelijk, d1, d2, d3;

test('B0. voorbereiding: klant, dossiers, volgende bonnetjesnummer 21', async () => {
  klant = ok(await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Elien', naam: 'Moerman', email: 'elien@voorbeeld.be' }), 201).id;
  zakelijk = ok(await vraag('POST', '/klanten', { type: 'zakelijk', bedrijfsnaam: 'Firma', naam: 'Firma' }), 201).id;
  d1 = await nieuwDossier('Lithofaan');
  d2 = await nieuwDossier('Geboortebord');
  d3 = await nieuwDossier('Mail mislukt');
  ok(await vraag('PUT', '/nummering/BON', { volgend: 21 }));
  assert.equal(await volgendBon(), `Bonnetje ${jaar}-021`);
});

test('B1. voorstel: toont nummer en bedrag, maar bewaart NIETS (geen werkbon, geen nummer)', async () => {
  const wbVoor = ok(await vraag('GET', '/nummering')).find(x => x.reeks === 'WB').volgend;
  const v = ok(await vraag('GET', `/dossiers/${d1.id}/bonnetje/voorstel`));
  assert.equal(v.nummer, `Bonnetje ${jaar}-021`);
  assert.equal(v.bedrag, d1.zonder_werkbon.bedrag, 'bedrag = wat de werkbon wordt');
  assert.ok(v.bedrag > 0);
  assert.equal(v.accountable, ACC);
  assert.equal(v.klant_email, 'elien@voorbeeld.be');
  assert.equal(v.mail_ingesteld, true);
  assert.equal(v.drempel, 250);
  const d = ok(await vraag('GET', `/dossiers/${d1.id}`));
  assert.equal(d.werkbon, null, 'de werkbon van het voorstel is teruggedraaid');
  assert.equal(ok(await vraag('GET', '/nummering')).find(x => x.reeks === 'WB').volgend, wbVoor, 'geen werkbonnummer verbruikt');
  assert.equal(await volgendBon(), `Bonnetje ${jaar}-021`, 'geen bonnetjesnummer verbruikt');
  assert.ok(!ok(await vraag('GET', `/historiek/dossier/${d1.id}`)).some(h => /Werkbon/.test(h.tekst)), 'niets in de historiek');
  const pdf = await vraag('GET', `/dossiers/${d1.id}/bonnetje/voorbeeld`);
  assert.equal(pdf.status, 200); assert.equal(pdf.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.headers.get('content-disposition'), /Bonnetje \d{4}-021 - voorbeeld\.pdf/);
});

test('B2. maken zonder de klant: afgerekend + betaald, enkel naar Accountable, volgend nummer 22', async () => {
  const postvak = nepPostvak().length;
  const d = ok(await vraag('POST', `/dossiers/${d1.id}/bonnetje`, { datum: vandaag, naar_klant: false }), 201);
  assert.equal(d.mail_fout, null);
  assert.equal(d.afgerekend_soort, 'bonnetje');
  assert.equal(d.afgerekend_nummer, `Bonnetje ${jaar}-021`);
  assert.equal(d.afgerekend_bedrag, d1.zonder_werkbon.bedrag);
  assert.equal(d.afgerekend_bedrag, d.werkbon.document.totaal, 'regels op het bonnetje = totaal');
  assert.equal(d.afgerekend_op, vandaag); assert.equal(d.betaald_op, vandaag);
  assert.equal(d.fase, 'betaald');
  assert.ok(d.afrekening_pdf_op && d.afrekening_gemaild_op);
  assert.equal(d.afrekening_klant_mail, null);
  assert.ok(d.werkbon.definitief_op, 'werkbon definitief');
  assert.equal(nepPostvak().length, postvak + 1, 'precies één mail');
  const m = nepPostvak().at(-1);
  assert.equal(m.to, ACC); assert.equal(m.cc, undefined);
  assert.equal(m.subject, `Bonnetje ${jaar}-021`);
  assert.equal(m.attachments[0].filename, `Bonnetje ${jaar}-021.pdf`);
  assert.ok(m.bijlage_bytes > 1000);
  assert.equal(d.volgende_stap.soort, 'afgerond');
  assert.match(d.volgende_stap.tekst, /Bonnetje \d{4}-021 gemaakt en naar Accountable gemaild/);
  assert.equal(await volgendBon(), `Bonnetje ${jaar}-022`);
  const pdf = await vraag('GET', `/dossiers/${d1.id}/bonnetje/pdf`);
  assert.equal(pdf.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.headers.get('content-disposition'), /Bonnetje \d{4}-021\.pdf/);
  const h = ok(await vraag('GET', `/historiek/dossier/${d1.id}`));
  assert.ok(h.some(x => /Bonnetje \d{4}-021 gemaakt door het ERP/.test(x.tekst)));
  assert.ok(h.some(x => /gemaild naar Accountable \(inkomsten@accountable\.eu\)/.test(x.tekst)));
  // tweede keer maken kan niet
  fout(await vraag('POST', `/dossiers/${d1.id}/bonnetje`, {}), /al afgerekend/);
});

test('B3. maken mét de klant: aan de klant, Accountable in cc', async () => {
  const d = ok(await vraag('POST', `/dossiers/${d2.id}/bonnetje`, { naar_klant: true, aan: 'elien@voorbeeld.be', onderwerp: 'Je bonnetje', tekst: 'Dag Elien' }), 201);
  const m = nepPostvak().at(-1);
  assert.equal(m.to, 'elien@voorbeeld.be'); assert.equal(m.cc, ACC);
  assert.equal(m.subject, 'Je bonnetje'); assert.equal(m.text, 'Dag Elien');
  assert.equal(d.afgerekend_nummer, `Bonnetje ${jaar}-022`);
  assert.equal(d.afrekening_klant_mail, 'elien@voorbeeld.be');
  assert.ok(d.afrekening_gemaild_op);
  assert.match(d.volgende_stap.tekst, /ook naar elien@voorbeeld\.be/);
});

test('B4. controles vooraf: bij een fout wordt er GEEN nummer verbruikt', async () => {
  const voor = await volgendBon();
  fout(await vraag('POST', `/dossiers/${d3.id}/bonnetje`, { naar_klant: true, aan: 'geen-adres' }), /geldig e-mailadres/);
  const morgen = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  fout(await vraag('POST', `/dossiers/${d3.id}/bonnetje`, { datum: morgen }), /toekomst/);
  fout(await vraag('POST', `/dossiers/${d3.id}/bonnetje`, { datum: '31-12-2026' }), /geldige datum/);
  const eigen = ok(await vraag('POST', '/dossiers', { soort: 'eigen', titel: 'Eigen', regels: [{ type: 'extra', bedrag: 5 }] }), 201);
  fout(await vraag('POST', `/dossiers/${eigen.id}/bonnetje`, {}), /klantopdracht/);
  // printregel zonder printer → werkbon niet volledig te berekenen
  const onv = await nieuwDossier('Onvolledig', { regels: [{ type: 'printen', omschrijving: 'x', aantal: 1, tijd_min: 30 }] });
  fout(await vraag('GET', `/dossiers/${onv.id}/bonnetje/voorstel`), /berekend/);
  fout(await vraag('POST', `/dossiers/${onv.id}/bonnetje`, {}), /berekend/);
  assert.equal(ok(await vraag('GET', `/dossiers/${onv.id}`)).werkbon, null, 'ook de werkbon teruggedraaid');
  assert.equal(await volgendBon(), voor);
  fout(await vraag('GET', `/dossiers/${d3.id}/bonnetje/pdf`), /geen bonnetje/);
});

test('B5. mailen mislukt: bonnetje blijft, volgende stap = mailen; Accountable daarna exact één keer', async () => {
  const bewaard = { ...process.env };
  delete process.env.MAIL_NEP;
  Object.assign(process.env, { SMTP_USER: 'x@voorbeeld.be', SMTP_PASS: 'x', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1' });
  let d;
  try {
    d = ok(await vraag('POST', `/dossiers/${d3.id}/bonnetje`, {}), 201);
  } finally {
    for (const k of ['SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT']) { if (bewaard[k] === undefined) delete process.env[k]; else process.env[k] = bewaard[k]; }
    process.env.MAIL_NEP = '1';
  }
  assert.match(d.mail_fout, /verbinding/i);
  assert.equal(d.afgerekend_nummer, `Bonnetje ${jaar}-023`);
  assert.equal(d.afrekening_gemaild_op, null);
  assert.equal(d.volgende_stap.soort, 'bonnetje_mailen');
  assert.ok(ok(await vraag('GET', `/historiek/dossier/${d3.id}`)).some(h => /NOG NIET naar Accountable/.test(h.tekst)));
  // enkel naar de klant: Accountable blijft "nog te mailen"
  let x = ok(await vraag('POST', `/dossiers/${d3.id}/bonnetje/mail`, { naar_klant: true, aan: 'elien@voorbeeld.be' }));
  assert.equal(nepPostvak().at(-1).cc, undefined);
  assert.equal(x.volgende_stap.soort, 'bonnetje_mailen');
  fout(await vraag('POST', `/dossiers/${d3.id}/bonnetje/mail`, {}), /naar wie/);
  x = ok(await vraag('POST', `/dossiers/${d3.id}/bonnetje/mail`, { naar_accountable: true }));
  assert.equal(nepPostvak().at(-1).to, ACC);
  assert.ok(x.afrekening_gemaild_op);
  assert.equal(x.volgende_stap.soort, 'afgerond');
  fout(await vraag('POST', `/dossiers/${d3.id}/bonnetje/mail`, { naar_accountable: true }), /al naar Accountable gemaild/);
  fout(await vraag('POST', `/dossiers/${d3.id}/bonnetje/mail`, { naar_klant: true, aan: 'elien@voorbeeld.be', naar_accountable: true }), /al naar Accountable gemaild/);
});

test('B6. afrekening ongedaan wist ook de bonnetjesgegevens', async () => {
  const d = ok(await vraag('POST', `/dossiers/${d3.id}/afrekening-ongedaan`));
  assert.equal(d.afgerekend_nummer, null);
  assert.equal(d.afrekening_pdf_op, null); assert.equal(d.afrekening_gemaild_op, null); assert.equal(d.afrekening_klant_mail, null);
  assert.ok(ok(await vraag('GET', `/historiek/dossier/${d3.id}`)).some(h => /was Bonnetje \d{4}-023\)/.test(h.tekst)), 'tekst zonder "bonnetje Bonnetje"');
  // het nummer 023 is niet meer in gebruik: je mag de teller terugzetten
  ok(await vraag('PUT', '/nummering/BON', { volgend: 23 }));
  assert.equal(await volgendBon(), `Bonnetje ${jaar}-023`);
});

test('B7. gewoon afrekenen (nummer uit Accountable) werkt zoals voorheen', async () => {
  const x = await nieuwDossier('Manueel');
  const d = ok(await vraag('POST', `/dossiers/${x.id}/afrekenen`, { soort: 'factuur', nummer: '2026-002', datum: vandaag }));
  assert.equal(d.fase, 'afgerekend'); assert.equal(d.afgerekend_nummer, '2026-002');
  assert.equal(d.afrekening_pdf_op, null, 'geen ERP-document');
  assert.match(d.volgende_stap.tekst, /Afgerekend met factuur 2026-002/);
  fout(await vraag('GET', `/dossiers/${x.id}/bonnetje/pdf`), /geen bonnetje/);
});

test('B8. Accountable-import koppelt "2026-021" aan "Bonnetje 2026-021" (maar niet als het dubbelzinnig is)', async () => {
  const db = getDb();
  let v = vergelijk(db, [{ nummer: `${jaar}-021`, datum: vandaag, bedrag: 56, betaald: true }]);
  assert.equal(v.rijen[0].dossier?.id, d1.id);
  v = vergelijk(db, [{ nummer: `Bonnetje ${jaar}-022`, datum: vandaag, bedrag: 56, betaald: true }]);
  assert.equal(v.rijen[0].dossier?.id, d2.id);
  // een factuur met hetzelfde kale nummer als een bonnetje → dubbelzinnig
  const x = await nieuwDossier('Factuur 021');
  ok(await vraag('POST', `/dossiers/${x.id}/afrekenen`, { soort: 'factuur', nummer: `Factuur ${jaar}-021`, datum: vandaag }));
  v = vergelijk(db, [{ nummer: `${jaar}-021`, datum: vandaag, bedrag: 56, betaald: true }]);
  assert.equal(v.rijen[0].status, 'niet_gevonden');
  v = vergelijk(db, [{ nummer: `Factuur ${jaar}-021`, datum: vandaag, bedrag: 56, betaald: true }]);
  assert.equal(v.rijen[0].dossier?.id, x.id, 'volledig nummer blijft exact koppelen');
});

test('B9. sjabloon: btw-kolom 0 % en de volledige vrijstellingsvermelding', () => {
  const inhoud = { bedrijf: { naam: '3D Plezier' }, klant: null, dossier: { nummer: 'D-1', titel: 'T' }, regels: [{ omschrijving: 'x', aantal: 1, per_stuk: 2, bedrag: 2 }], totaal: 2, vast: 0 };
  const b = documentHtml({ soort: 'BONNETJE', nummer: '2026-021', datum: '2026-09-26', inhoud, btwKolom: true, info: [['Betaald op', '26-09-2026']] });
  assert.ok(b.includes('BONNETJE 2026-021'));
  assert.ok(b.includes('<th class="r">Btw</th>') && b.includes('<td class="r">0 %</td>'));
  assert.ok(b.includes(`Btw-tarief: 0 % · ${VRIJSTELLING}`));
  assert.ok(b.includes('Betaald op: 26-09-2026'));
  const w = documentHtml({ soort: 'WERKBON', nummer: 'WB-1', datum: '2026-09-26', inhoud });
  assert.ok(!w.includes('>Btw<') && w.includes('Vrijgesteld van btw — art. 56bis'), 'andere documenten ongewijzigd');
});
