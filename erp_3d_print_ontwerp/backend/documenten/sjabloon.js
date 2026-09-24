// HTML-sjabloon voor offerte en werkbon (A4). Zelfde opmaak als het oude
// pakket (kleuren, logo, totaalblok), nu met alles ge-escaped en bedragen in
// Belgische notatie. Aankoopfactuurnummers komen hier NOOIT op (vaste
// afspraak): het sjabloon krijgt enkel dossier-, klant- en bedrijfsgegevens.
import { LOGO_DATA_URI } from './logo.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = n => (n == null ? '—' : `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const getal = n => Number(n).toLocaleString('nl-BE', { maximumFractionDigits: 3 });
const dmj = d => (d ? String(d).slice(0, 10).split('-').reverse().join('-') : '');
const nl = t => esc(t).replace(/\n/g, '<br>');

function klantNaam(k) {
  if (!k) return '';
  if (k.type === 'zakelijk' && k.bedrijfsnaam) return k.bedrijfsnaam;
  return [k.voornaam, k.naam].filter(Boolean).join(' ');
}

// soort: 'OFFERTE' | 'WERKBON'; info: [[label, waarde]] rechtsboven
export function documentHtml({ soort, nummer, datum, info = [], inhoud, opmerking, concept = false, toonUren = false }) {
  const { bedrijf = {}, klant, dossier, regels, totaal, vast } = inhoud;
  const k = klant;
  const contact = k && [k.type === 'zakelijk' && k.bedrijfsnaam && (k.voornaam || k.naam) ? `t.a.v. ${[k.voornaam, k.naam].filter(Boolean).join(' ')}` : null,
    [[k.straat, k.huisnummer].filter(Boolean).join(' '), [k.postcode, k.gemeente].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    k.email, k.btw_nummer ? `Btw: ${k.btw_nummer}` : null].filter(Boolean);
  const rijen = regels.map(r => `
    <tr>
      <td class="n">${getal(r.aantal)}</td>
      <td>${esc(r.omschrijving)}${toonUren && r.uren ? `<div class="sub">printtijd ${getal(r.uren)} u</div>` : ''}</td>
      <td class="r">${euro(r.per_stuk)}</td>
      <td class="r">${euro(r.bedrag)}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><title>${esc(soort)} ${esc(nummer)}</title>
<style>
  @page { size: A4; margin: 0; }
  body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1a1a1a;margin:0;padding:40px;font-size:13px}
  .header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #16345a;padding-bottom:20px;margin-bottom:24px}
  .logo img{height:64px;width:auto;display:block}
  .bedrijf{margin-top:8px;font-size:.78rem;color:#777;line-height:1.5}
  .doc{text-align:right;color:#555;font-size:.85rem;line-height:1.6}
  .doc-nr{font-size:1.15rem;font-weight:bold;color:#1a1a1a}
  .klant{background:#f5f7fa;border-radius:8px;padding:14px 18px;margin-bottom:18px}
  .klant h3{margin:0 0 6px;font-size:.68rem;text-transform:uppercase;letter-spacing:1.5px;color:#16345a}
  .object{margin-bottom:16px;font-size:.95rem}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  th{background:#16345a;color:#fff;padding:9px 12px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.5px}
  td{padding:9px 12px;border-bottom:1px solid #eee;vertical-align:top}
  tr:nth-child(even) td{background:#f8f9fa}
  .n{width:60px}.r{text-align:right;width:110px;white-space:nowrap}
  th.r{text-align:right}
  .sub{color:#888;font-size:.75rem;margin-top:2px}
  .totaal{background:#16345a;color:#fff;border-radius:8px;padding:16px 22px;display:flex;justify-content:space-between;align-items:center}
  .totaal-label{color:#b8c4d6;font-size:.8rem;letter-spacing:1px}
  .totaal-bedrag{font-size:1.9rem;font-weight:900;color:#2b9484}
  .opmerking{margin-top:16px;padding:12px 16px;border-left:4px solid #f59e0b;background:#fffbeb;border-radius:4px;color:#664400}
  .footer{margin-top:32px;border-top:1px solid #eee;padding-top:12px;font-size:.72rem;color:#999;text-align:center;line-height:1.6}
  .concept{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:110px;font-weight:900;color:rgba(200,40,40,.12);transform:rotate(-24deg)}
</style></head>
<body>
${concept ? '<div class="concept">CONCEPT</div>' : ''}
<div class="header">
  <div>
    <div class="logo"><img src="${LOGO_DATA_URI}" alt="${esc(bedrijf.naam || 'Logo')}"></div>
    <div class="bedrijf">
      ${bedrijf.naam ? `<strong>${esc(bedrijf.naam)}</strong><br>` : ''}
      ${bedrijf.adres ? `${esc(bedrijf.adres)}<br>` : ''}
      ${bedrijf.email ? `${esc(bedrijf.email)}<br>` : ''}
      ${bedrijf.btw ? `Ondernemingsnr.: ${esc(bedrijf.btw)}` : ''}
    </div>
  </div>
  <div class="doc">
    <div class="doc-nr">${esc(soort)} ${esc(nummer)}</div>
    <div>${esc(dmj(datum))}</div>
    ${info.filter(([, w]) => w).map(([l, w]) => `<div>${esc(l)}: ${esc(w)}</div>`).join('')}
  </div>
</div>
${k ? `<div class="klant"><h3>Klant</h3><strong>${esc(klantNaam(k))}</strong>${contact.map(c => `<br>${esc(c)}`).join('')}</div>` : ''}
<div class="object"><strong>${esc(dossier.titel)}</strong> <span class="sub">· dossier ${esc(dossier.nummer)}</span></div>
<table>
  <thead><tr><th>Aantal</th><th>Omschrijving</th><th class="r">Prijs/stuk</th><th class="r">Totaal</th></tr></thead>
  <tbody>${rijen}</tbody>
</table>
<div class="totaal">
  <div class="totaal-label">TOTAAL${vast > 0 ? `<div class="sub" style="color:#b8c4d6">waarvan ${euro(vast)} vaste kosten (bv. verzending)</div>` : ''}</div>
  <div class="totaal-bedrag">${euro(totaal)}</div>
</div>
${opmerking ? `<div class="opmerking">${nl(opmerking)}</div>` : ''}
<div class="footer">
  Vrijgesteld van btw — art. 56bis Btw-wetboek
  ${bedrijf.iban ? `<br>IBAN: ${esc(bedrijf.iban)}` : ''}
</div>
</body></html>`;
}

export const dmjDatum = dmj;

// Pakbon: wat er nu geleverd wordt, ZONDER prijzen (beslist 25-09), met
// eerder geleverd en wat nog volgt.
export function pakbonHtml({ nummer, datum, inhoud, regels, opmerking }) {
  const basis = documentHtml({ soort: 'PAKBON', nummer, datum, inhoud: { ...inhoud, regels: [], totaal: null, vast: 0 }, opmerking });
  const rijen = regels.map(r => `
    <tr>
      <td>${esc(r.omschrijving)}</td>
      <td class="r">${getal(r.besteld)}</td>
      <td class="r"><strong>${getal(r.nu)}</strong></td>
      <td class="r">${getal(r.eerder)}</td>
      <td class="r">${getal(r.rest)}</td>
    </tr>`).join('');
  const tabel = `<table>
  <thead><tr><th>Omschrijving</th><th class="r">Besteld</th><th class="r">Nu geleverd</th><th class="r">Eerder geleverd</th><th class="r">Nog te leveren</th></tr></thead>
  <tbody>${rijen}</tbody>
</table>`;
  const handtekening = '<div class="handtekening"><div>Ontvangen op: ....................</div><div>Handtekening: ...................................</div></div>';
  // tabel met prijzen + totaalblok van het basissjabloon vervangen
  return basis
    .replace(/<table>[\s\S]*?<\/table>\s*<div class="totaal">[\s\S]*?<\/div>\s*<\/div>/, tabel)
    .replace('<div class="footer">', `${handtekening}\n<div class="footer">`)
    .replace('</style>', '  .handtekening{display:flex;justify-content:space-between;margin-top:36px;color:#555;font-size:.85rem}\n</style>');
}
