// ═══════════════════════════════════════════════════════════════════════
// UBL (Peppol BIS 3) aankoopfactuur inlezen — zonder Gemini (stap 7)
// ═══════════════════════════════════════════════════════════════════════
// Domeinmodel: "De UBL-export van aankoopfacturen kan zonder OCR in
// Aankoop/voorraad ingelezen worden." Het resultaat heeft DEZELFDE vorm als
// het antwoord van Gemini, zodat het koppelen en het nakijkscherm van
// Factuur inlezen ongewijzigd hergebruikt worden.
// - prijzen incl. btw (vrijstellingsregel: btw is kost): regelbedrag excl.
//   btw × (1 + btw% van de regel) ÷ aantal
// - kosten (verzending, …) als losse kostregel; toeslagen op documentniveau
//   (AllowanceCharge met ChargeIndicator=true) ook als kostregel
// - een meegestuurde PDF (AdditionalDocumentReference) dient als voorbeeld
//   en bijlage
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true, parseTagValue: false, trimValues: true });
const lijst = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const tekst = v => {
  if (v == null) return null;
  if (typeof v === 'object') return v['#text'] != null ? String(v['#text']).trim() || null : null;
  return String(v).trim() || null;
};
const getal = v => { const t = tekst(v); const n = t == null ? NaN : parseFloat(t); return Number.isFinite(n) ? n : null; };
const r4 = v => Math.round(v * 10000) / 10000;

const KOST = /verzend|verzending|shipping|freight|transport|porto|levering|delivery|handling|toeslag|surcharge/i;
const FILAMENT = /filament|\b(pla|petg|abs|asa|tpu|pc|pa|pva|hips)\b/i;

export function isUbl(buffer) {
  const begin = buffer.subarray(0, 4000).toString('utf8');
  return /<(\w+:)?(Invoice|CreditNote)[\s>]/.test(begin) && /oasis|ubl/i.test(begin);
}

// catalogus: { merken: [naam], materialen: [naam], kleuren: [naam] } om filament te herkennen
export function leesUbl(buffer, catalogus = { merken: [], materialen: [], kleuren: [] }) {
  let doc;
  try { doc = parser.parse(buffer.toString('utf8')); } catch { throw new Error('Het XML-bestand kon niet gelezen worden.'); }
  const creditnota = !!doc.CreditNote;
  const f = doc.Invoice || doc.CreditNote;
  if (!f) throw new Error('Dit is geen UBL-factuur (geen <Invoice> of <CreditNote> gevonden).');
  const partij = f.AccountingSupplierParty?.Party || {};
  const naam = tekst(partij.PartyLegalEntity?.RegistrationName) || tekst(lijst(partij.PartyName)[0]?.Name) || null;
  const btw = tekst(lijst(partij.PartyTaxScheme)[0]?.CompanyID) || tekst(partij.EndpointID) || null;
  const zoek = (namen, t) => namen.filter(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)).sort((a, b) => b.length - a.length)[0] || null;

  const regels = lijst(f.InvoiceLine || f.CreditNoteLine).map(l => {
    const item = l.Item || {};
    const omschrijving = tekst(item.Name) || tekst(lijst(item.Description)[0]) || tekst(lijst(l.Note)[0]) || 'Regel';
    const aantal = getal(l.InvoicedQuantity ?? l.CreditedQuantity) || 1;
    const excl = getal(l.LineExtensionAmount) ?? 0;
    const pct = getal(lijst(item.ClassifiedTaxCategory)[0]?.Percent) ?? 0;
    const incl = excl * (1 + pct / 100);
    const code = tekst(item.SellersItemIdentification?.ID) || tekst(item.StandardItemIdentification?.ID) || null;
    const volledig = `${omschrijving} ${tekst(lijst(item.Description)[0]) || ''}`;
    const r = { omschrijving, productcode: code, aantal: r4(Math.abs(aantal)), prijs_per_eenheid: r4(Math.abs(incl / (aantal || 1))), regeltotaal: r4(Math.abs(incl)) };
    if (KOST.test(omschrijving)) return { ...r, soort: 'kost' };
    if (FILAMENT.test(volledig)) {
      return { ...r, soort: 'filament', merk: zoek(catalogus.merken, `${volledig} ${naam || ''}`), materiaal: zoek(catalogus.materialen, volledig), kleur: zoek(catalogus.kleuren, volledig) };
    }
    return { ...r, soort: 'artikel', naam_voorstel: omschrijving.slice(0, 80) };
  });
  // toeslagen op documentniveau (bv. verzending) als kostregel
  for (const ac of lijst(f.AllowanceCharge)) {
    if (tekst(ac.ChargeIndicator) !== 'true') continue;
    const excl = getal(ac.Amount) ?? 0;
    const pct = getal(lijst(ac.TaxCategory)[0]?.Percent) ?? 0;
    regels.push({ soort: 'kost', omschrijving: tekst(ac.AllowanceChargeReason) || 'Toeslag', productcode: null, aantal: 1, prijs_per_eenheid: r4(excl * (1 + pct / 100)), regeltotaal: r4(excl * (1 + pct / 100)) });
  }
  const totaal = getal(f.LegalMonetaryTotal?.PayableAmount) ?? getal(f.LegalMonetaryTotal?.TaxInclusiveAmount);
  // meegestuurde PDF
  let pdf = null;
  for (const ref of lijst(f.AdditionalDocumentReference)) {
    const obj = ref.Attachment?.EmbeddedDocumentBinaryObject;
    if (obj && /pdf/i.test(obj['@mimeCode'] || '') && tekst(obj)) {
      pdf = { data: Buffer.from(tekst(obj).replace(/\s+/g, ''), 'base64'), bestandsnaam: obj['@filename'] || `${tekst(f.ID) || 'factuur'}.pdf` };
      break;
    }
  }
  return {
    gelezen: {
      leverancier: { naam, btw_nummer: btw, website: null },
      factuurnummer: tekst(f.ID),
      datum: /^\d{4}-\d{2}-\d{2}$/.test(tekst(f.IssueDate) || '') ? tekst(f.IssueDate) : null,
      totaal_incl_btw: totaal == null ? null : r4(Math.abs(totaal)),
      regels,
    },
    creditnota,
    pdf,
  };
}
