// 26-09: in "Nieuwe verkoop" ook een DOSSIER (één regel, prijs zonder offerte
// aanpasbaar), een voltooide LOSSE PRINTOPDRACHT (voorstel van de rekenmotor)
// en een VRIJE regel. Dossier afgerekend met hetzelfde bonnetjesnummer; niets
// dubbel in Financiën; ongedaan maken zet alles terug.
process.env.MAIL_NEP = '1';
if (!process.env.PUPPETEER_EXECUTABLE_PATH && (await import('fs')).existsSync('/opt/pw-browsers/chromium')) process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/pw-browsers/chromium';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { MIGRATIES } from '../db/migraties/index.js';
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
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
const fout = (r, patroon) => { assert.equal(r.status, 400, JSON.stringify(r.data)); assert.match(r.data.error, patroon); };
const jaar = new Date().getFullYear();
const nu = new Date();
const vandaag = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`;
const iso = u => new Date(Date.now() - u * 3600e3).toISOString();
const volgendBon = async () => ok(await vraag('GET', '/nummering')).find(x => x.reeks === 'BON').voorbeeld;
let mini, zwart, klantA, klantB, bluey, metOfferte, anderKlant, opd, opdZonderFilament, verkoop;

test('K0. voorbereiding: dossiers (zonder en met aanvaarde offerte), voltooide losse printopdrachten', async () => {
  const db = getDb();
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIES.at(-1).versie);
  mini = db.prepare(`SELECT id FROM printers WHERE naam = 'Bambu Lab A1 Mini'`).get().id;
  ok(await vraag('PUT', `/printers/${mini}`, { naam: 'Bambu Lab A1 Mini', machine_per_uur: 0.2, verbruik_watt: 95 }));
  const pg = ok(await vraag('POST', '/filament/types', { merk_id: 1, materiaal_id: 1, verkoopprijs_per_kg: 25 }), 201).id;
  zwart = ok(await vraag('POST', '/voorraad/artikelen', { type: 'filament', filament_type_id: pg, kleur_id: 1 }), 201).id;
  ok(await vraag('POST', `/voorraad/artikelen/${zwart}/boeking`, { richting: 'in', aantal: 2, prijs_per_eenheid: 20, datum: '2026-09-01' }));
  klantA = ok(await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Rebecca', naam: 'Oorbeek', email: 'rebecca@voorbeeld.be' }), 201).id;
  klantB = ok(await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Tom', naam: 'Peeters' }), 201).id;
  bluey = ok(await vraag('POST', '/dossiers', { titel: 'Bluey', klant_id: klantA, regels: [{ type: 'extra', omschrijving: 'Bluey-figuur', bedrag: 30 }] }), 201);
  metOfferte = ok(await vraag('POST', '/dossiers', { titel: 'Met offerte', klant_id: klantA, regels: [{ type: 'extra', omschrijving: 'Naamplaat', bedrag: 20 }] }), 201);
  let d = ok(await vraag('POST', `/dossiers/${metOfferte.id}/offertes`), 201);
  ok(await vraag('POST', `/offertes/${d.offertes[0].id}/versturen`));
  ok(await vraag('POST', `/offertes/${d.offertes[0].id}/aanvaard`, { datum: vandaag }));
  anderKlant = ok(await vraag('POST', '/dossiers', { titel: 'Van Tom', klant_id: klantB, regels: [{ type: 'extra', bedrag: 10 }] }), 201);
  // losse printopdracht met filament, bevestigd met 2 goede stuks
  let run = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(10), geeindigd_op: iso(8), uitkomst: 'klaar', kwh: 0.2 }), 201);
  ok(await vraag('POST', `/productie/runs/${run.id}/koppel`, { nieuw: { naam: 'Rolhouder', aantal: 2, soort: 'eigen', materialen: [{ artikel_id: zwart, gram: 60 }] } }));
  opd = ok(await vraag('GET', '/productie/opdrachten')).lijst.find(x => x.naam === 'Rolhouder');
  ok(await vraag('POST', `/productie/opdrachten/${opd.id}/bevestig`, { aantal_goed: 2 }));
  // en één zonder filament
  run = ok(await vraag('POST', '/productie/runs', { printer_id: mini, gestart_op: iso(6), geeindigd_op: iso(5), uitkomst: 'klaar', kwh: 0.1 }), 201);
  ok(await vraag('POST', `/productie/runs/${run.id}/koppel`, { nieuw: { naam: 'Clip', aantal: 1, soort: 'intern' } }));
  opdZonderFilament = ok(await vraag('GET', '/productie/opdrachten')).lijst.find(x => x.naam === 'Clip');
  ok(await vraag('POST', `/productie/opdrachten/${opdZonderFilament.id}/bevestig`, { aantal_goed: 1 }));
  ok(await vraag('PUT', '/nummering/BON', { volgend: 40 }));
});

test('K1. kandidaten: af te rekenen dossiers en voltooide losse printopdrachten met voorstelprijs', async () => {
  const k = ok(await vraag('GET', '/verkopen/kandidaten'));
  const b = k.dossiers.find(x => x.id === bluey.id);
  assert.ok(b && b.volledig && b.offerte === false && b.bedrag > 0);
  const o = k.dossiers.find(x => x.id === metOfferte.id);
  assert.equal(o.offerte, true);
  const p = k.printopdrachten.find(x => x.id === opd.id);
  assert.ok(p.voorstel > 0, JSON.stringify(p)); assert.equal(p.aantal_goed, 2);
  assert.ok(!p.waarschuwingen.some(w => /filament/i.test(w)));
  const z = k.printopdrachten.find(x => x.id === opdZonderFilament.id);
  assert.ok(z.waarschuwingen.some(w => /Geen filament/.test(w)));
  const pz = k.printopdrachten.find(x => x.id === opdZonderFilament.id).voorstel;
  assert.ok(p.voorstel > pz, 'met filament duurder dan zonder');
});

test('K2. controles vooraf: geen nummer verbruikt bij een fout', async () => {
  const voor = await volgendBon();
  const k = ok(await vraag('GET', '/verkopen/kandidaten'));
  const offerteBedrag = k.dossiers.find(x => x.id === metOfferte.id).bedrag;
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'dossier', dossier_id: metOfferte.id, prijs_per_stuk: offerteBedrag + 5 }] }), /aanvaarde offerte/);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'dossier', dossier_id: bluey.id }, { soort: 'dossier', dossier_id: bluey.id }] }), /staat al op dit bonnetje/);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'dossier', dossier_id: bluey.id }, { soort: 'dossier', dossier_id: anderKlant.id }] }), /andere klant/);
  fout(await vraag('POST', '/verkopen', { klant_id: klantB, regels: [{ soort: 'dossier', dossier_id: bluey.id }] }), /andere klant/);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'vrij', prijs_per_stuk: 5 }] }), /omschrijving/);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'vrij', omschrijving: 'Bluey-hanger' }] }), /prijs per stuk/);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'printopdracht', printopdracht_id: 9999 }] }), /Onbekende printopdracht/);
  const eigen = ok(await vraag('POST', '/dossiers', { soort: 'eigen', titel: 'Eigen', regels: [{ type: 'extra', bedrag: 5 }] }), 201);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'dossier', dossier_id: eigen.id }] }), /geen klantopdracht/);
  assert.equal(await volgendBon(), voor);
  assert.equal(ok(await vraag('GET', `/dossiers/${bluey.id}`)).fase, 'nieuw', 'dossier ongemoeid');
});

test('K3. verkopen: dossier (prijs aangepast) + printopdracht + vrije regel op één bonnetje', async () => {
  const postvak = nepPostvak().length;
  const k = ok(await vraag('GET', '/verkopen/kandidaten'));
  const voorstel = k.printopdrachten.find(x => x.id === opd.id).voorstel;
  const blueyBerekend = k.dossiers.find(x => x.id === bluey.id).bedrag;
  verkoop = ok(await vraag('POST', '/verkopen', { omschrijving: 'Bestelling FB', naar_klant: true, aan: 'rebecca@voorbeeld.be', regels: [
    { soort: 'dossier', dossier_id: bluey.id, prijs_per_stuk: '50' },
    { soort: 'printopdracht', printopdracht_id: opd.id },
    { soort: 'vrij', omschrijving: 'Bluey-sleutelhanger (buiten ERP)', aantal: 2, prijs_per_stuk: '7,5' }] }), 201);
  assert.equal(verkoop.mail_fout, null);
  assert.equal(verkoop.nummer, `Bonnetje ${jaar}-040`);
  assert.equal(verkoop.klant_id, klantA, 'klant van het dossier overgenomen');
  const r = verkoop.regels;
  assert.deepEqual(r.map(x => x.soort), ['dossier', 'printopdracht', 'vrij']);
  assert.equal(r[0].omschrijving, `Bluey (dossier ${bluey.nummer})`); assert.equal(r[0].bedrag, 50); assert.equal(r[0].berekend, blueyBerekend);
  assert.equal(r[1].aantal, 2); assert.equal(r[1].berekend, voorstel);
  assert.ok(Math.abs(r[1].bedrag - voorstel) < 0.02, `${r[1].bedrag} ≈ ${voorstel}`);
  assert.equal(r[2].bedrag, 15);
  assert.equal(verkoop.totaal, Math.round((50 + r[1].bedrag + 15) * 100) / 100);
  assert.equal(verkoop.dossierdeel, 50);
  assert.ok(verkoop.kost > 0, 'productiekost van de printopdracht');
  assert.equal(nepPostvak().length, postvak + 1, 'één mail');
  assert.equal(nepPostvak().at(-1).cc, 'inkomsten@accountable.eu');
  // het dossier
  const d = ok(await vraag('GET', `/dossiers/${bluey.id}`));
  assert.equal(d.fase, 'betaald');
  assert.equal(d.afgerekend_soort, 'bonnetje'); assert.equal(d.afgerekend_nummer, verkoop.nummer);
  assert.equal(d.afgerekend_bedrag, 50); assert.equal(d.betaald_op, vandaag);
  assert.equal(d.afrekening_pdf_op, null, 'het document is dat van de verkoop');
  assert.ok(d.werkbon.definitief_op);
  assert.deepEqual(d.afgerekend_via, { id: verkoop.id, nummer: verkoop.nummer, gemaild_op: d.afgerekend_via.gemaild_op });
  assert.ok(d.afgerekend_via.gemaild_op);
  assert.match(d.volgende_stap.tekst, /afgerekend via Bonnetje \d{4}-040 \(losse verkoop\)/);
  assert.equal(d.acties.afrekening_ongedaan, false);
  fout(await vraag('POST', `/dossiers/${bluey.id}/afrekening-ongedaan`), /maak de verkoop ongedaan/);
  assert.ok(ok(await vraag('GET', `/historiek/dossier/${bluey.id}`)).some(h => /Afgerekend via Bonnetje \d{4}-040 \(losse verkoop\), € 50,00 \(berekend: /.test(h.tekst)));
  // de printopdracht
  const o = ok(await vraag('GET', `/productie/opdrachten/${opd.id}`));
  assert.equal(o.verkocht_nummer, verkoop.nummer);
  fout(await vraag('POST', `/productie/opdrachten/${opd.id}/heropen`), /verkocht via/);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'printopdracht', printopdracht_id: opd.id }] }), /al verkocht/);
  fout(await vraag('POST', '/verkopen', { regels: [{ soort: 'dossier', dossier_id: bluey.id }] }), /al afgerekend/);
  const k2 = ok(await vraag('GET', '/verkopen/kandidaten'));
  assert.ok(!k2.dossiers.some(x => x.id === bluey.id) && !k2.printopdrachten.some(x => x.id === opd.id));
  // klant van een verkoop met een dossier ligt vast
  fout(await vraag('PUT', `/verkopen/${verkoop.id}`, { klant_id: klantB }), /volgt het dossier/);
});

test('K4. overzicht, Financiën en Accountable: niets dubbel', async () => {
  const lijst = ok(await vraag('GET', '/verkopen'));
  assert.equal(lijst.filter(x => x.nummer === verkoop.nummer).length, 1, 'dossier niet apart in het overzicht');
  assert.equal(lijst.find(x => x.nummer === verkoop.nummer).dossiers, bluey.nummer);
  const maand = vandaag.slice(0, 7);
  const o = ok(await vraag('GET', `/financien/overzicht?jaar=${jaar}`));
  const m = o.maanden.find(x => x.maand === maand);
  assert.equal(m.omzet, verkoop.totaal); assert.equal(m.bonnetjes, 1); assert.equal(m.ontvangen, verkoop.totaal);
  const mg = ok(await vraag('GET', `/financien/marges?jaar=${jaar}`));
  assert.equal(mg.rijen.find(x => x.id === bluey.id).afgerekend_bedrag, 50, 'dossier met zijn eigen marge');
  const vr = mg.rijen.find(x => x.verkoop_id === verkoop.id);
  assert.equal(vr.afgerekend_bedrag, Math.round((verkoop.totaal - 50) * 100) / 100, 'verkoop zonder het dossierdeel');
  assert.equal(mg.totaal.bedrag, verkoop.totaal, 'samen = het bonnetje');
  const st = ok(await vraag('GET', `/financien/statistieken?jaar=${jaar}`));
  assert.equal(st.maanden.find(x => x.maand === maand).omzet, verkoop.totaal);
  const v = vergelijk(getDb(), [{ nummer: verkoop.nummer, datum: vandaag, bedrag: verkoop.totaal, betaald: true }]);
  assert.equal(v.rijen[0].status, 'in_orde'); assert.equal(v.rijen[0].verkoop.id, verkoop.id);
  assert.equal(v.ontbreekt_in_export.length, 0, 'het dossier ontbreekt niet (zit in de verkoop)');
});

test('K5. dossier met aanvaarde offerte: offerteprijs, zonder prijs in te vullen', async () => {
  const k = ok(await vraag('GET', '/verkopen/kandidaten'));
  const bedrag = k.dossiers.find(x => x.id === metOfferte.id).bedrag;
  const v = ok(await vraag('POST', '/verkopen', { regels: [{ soort: 'dossier', dossier_id: metOfferte.id }] }), 201);
  assert.equal(v.totaal, bedrag);
  assert.equal(ok(await vraag('GET', `/dossiers/${metOfferte.id}`)).afgerekend_bedrag, bedrag);
  // een verkoop met enkel een dossier staat niet als extra rij in Marges
  const mg = ok(await vraag('GET', `/financien/marges?jaar=${jaar}`));
  assert.ok(!mg.rijen.some(x => x.verkoop_id === v.id));
});

test('K6. ongedaan maken: dossier weer open (werkbon concept), printopdracht weer vrij, omzet terug', async () => {
  const d0 = ok(await vraag('GET', `/dossiers/${bluey.id}`));
  ok(await vraag('POST', `/verkopen/${verkoop.id}/annuleer`));
  const d = ok(await vraag('GET', `/dossiers/${bluey.id}`));
  assert.equal(d.afgerekend_nummer, null); assert.equal(d.betaald_op, null); assert.equal(d.afgerekend_via, null);
  assert.equal(d.werkbon.definitief_op, null); assert.equal(d.werkbon.versie, d0.werkbon.versie + 1);
  assert.ok(d.acties.afrekenen);
  assert.ok(ok(await vraag('GET', `/historiek/dossier/${bluey.id}`)).some(h => /Verkoop Bonnetje \d{4}-040 ongedaan gemaakt/.test(h.tekst)));
  const o = ok(await vraag('GET', `/productie/opdrachten/${opd.id}`));
  assert.equal(o.verkocht_nummer, null);
  const k = ok(await vraag('GET', '/verkopen/kandidaten'));
  assert.ok(k.dossiers.some(x => x.id === bluey.id) && k.printopdrachten.some(x => x.id === opd.id));
  const h = ok(await vraag('GET', `/historiek/verkoop/${verkoop.id}`));
  assert.ok(h.some(x => /afrekening van de dossiers ongedaan, printopdrachten weer vrij/.test(x.tekst)));
  const m = ok(await vraag('GET', `/financien/overzicht?jaar=${jaar}`)).maanden.find(x => x.maand === vandaag.slice(0, 7));
  const offerteVerkoop = ok(await vraag('GET', '/verkopen')).find(x => x.bron === 'verkoop' && !x.geannuleerd_op);
  assert.equal(m.omzet, offerteVerkoop.bedrag, 'enkel de verkoop van K5 blijft');
  // het nummer 040 blijft bezet
  assert.equal(await volgendBon(), `Bonnetje ${jaar}-042`);
});
