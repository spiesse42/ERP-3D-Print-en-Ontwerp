// ═══════════════════════════════════════════════════════════════════════
// REVIEWKAARTJE (27-10): om in de pakjes te steken, afdrukken op A4
// ═══════════════════════════════════════════════════════════════════════
// - a6: 4 kaartjes (A6, 105 × 148 mm) per A4, staand
// - visite: 10 visitekaartjes (85 × 55 mm) per A4
// Snijlijnen in stippellijn. Geen emoji (het lettertype van de add-on heeft
// ze niet); QR-code naar de Google-review (anders Facebook).
import { LOGO_DATA_URI } from './logo.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function kaartjeHtml(review, { formaat = 'a6', website = '3dprintenontwerp.be' } = {}) {
  const link = review.google_kort || review.facebook_kort;
  const a6 = `<div class="kaart ka6">
    <img class="logo" src="${LOGO_DATA_URI}" alt="">
    <div class="dank">Bedankt voor je bestelling!</div>
    <div class="tekst">Blij met je bestelling? Laat een review achter${review.google ? ' op Google' : ''}. Het helpt ons kleine atelier enorm.</div>
    <div class="qr">${review.qr}</div>
    <div class="scan">Scan de code met je gsm</div>
    <div class="link">${esc(link)}</div>
    <div class="site">${esc(website)}</div>
  </div>`;
  const visite = `<div class="kaart kvis">
    <div class="qr">${review.qr}</div>
    <div class="rechts">
      <img class="logo" src="${LOGO_DATA_URI}" alt="">
      <div class="dank">Blij met je bestelling?</div>
      <div class="tekst">Laat een review achter${review.google ? ' op Google' : ''}: scan de code. Bedankt!</div>
      <div class="site">${esc(website)}</div>
    </div>
  </div>`;
  const kaarten = formaat === 'visite' ? Array(10).fill(visite).join('') : Array(4).fill(a6).join('');
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Reviewkaartjes</title><style>
  @page { size: A4; margin: 0; }
  *{box-sizing:border-box} body{margin:0;font-family:'Segoe UI',Arial,sans-serif;color:#16345a}
  .blad{width:210mm;height:297mm;display:grid;justify-content:center;align-content:center}
  .blad.a6{grid-template-columns:105mm 105mm;grid-template-rows:148mm 148mm}
  .blad.visite{grid-template-columns:85mm 85mm;grid-template-rows:repeat(5,55mm)}
  .kaart{border:0.2mm dashed #bbb;overflow:hidden}
  .ka6{padding:9mm 8mm;display:flex;flex-direction:column;align-items:center;text-align:center}
  .ka6 .logo{height:20mm;margin-bottom:4mm}
  .ka6 .dank{font-size:15pt;font-weight:800;margin-bottom:3mm}
  .ka6 .tekst{font-size:10pt;line-height:1.4;color:#333;margin-bottom:5mm}
  .ka6 .qr svg{width:44mm;height:44mm;display:block;flex:none}
  .ka6 .scan{font-size:9pt;color:#2b9484;font-weight:700;margin-top:2mm}
  .ka6 .link{font-size:7.5pt;color:#555;margin-top:1mm;word-break:break-all}
  .ka6 .site{margin-top:auto;font-size:9pt;font-weight:700;color:#2b9484}
  .kvis{display:flex;align-items:center;gap:4mm;padding:4mm 5mm}
  .kvis .qr{flex:none}.kvis .qr svg{width:36mm;height:36mm;display:block}
  .kvis .rechts{display:flex;flex-direction:column;justify-content:center;min-width:0}
  .kvis .logo{height:9mm;width:auto;align-self:flex-start;margin-bottom:2mm}
  .kvis .dank{font-size:10.5pt;font-weight:800;margin-bottom:1.5mm}
  .kvis .tekst{font-size:7.5pt;line-height:1.35;color:#333}
  .kvis .site{font-size:7pt;font-weight:700;color:#2b9484;margin-top:2mm}
</style></head><body><div class="blad ${formaat === 'visite' ? 'visite' : 'a6'}">${kaarten}</div></body></html>`;
}
