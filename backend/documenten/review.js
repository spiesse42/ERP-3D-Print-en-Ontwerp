// ═══════════════════════════════════════════════════════════════════════
// REVIEWS (27-10): link + QR-code naar de Google-review (en Facebook)
// ═══════════════════════════════════════════════════════════════════════
// Onderaan de pakbon en het bonnetje: "Tevreden? Laat een review achter".
// Links in Instellingen → Bedrijfsgegevens (review_google, review_facebook);
// leeg = geen blok. De QR-code wordt synchroon getekend (matrix van de
// qrcode-bibliotheek → SVG), zodat de sjablonen gewoon synchroon blijven.
import QRCode from 'qrcode';
import { getDb } from '../db/index.js';

const instelling = (db, k) => String(db.prepare('SELECT waarde FROM instellingen WHERE sleutel = ?').get(k)?.waarde ?? '').trim() || null;
const kort = url => String(url).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export function qrSvg(tekst) {
  const { size, data } = QRCode.create(tekst, { errorCorrectionLevel: 'M' }).modules;
  let pad = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y * size + x]) pad += `M${x} ${y}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${size + 4} ${size + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="#fff"/><path d="${pad}" fill="#000"/></svg>`;
}

// → { google, facebook, google_kort, facebook_kort, qr } of null
export function reviewInfo(db = getDb()) {
  const google = instelling(db, 'review_google'), facebook = instelling(db, 'review_facebook');
  if (!google && !facebook) return null;
  return { google, facebook, google_kort: google && kort(google), facebook_kort: facebook && kort(facebook), qr: qrSvg(google || facebook) };
}
