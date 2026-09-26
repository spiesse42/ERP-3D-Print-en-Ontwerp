// 26-09: tegel "Verkoop" — losse verkoop zonder dossier. Bonnetje uit de
// reeks BON (zelfde teller als een dossier), voorraad FIFO eraf, altijd naar
// Accountable (+ optioneel de klant, Accountable in cc), telt mee in Financiën.
process.env.MAIL_NEP = '1';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && (await import('fs')).existsSync('/opt/pw-browsers/chromium')) process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { nepPostvak } from '../documenten/mail.js';
import { sluitBrowser } from '../documenten/pdf.js';
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
const voorraad = id => getDb().prepare('SELECT COALESCE(SUM(aantal_resterend),0) v FROM voorraad_partijen WHERE artikel_id = ?').get(id).v;
const volgendBon = async () => ok(await vraag('GET', '/nummering')).find(x => x.reeks === 'BON').voorbeeld;
let klant, hond, zonderPrijs, verzending, v1;

test('V0. voorbereiding: artikelen met voorraad (twee partijen), dienst, klant; volgend bonnetje 30', async () => {
  hond = ok(await vraag('POST', '/voorraad/artikelen', { type: 'artikel', naam: 'Sleutelhanger hond', zelf_geprint: true, wordt_verkocht: true, verkoopprijs: 4 }), 201).id;
  ok(await vraag('POST', `/voorraad/artikelen/${hond}/boeking`, { richting: 'in', aantal: 2, prijs_per_eenheid: 1, datum: '2026-09-01' }));
  ok(await vraag('POST', `/voorraad/artikelen/${hond}/boeking`, { richting: 'in', aantal: 5, prijs_per_eenheid: 1.5, datum: '2026-09-10' }));
  // filament (rol): heeft geen verkoopprijs per stuk → prijs verplicht in te vullen
  const pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  zonderPrijs = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: 1 }), 201).id;
  ok(await vraag('POST', `/voorraad/artikelen/${zonderPrijs}/boeking`, { richting: 'in', aantal: 3, datum: '2026-09-01' }));
  verzending = ok(await vraag('POST', '/voorraad/artikelen', { type: 'dienst', naam: 'Verzending', wordt_verkocht: true, verkoopprijs: 5.5 }), 201).id;
  klant = ok(await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Tom', naam: 'Peeters', email: 'tom@voorbeeld.be' }), 201).id;
  ok(await vraag('PUT', '/nummering/BON', { volgend: 30 }));
});

test('V1. voorstel en voorbeeld: nummer zichtbaar, niets bewaard', async () => {
  const v = ok(await vraag('GET', '/verkopen/voorstel'));
  assert.equal(v.nummer, `Bonnetje ${jaar}-030`); assert.equal(v.accountable, ACC); assert.equal(v.mail_ingesteld, true);
  const p = await vraag('POST', '/verkopen/voorbeeld', { regels: [{ artikel_id: hond, aantal: 3 }] });
  assert.equal(p.status, 200); assert.equal(p.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(voorraad(hond), 7); assert.equal(await volgendBon(), `Bonnetje ${jaar}-030`);
  assert.equal(ok(await vraag('GET', '/verkopen')).length, 0);
});

test('V2. verkopen: bonnetje, voorraad FIFO eraf, dienst zonder voorraad, enkel naar Accountable', async () => {
  const d = ok(await vraag('POST', '/verkopen', { datum: vandaag, omschrijving: 'Markt Aarsele', regels: [
    { artikel_id: hond, aantal: 3 },                                  // prijs uit het artikel (4)
    { artikel_id: verzending, aantal: 1, prijs_per_stuk: '4,50', omschrijving: 'Verzending bpost' }] }), 201);
  v1 = d;
  assert.equal(d.mail_fout, null);
  assert.equal(d.nummer, `Bonnetje ${jaar}-030`);
  assert.equal(d.totaal, 16.5);
  assert.deepEqual(d.regels.map(r => [r.omschrijving, r.aantal, r.prijs_per_stuk, r.bedrag]), [['Sleutelhanger hond', 3, 4, 12], ['Verzending bpost', 1, 4.5, 4.5]]);
  assert.equal(voorraad(hond), 4, '7 - 3');
  assert.equal(d.kost, 2 * 1 + 1 * 1.5, 'FIFO: 2 aan € 1 + 1 aan € 1,50');
  assert.ok(d.gemaild_op); assert.equal(d.klant_mail, null);
  const m = nepPostvak().at(-1);
  assert.equal(m.to, ACC); assert.equal(m.cc, undefined); assert.equal(m.subject, `Bonnetje ${jaar}-030`);
  assert.equal(m.attachments[0].filename, `Bonnetje ${jaar}-030.pdf`);
  assert.equal(await volgendBon(), `Bonnetje ${jaar}-031`);
  const mut = ok(await vraag('GET', `/voorraad/artikelen/${hond}`));
  assert.ok(mut, 'artikel leesbaar');
  const pdf = await vraag('GET', `/verkopen/${d.id}/pdf`);
  assert.equal(pdf.pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(ok(await vraag('GET', `/historiek/verkoop/${d.id}`)).some(h => /gemaild naar Accountable/.test(h.tekst)));
});

test('V3. met klant: aan de klant, Accountable in cc; dossier-bonnetjes delen dezelfde teller', async () => {
  const d = ok(await vraag('POST', '/verkopen', { klant_id: klant, naar_klant: true, aan: 'tom@voorbeeld.be', onderwerp: 'Je aankoop', tekst: 'Bedankt!',
    regels: [{ artikel_id: hond, aantal: 1 }] }), 201);
  assert.equal(d.nummer, `Bonnetje ${jaar}-031`); assert.equal(d.klant, 'Tom Peeters');
  const m = nepPostvak().at(-1);
  assert.equal(m.to, 'tom@voorbeeld.be'); assert.equal(m.cc, ACC);
  // een dossier-bonnetje neemt het volgende nummer
  const dos = ok(await vraag('POST', '/dossiers', { titel: 'Dossier', klant_id: klant, regels: [{ type: 'extra', bedrag: 10 }] }), 201);
  const db = ok(await vraag('POST', `/dossiers/${dos.id}/bonnetje`, {}), 201);
  assert.equal(db.afgerekend_nummer, `Bonnetje ${jaar}-032`);
  // Nummering: niet lager dan wat al gebruikt is (ook door verkopen)
  fout(await vraag('PUT', '/nummering/BON', { volgend: 31 }), /niet lager dan 33/);
  // overzicht: alle bonnetjes samen, nieuwste nummer eerst bij dezelfde datum
  const lijst = ok(await vraag('GET', '/verkopen'));
  assert.deepEqual(lijst.map(x => [x.nummer, x.bron]), [[`Bonnetje ${jaar}-032`, 'dossier'], [`Bonnetje ${jaar}-031`, 'verkoop'], [`Bonnetje ${jaar}-030`, 'verkoop']]);
});

test('V4. controles vooraf: geen nummer en geen voorraad verbruikt bij een fout', async () => {
  const voor = await volgendBon();
  fout(await vraag('POST', '/verkopen', { regels: [] }), /minstens één regel/);
  fout(await vraag('POST', '/verkopen', { regels: [{ artikel_id: hond, aantal: 99 }] }), /Onvoldoende voorraad van Sleutelhanger hond/);
  fout(await vraag('POST', '/verkopen', { regels: [{ artikel_id: hond, aantal: 3 }, { artikel_id: hond, aantal: 1 }] }), /Onvoldoende voorraad/);  // samen 4 > 3
  fout(await vraag('POST', '/verkopen', { regels: [{ artikel_id: zonderPrijs, aantal: 1 }] }), /prijs per stuk/);
  fout(await vraag('POST', '/verkopen', { regels: [{ artikel_id: hond, aantal: 0 }] }), /aantal/);
  fout(await vraag('POST', '/verkopen', { regels: [{ artikel_id: 9999, aantal: 1 }] }), /kies een artikel/);
  fout(await vraag('POST', '/verkopen', { klant_id: 9999, regels: [{ artikel_id: hond, aantal: 1 }] }), /Onbekende klant/);
  fout(await vraag('POST', '/verkopen', { naar_klant: true, aan: 'x', regels: [{ artikel_id: hond, aantal: 1 }] }), /geldig e-mailadres/);
  const morgen = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  fout(await vraag('POST', '/verkopen', { datum: morgen, regels: [{ artikel_id: hond, aantal: 1 }] }), /toekomst/);
  assert.equal(await volgendBon(), voor); assert.equal(voorraad(hond), 3);
});

test('V5. mailen mislukt: verkoop blijft, later exact één keer naar Accountable', async () => {
  const bewaard = { ...process.env };
  delete process.env.MAIL_NEP;
  Object.assign(process.env, { SMTP_USER: 'x@voorbeeld.be', SMTP_PASS: 'x', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1' });
  let d;
  try { d = ok(await vraag('POST', '/verkopen', { regels: [{ artikel_id: zonderPrijs, aantal: 1, prijs_per_stuk: 3 }] }), 201); }
  finally {
    for (const k of ['SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT']) { if (bewaard[k] === undefined) delete process.env[k]; else process.env[k] = bewaard[k]; }
    process.env.MAIL_NEP = '1';
  }
  assert.match(d.mail_fout, /verbinding/i); assert.equal(d.gemaild_op, null);
  assert.equal(voorraad(zonderPrijs), 2, 'verkocht is verkocht');
  const x = ok(await vraag('POST', `/verkopen/${d.id}/mail`, { naar_accountable: true }));
  assert.ok(x.gemaild_op);
  fout(await vraag('POST', `/verkopen/${d.id}/mail`, { naar_accountable: true }), /al naar Accountable/);
  ok(await vraag('POST', `/verkopen/${d.id}/mail`, { naar_klant: true, aan: 'tom@voorbeeld.be' }));
  assert.equal(nepPostvak().at(-1).cc, undefined, 'klant opnieuw: zonder Accountable');
  assert.equal(x.onvolledig, true, 'partij zonder prijs → kost onvolledig');
});

test('V6. klant achteraf koppelen; ongedaan maken boekt de voorraad terug op dezelfde partijen', async () => {
  let d = ok(await vraag('PUT', `/verkopen/${v1.id}`, { klant_id: klant }));
  assert.equal(d.klant_id, klant);
  const voor = voorraad(hond);
  d = ok(await vraag('POST', `/verkopen/${v1.id}/annuleer`));
  assert.ok(d.geannuleerd_op);
  assert.equal(voorraad(hond), voor + 3);
  const p = getDb().prepare('SELECT aantal_resterend FROM voorraad_partijen WHERE artikel_id = ? ORDER BY ontvangen_op, id').all(hond).map(x => x.aantal_resterend);
  assert.equal(p[0], 2, 'oudste partij terug vol');
  fout(await vraag('POST', `/verkopen/${v1.id}/annuleer`), /al ongedaan/);
  fout(await vraag('POST', `/verkopen/${v1.id}/mail`, { naar_klant: true, aan: 'tom@voorbeeld.be' }), /ongedaan/);
  assert.ok(ok(await vraag('GET', `/historiek/verkoop/${v1.id}`)).some(h => /pas het daar ook aan/.test(h.tekst)));
  // het nummer blijft bezet
  assert.equal((await volgendBon()) > `Bonnetje ${jaar}-030`, true);
});

test('V7. Financiën: losse verkopen tellen mee (omzet, ontvangen, bonnetjes, marges), ongedane niet', async () => {
  const o = ok(await vraag('GET', `/financien/overzicht?jaar=${jaar}`));
  const maand = vandaag.slice(0, 7);
  const m = o.maanden.find(x => x.maand === maand);
  // dossier-bonnetje (V3) + verkoop 031 (4) + verkoop V5 (3); verkoop 030 is ongedaan
  const dossierBedrag = ok(await vraag('GET', '/verkopen')).find(x => x.bron === 'dossier').bedrag;
  assert.equal(m.omzet, Math.round((dossierBedrag + 4 + 3) * 100) / 100);
  assert.equal(m.bonnetjes, 3);
  assert.equal(m.ontvangen, m.omzet);
  const mg = ok(await vraag('GET', `/financien/marges?jaar=${jaar}`));
  const rij = mg.rijen.find(r => r.nummer === `Bonnetje ${jaar}-031`);
  assert.equal(rij.afgerekend_soort, 'verkoop'); assert.equal(rij.afgerekend_bedrag, 4);
  assert.ok(rij.kost > 0 && rij.verkoop_id);
  assert.ok(!mg.rijen.some(r => r.nummer === `Bonnetje ${jaar}-030`), 'ongedaan telt niet');
  const st = ok(await vraag('GET', `/financien/statistieken?jaar=${jaar}`));
  assert.equal(st.maanden.find(x => x.maand === maand).omzet, m.omzet);
});

test('V8. Accountable-import: losse verkoop wordt herkend (in orde)', () => {
  const v = vergelijk(getDb(), [{ nummer: `Bonnetje ${jaar}-031`, datum: vandaag, bedrag: 4, betaald: true }, { nummer: `${jaar}-031`, datum: vandaag, bedrag: 4, betaald: true }]);
  for (const r of v.rijen) { assert.equal(r.status, 'in_orde'); assert.equal(r.verkoop.nummer, `Bonnetje ${jaar}-031`); assert.equal(r.dossier, null); }
});
