// Een ontlede mail → wat de browser toont (30-09).
// Veiligheid: de HTML wordt opgeschoond (geen scripts, formulieren, iframes,
// event-handlers of javascript:-links); afbeeldingen van het internet worden
// standaard NIET geladen (ze verraden dat je de mail opende) — de browser
// toont de mail bovendien in een afgeschermd iframe zonder scripts, met een
// Content-Security-Policy. Ingesloten afbeeldingen (cid:) worden data-URI's.
import sanitizeHtml from 'sanitize-html';

const GEEN_URL = /^(?!.*(url\s*\(|expression\s*\(|javascript:)).*$/i;
const STIJLEN = ['color', 'background-color', 'background', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-align', 'text-decoration',
  'text-transform', 'line-height', 'letter-spacing', 'vertical-align', 'white-space', 'width', 'max-width', 'min-width', 'height', 'max-height',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-color', 'border-width', 'border-style', 'border-radius',
  'border-collapse', 'border-spacing', 'display', 'float', 'clear', 'direction', 'list-style', 'list-style-type', 'table-layout', 'word-break', 'overflow-wrap'];
const MAX_INLINE = 3 * 1024 * 1024;

export function veiligeHtml(html, { cid = new Map(), afbeeldingen = false } = {}) {
  let geblokkeerd = 0;
  const uit = sanitizeHtml(String(html || ''), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'font', 'center', 'span', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup', 'hr', 'br', 'u', 's', 'small', 'big', 'sub', 'sup'],
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'title', 'class'],
      a: ['href', 'name', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'data-src'],
      font: ['face', 'size', 'color'], table: ['border', 'cellpadding', 'cellspacing'], td: ['colspan', 'rowspan', 'nowrap'], th: ['colspan', 'rowspan'],
    },
    allowedStyles: { '*': Object.fromEntries(STIJLEN.map(s => [s, [GEEN_URL]])) },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['data', 'http', 'https', 'cid'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attr) => ({ tagName: 'a', attribs: { ...attr, target: '_blank', rel: 'noopener noreferrer' } }),
      img: (tag, attr) => {
        const src = String(attr.src || '');
        if (/^cid:/i.test(src)) {
          const d = cid.get(src.slice(4).replace(/^<|>$/g, '').toLowerCase());
          return { tagName: 'img', attribs: { ...attr, src: d || '' } };
        }
        if (/^https?:/i.test(src) && !afbeeldingen) { geblokkeerd += 1; return { tagName: 'img', attribs: { ...attr, src: '', 'data-src': src } }; }
        return { tagName: 'img', attribs: attr };
      },
    },
  });
  return { html: uit, geblokkeerd };
}

const adressen = v => (v?.value || []).map(a => ({ naam: a.name || null, adres: String(a.address || '').toLowerCase() || null })).filter(a => a.adres);
export const bijlagenVan = mail => (mail.attachments || []).map((a, index) => ({
  index, naam: a.filename || `bijlage-${index + 1}${/pdf/.test(a.contentType) ? '.pdf' : ''}`, type: a.contentType || 'application/octet-stream',
  grootte: a.size ?? a.content?.length ?? 0, inline: a.contentDisposition === 'inline' && !!a.cid, cid: a.cid || null,
}));

export function mailWeergave(mail, { map, uid, flags, afbeeldingen = false }) {
  const cid = new Map();
  for (const a of mail.attachments || []) {
    if (a.cid && a.content && a.content.length <= MAX_INLINE && /^image\//.test(a.contentType || '')) cid.set(String(a.cid).toLowerCase(), `data:${a.contentType};base64,${a.content.toString('base64')}`);
  }
  const html = mail.html ? veiligeHtml(mail.html, { cid, afbeeldingen }) : null;
  const bijlagen = bijlagenVan(mail);
  return {
    map, uid, onderwerp: mail.subject || '(geen onderwerp)', datum: mail.date?.toISOString?.() ?? null,
    van: adressen(mail.from)[0] || null, aan: adressen(mail.to), cc: adressen(mail.cc), antwoord_aan: adressen(mail.replyTo),
    message_id: mail.messageId || null, references: [].concat(mail.references || []).filter(Boolean),
    html: html?.html ?? null, geblokkeerd: html?.geblokkeerd ?? 0, tekst: mail.text || null,
    // gewone bijlagen (ingesloten afbeeldingen die al in de tekst staan niet)
    bijlagen: bijlagen.filter(b => !(b.inline && cid.has(String(b.cid).toLowerCase()))),
    gelezen: flags?.has?.('\\Seen') ?? true, ster: flags?.has?.('\\Flagged') ?? false, beantwoord: flags?.has?.('\\Answered') ?? false,
  };
}

// Klanten, dossiers en leveranciers die bij de adressen van de mail horen.
export function koppelingen(db, w, eigen) {
  const alle = [...new Set([w.van, ...w.aan, ...w.cc, ...w.antwoord_aan].filter(Boolean).map(a => a.adres).filter(a => a && a !== eigen))];
  if (!alle.length) return { klanten: [], leveranciers: [] };
  const plek = alle.map(() => '?').join(',');
  const klanten = db.prepare(`SELECT id, type, voornaam, naam, bedrijfsnaam, email FROM klanten WHERE LOWER(email) IN (${plek})`).all(...alle)
    .map(k => ({ id: k.id, email: k.email, naam: k.type === 'zakelijk' && k.bedrijfsnaam ? k.bedrijfsnaam : [k.voornaam, k.naam].filter(Boolean).join(' '),
      dossiers: db.prepare(`SELECT id, nummer, titel FROM dossiers WHERE klant_id = ? AND afgerekend_op IS NULL AND gratis_op IS NULL AND geannuleerd_op IS NULL
          AND samengevoegd_op IS NULL AND gearchiveerd = 0 ORDER BY id DESC LIMIT 10`).all(k.id) }));
  let leveranciers = [];
  try {
    leveranciers = db.prepare(`SELECT id, naam, email FROM leveranciers WHERE LOWER(email) IN (${plek})`).all(...alle);
    if (!leveranciers.length) {
      // op domein (bestellingen@joybuy.nl ↔ website joybuy.nl)
      const domeinen = [...new Set(alle.map(a => a.split('@')[1]))];
      leveranciers = db.prepare('SELECT id, naam, email, website FROM leveranciers').all()
        .filter(l => domeinen.some(d => (l.email && l.email.toLowerCase().endsWith(`@${d}`)) || (l.website && String(l.website).toLowerCase().includes(d.replace(/^(mail|email|info|noreply|no-reply)\./, '')))))
        .map(({ id, naam, email }) => ({ id, naam, email }));
    }
  } catch { /* geen e-mailkolom */ }
  return { klanten, leveranciers };
}

// Aanhalen bij beantwoorden / doorsturen (platte tekst).
export function citaat(w) {
  const wie = w.van ? (w.van.naam ? `${w.van.naam} <${w.van.adres}>` : w.van.adres) : 'onbekend';
  const wanneer = w.datum ? new Date(w.datum).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' }) : '';
  const tekst = w.tekst || sanitizeHtml(w.html || '', { allowedTags: [], allowedAttributes: {} }).replace(/\n{3,}/g, '\n\n');
  return { kop: `Op ${wanneer} schreef ${wie}:`, tekst: String(tekst || '').trim() };
}
