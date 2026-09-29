// ═══════════════════════════════════════════════════════════════════════
// FACTUUR van het ERP (29-09) — zelfde werkwijze als het bonnetje:
// ═══════════════════════════════════════════════════════════════════════
// - nummer uit de reeks FAC ("Factuur 2026-004"); op de PDF "FACTUUR 2026-004"
//   zoals in Accountable
// - PDF met factuurdatum, datum uitvoering, vervaldatum, de gegevens van
//   beide partijen, rekeninggegevens, mededeling = factuurnummer, een EPC-QR
//   ("betaal met je bank-app") en de vermelding van de vrijstellingsregeling
// - mail: ALTIJD naar Accountable (inkomsten@accountable.eu), EXACT één keer;
//   optioneel naar de klant (Accountable dan in cc)
// - Peppol: een Belgische btw-plichtige klant moet de factuur via Peppol
//   krijgen (verplicht sinds 2026). Het ERP is geen Peppol-toegangspunt: de
//   factuur gaat naar Accountable, en daar verstuur je ze via Peppol.
import QRCode from 'qrcode';
import { documentHtml, dmjDatum } from './sjabloon.js';

export const kaalFactuur = n => String(n ?? '').replace(/^\s*factuur\s+/i, '');   // "Factuur 2026-004" → "2026-004"
export const factuurBestand = (nummer, extra = '') => `Factuur ${kaalFactuur(nummer)}${extra}.pdf`.replace(/[^\w .-]/g, '_');

// EPC-QR (European Payments Council, SEPA credit transfer), versie 002: BIC
// mag leeg. Bedrag met punt, max. 2 decimalen; mededeling max. 140 tekens.
export function epcTekst({ naam, iban, bic, bedrag, mededeling }) {
  const schoon = v => String(v ?? '').replace(/\s+/g, '');
  if (!schoon(iban) || !(Number(bedrag) > 0)) return null;
  return ['BCD', '002', '1', 'SCT', schoon(bic).toUpperCase(), String(naam || '').slice(0, 70), schoon(iban).toUpperCase(),
    `EUR${Number(bedrag).toFixed(2)}`, '', '', String(mededeling || '').slice(0, 140)].join('\n');
}

// Een Belgische btw-plichtige klant (zakelijk, btw-nummer BE…, of een
// Belgische Peppol-ID): factuur via Peppol verplicht.
export function peppolVerplicht(k) {
  if (!k || k.type !== 'zakelijk') return false;
  const land = k.land || 'BE';
  return land === 'BE' && (/^BE/i.test(String(k.btw_nummer || '')) || /^0208:/.test(String(k.peppol_id || '')));
}

// inhoud = het document van de definitieve werkbon (bedrijf, klant, regels,
// totaal zoals ze op het moment van factureren waren).
export async function factuurHtml({ inhoud, nummer, datum, vervaldatum, uitvoering = null, concept = false }) {
  const b = inhoud.bedrijf || {};
  const nr = kaalFactuur(nummer);
  const betaling = { rekeninghouder: b.rekeninghouder || b.naam, iban: b.iban, bic: b.bic, mededeling: nr };
  const epc = epcTekst({ naam: b.rekeninghouder || b.naam, iban: b.iban, bic: b.bic, bedrag: inhoud.totaal, mededeling: nr });
  const qr = epc && !concept ? await QRCode.toString(epc, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) : null;
  return documentHtml({ soort: 'FACTUUR', nummer: nr, datum, concept, inhoud,
    info: [['Factuurdatum', dmjDatum(datum)], ['Datum uitvoering', dmjDatum(uitvoering || datum)], ['Vervaldatum', dmjDatum(vervaldatum)]],
    factuur: { betaling, qr } });
}
