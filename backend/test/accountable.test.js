// Stap 7: Accountable-export (Excel/CSV) → betaald-status, en UBL-aankoopfacturen
// inlezen zonder Gemini (zelfde nakijkscherm als Factuur inlezen).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { stopWachter } from '../productie/wachter.js';
import { datumVan, bedragVan, stelKolommenVoor } from '../domein/accountable.js';
import { leesUbl, isUbl } from '../integraties/ubl.js';

let server, basis;
const map = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-acc-'));
before(async () => {
  process.env.BIJLAGEN_PAD = path.join(map, 'bijlagen');
  initDb(':memory:');
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); stopWachter(); sluitDb(); fs.rmSync(map, { recursive: true, force: true }); });
async function vraag(methode, pad, body) {
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* leeg */ }
  return { status: res.status, data };
}
async function stuur(pad, buffer, naam, type = 'application/octet-stream') {
  const fd = new FormData();
  fd.append('bestand', new Blob([buffer], { type }), naam);
  const res = await fetch(basis + pad, { method: 'POST', body: fd });
  return { status: res.status, data: await res.json() };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
let d1, d2, d3;

test('A0. hulpfuncties: datums, bedragen, kolomvoorstel', () => {
  assert.equal(datumVan('12/03/2026'), '2026-03-12'); assert.equal(datumVan('2026-03-12T00:00:00Z'), '2026-03-12');
  assert.equal(datumVan(46093), '2026-03-12', 'Excel-serienummer'); assert.equal(datumVan('x'), null);
  assert.equal(bedragVan('€ 1.234,56'), 1234.56); assert.equal(bedragVan('1,234.56'), 1234.56); assert.equal(bedragVan(12.5), 12.5);
  assert.deepEqual(stelKolommenVoor(['Factuurnummer', 'Factuurdatum', 'Klant', 'Totaal incl. btw', 'Betaaldatum']),
    { betaaldatum: 4, nummer: 0, datum: 1, bedrag: 3, klant: 2 });
  assert.deepEqual(stelKolommenVoor(['Nummer', 'Datum', 'Bedrag', 'Openstaand']), { openstaand: 3, nummer: 0, datum: 1, bedrag: 2 });
});

test('A1. voorbereiding: drie afgerekende dossiers', async () => {
  const db = getDb();
  const k = ok(await vraag('POST', '/klanten', { type: 'particulier', naam: 'Maes' }), 201).id;
  const maak = async t => ok(await vraag('POST', '/dossiers', { titel: t, klant_id: k, regels: [{ type: 'extra', bedrag: 10 }] }), 201);
  d1 = await maak('Een'); d2 = await maak('Twee'); d3 = await maak('Drie');
  const af = db.prepare(`UPDATE dossiers SET afgerekend_soort = 'factuur', afgerekend_nummer = ?, afgerekend_op = ?, afgerekend_bedrag = ? WHERE id = ?`);
  af.run('F2026-001', '2026-03-01', 100, d1.id); af.run('f 2026/002', '2026-03-05', 50, d2.id); af.run('F2026-009', '2026-03-06', 20, d3.id);
});

test('A2. Excel: kolommen voorgesteld, vergelijken, betaald zetten met de betaaldatum', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inkomsten');
  ws.addRow(['Export Accountable']);                      // titelrij boven de koppen
  ws.addRow(['Factuurnummer', 'Factuurdatum', 'Klant', 'Totaal incl. btw', 'Betaaldatum']);
  ws.addRow(['F2026-001', new Date(Date.UTC(2026, 2, 1)), 'Maes', 100, new Date(Date.UTC(2026, 2, 10))]);
  ws.addRow(['F2026-002', '05/03/2026', 'Maes', '55,00', null]);
  ws.addRow(['F2026-077', '07/03/2026', 'Peeters', 30, '08/03/2026']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = ok(await stuur('/financien/accountable', buf, 'export.xlsx'));
  const b = r.bladen[0];
  assert.equal(b.naam, 'Inkomsten'); assert.equal(b.aantal, 3);
  assert.deepEqual(b.voorstel, { betaaldatum: 4, nummer: 0, datum: 1, bedrag: 3, klant: 2 });
  const v = ok(await vraag('POST', `/financien/accountable/${r.token}/vergelijk`, { blad: 0, kolommen: b.voorstel }));
  const st = Object.fromEntries(v.rijen.map(x => [x.nummer, x.status]));
  assert.deepEqual(st, { 'F2026-001': 'betalen', 'F2026-002': 'open', 'F2026-077': 'niet_gevonden' });
  assert.equal(v.rijen.find(x => x.nummer === 'F2026-002').bedrag_verschilt, true, '55 ≠ 50');
  assert.deepEqual(v.ontbreekt_in_export.map(d => d.afgerekend_nummer), ['F2026-009']);
  assert.match((await vraag('POST', `/financien/accountable/${r.token}/vergelijk`, { blad: 0, kolommen: { datum: 1 } })).data.error, /nummer/);
  const t = ok(await vraag('POST', `/financien/accountable/${r.token}/toepassen`, { blad: 0, kolommen: b.voorstel, dossier_ids: [d1.id, d2.id] }));
  assert.equal(t.betaald, 1, 'enkel wat in de export betaald is');
  assert.equal(getDb().prepare('SELECT betaald_op FROM dossiers WHERE id = ?').get(d1.id).betaald_op, '2026-03-10');
  assert.equal(getDb().prepare('SELECT betaald_op FROM dossiers WHERE id = ?').get(d2.id).betaald_op, null);
  assert.equal((await vraag('POST', `/financien/accountable/${r.token}/vergelijk`, { blad: 0, kolommen: b.voorstel })).status, 404, 'bestand opgeruimd');
});

test('A3. CSV met status-kolom; ongeldig bestand', async () => {
  const csv = '﻿Nummer;Datum;Bedrag;Status\r\nF2026-002;05/03/2026;50,00;Betaald\r\nF2026-009;06/03/2026;20,00;Openstaand\r\n';
  const r = ok(await stuur('/financien/accountable', Buffer.from(csv), 'export.csv', 'text/csv'));
  const k = { nummer: 0, datum: 1, bedrag: 2, betaald: 3 };
  const v = ok(await vraag('POST', `/financien/accountable/${r.token}/vergelijk`, { blad: 0, kolommen: k }));
  assert.deepEqual(v.rijen.map(x => [x.nummer, x.status]), [['F2026-002', 'betalen'], ['F2026-009', 'open']]);
  ok(await vraag('POST', `/financien/accountable/${r.token}/toepassen`, { blad: 0, kolommen: k, dossier_ids: [d2.id] }));
  const vandaag = new Date().toISOString().slice(0, 10);
  assert.equal(getDb().prepare('SELECT betaald_op FROM dossiers WHERE id = ?').get(d2.id).betaald_op, vandaag, 'zonder betaaldatum: vandaag');
  assert.match((await stuur('/financien/accountable', Buffer.from('x'), 'export.pdf')).data.error, /xlsx/);
  assert.equal((await stuur('/financien/accountable', Buffer.from('niet excel'), 'export.xlsx')).status, 400);
});

const PDF = Buffer.from('%PDF-1.4\n%nep\n').toString('base64');
const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ID>INV-4711</cbc:ID>
  <cbc:IssueDate>2026-09-15</cbc:IssueDate>
  <cac:AdditionalDocumentReference><cbc:ID>INV-4711</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="application/pdf" filename="INV-4711.pdf">${PDF}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="0208">0123456789</cbc:EndpointID>
    <cac:PartyName><cbc:Name>Filamentwinkel</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>BE0123456789</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Filamentwinkel BV</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Verzendkosten</cbc:AllowanceChargeReason><cbc:Amount currencyID="EUR">5.00</cbc:Amount>
    <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:TaxCategory></cac:AllowanceCharge>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="EUR">60.50</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">60.50</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">40.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Bambu Lab PLA Basic Zwart 1 kg</cbc:Name><cac:SellersItemIdentification><cbc:ID>PLA-BLK</cbc:ID></cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item></cac:InvoiceLine>
  <cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">5.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Sleutelringen 50 st.</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item></cac:InvoiceLine>
</Invoice>`;

test('A4. UBL lezen: regels incl. btw, filament herkend, toeslag = kostregel, PDF meegestuurd', () => {
  assert.ok(isUbl(Buffer.from(UBL)));
  const u = leesUbl(Buffer.from(UBL), { merken: ['Bambu Lab'], materialen: ['PLA'], kleuren: ['Zwart', 'Wit'] });
  assert.equal(u.creditnota, false);
  assert.deepEqual([u.gelezen.leverancier.naam, u.gelezen.leverancier.btw_nummer, u.gelezen.factuurnummer, u.gelezen.datum, u.gelezen.totaal_incl_btw],
    ['Filamentwinkel BV', 'BE0123456789', 'INV-4711', '2026-09-15', 60.5]);
  const [fil, ring, kost] = u.gelezen.regels;
  assert.deepEqual([fil.soort, fil.merk, fil.materiaal, fil.kleur, fil.aantal, fil.prijs_per_eenheid, fil.productcode], ['filament', 'Bambu Lab', 'PLA', 'Zwart', 2, 24.2, 'PLA-BLK']);
  assert.deepEqual([ring.soort, ring.prijs_per_eenheid], ['artikel', 6.05]);
  assert.deepEqual([kost.soort, kost.omschrijving, kost.prijs_per_eenheid], ['kost', 'Verzendkosten', 6.05]);
  assert.ok(u.pdf.data.toString().startsWith('%PDF'));
  assert.equal(u.pdf.bestandsnaam, 'INV-4711.pdf');
});

test('A5. UBL via Factuur inlezen: voorstel zonder Gemini, bevestigen = aankoop met bron UBL en PDF-bijlage', async () => {
  delete process.env.GEMINI_API_KEY;
  const r = ok(await stuur('/inkoop/inlezen', Buffer.from(UBL), 'INV-4711.xml', 'text/xml'));
  assert.equal(r.bron, 'ubl'); assert.equal(r.mimetype, 'application/pdf');
  const v = r.voorstel;
  assert.equal(v.klopt, true, 'som regels = totaal');
  assert.equal(v.regels[0].soort, 'nieuw_filament');
  const bestand = await fetch(`${basis}/inkoop/inlezen/${r.token}/bestand`);
  assert.equal(bestand.headers.get('content-type'), 'application/pdf');
  // bevestigen zoals het nakijkscherm: filament als nieuw, ringen als nieuw artikel, kost
  const regels = v.regels.map(x => (x.soort === 'nieuw_filament'
    ? { ...x, filament: { ...x.filament, verkoopprijs_per_kg: 25 } }
    : x));
  const a = ok(await vraag('POST', `/inkoop/inlezen/${r.token}/bevestig`, { leverancier: v.leverancier, factuurnummer: v.factuurnummer, datum: v.datum, regels, meteen_ontvangen: true }), 201);
  const ak = getDb().prepare('SELECT * FROM aankopen WHERE id = ?').get(a.id);
  assert.equal(ak.bron, 'ubl'); assert.equal(ak.extern_factuurnummer, 'INV-4711');
  assert.equal(getDb().prepare(`SELECT mimetype FROM bijlagen WHERE entiteit = 'aankoop' AND entiteit_id = ?`).get(a.id).mimetype, 'application/pdf');
  // creditnota en geen UBL
  const cn = UBL.replace(/<Invoice /, '<CreditNote ').replace('</Invoice>', '</CreditNote>').replace(/InvoiceLine/g, 'CreditNoteLine').replace(/InvoicedQuantity/g, 'CreditedQuantity')
    .replace('Invoice-2', 'CreditNote-2');
  assert.match((await stuur('/inkoop/inlezen', Buffer.from(cn), 'cn.xml', 'text/xml')).data.error, /creditnota/i);
  assert.match((await stuur('/inkoop/inlezen', Buffer.from('<?xml version="1.0"?><a/>'), 'x.xml', 'text/xml')).data.error, /geen UBL/);
});
