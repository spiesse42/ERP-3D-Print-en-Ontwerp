// E-mail met PDF-bijlage via SMTP (nodemailer). SMTP_USER / SMTP_PASS /
// SMTP_FROM (+ SMTP_HOST / SMTP_PORT) komen ENKEL uit de add-on-configuratie
// of omgevingsvariabelen — nooit uit de databank.
// - zonder SMTP_HOST: Gmail (zoals het oude pakket; SMTP_PASS = app-wachtwoord)
// - met SMTP_HOST: eigen mailserver, bv. OVH MX Plan: ssl0.ovh.net, poort 465
//   (SSL/TLS), gebruiker = het volledige e-mailadres. Poort 465 = SSL/TLS
//   meteen; een andere poort (587) = STARTTLS.
// MAIL_NEP=1 (tests): niets versturen, enkel bijhouden.
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { imapIngesteld, bewaarIn } from '../mail/imap.js';

const nep = [];
export const nepPostvak = () => nep;
export function mailIngesteld() {
  return !!(process.env.MAIL_NEP || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

export function smtpInstellingen() {
  const auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return { service: 'gmail', auth };
  const port = Number(process.env.SMTP_PORT) || 465;
  return { host, port, secure: port === 465, requireTLS: port !== 465, auth };
}
export const mailServer = () => String(process.env.SMTP_HOST || '').trim() || 'Gmail';

let transport = null, sleutel = null;
function haalTransport() {
  if (process.env.MAIL_NEP) return nodemailer.createTransport({ jsonTransport: true });
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  if (!transport || sleutel !== `${user}:${pass}:${process.env.SMTP_HOST || ''}:${process.env.SMTP_PORT || ''}`) {
    transport = nodemailer.createTransport(smtpInstellingen());
    sleutel = `${user}:${pass}:${process.env.SMTP_HOST || ''}:${process.env.SMTP_PORT || ''}`;
  }
  return transport;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export class MailFout extends Error {}

// Enkel een geldig e-mailadres (gedeeld met de routes: vooraf controleren).
export const geldigAdres = a => EMAIL.test(String(a || '').trim());

// cc (26-09): bv. inkomsten@accountable.eu bij een bonnetje dat ook naar de
// klant gaat. Leeg/afwezig = geen cc.
export async function verstuurMail({ aan, cc = null, onderwerp, tekst, bijlage }) {
  const ontvanger = String(aan || '').trim();
  if (!EMAIL.test(ontvanger)) throw new MailFout('Vul een geldig e-mailadres in.');
  const kopie = String(cc || '').trim();
  if (kopie && !EMAIL.test(kopie)) throw new MailFout(`Ongeldig e-mailadres in cc: ${kopie}`);
  const t = haalTransport();
  if (!t) throw new MailFout('Mailen is nog niet ingesteld: vul smtp_user en smtp_pass in bij de add-on-configuratie (Gmail: app-wachtwoord; eigen server: ook smtp_host en smtp_port) (lokaal: omgevingsvariabelen).');
  const bericht = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'erp@localhost',
    to: ontvanger, ...(kopie ? { cc: kopie } : {}), subject: onderwerp, text: tekst,
    attachments: bijlage ? [{ filename: bijlage.naam, content: bijlage.inhoud, contentType: 'application/pdf' }] : [],
  };
  await verstuur(t, bericht);
  if (process.env.MAIL_NEP) nep.push({ ...bericht, bijlage_bytes: bijlage?.inhoud?.length || 0 });
}

// Versturen + (30-09) een kopie in de map "Verzonden" van de mailbox, zodat
// alles wat het ERP verstuurt ook in je mailprogramma/webmail staat. Lukt
// dat laatste niet, dan is de mail toch verstuurd (enkel een melding in de log).
async function verstuur(t, bericht) {
  const raw = await new MailComposer(bericht).compile().build();
  const ontvangers = [bericht.to, bericht.cc, bericht.bcc].flat().filter(Boolean)
    .flatMap(x => String(x).split(',')).map(x => x.replace(/^.*<([^>]+)>.*$/, '$1').trim()).filter(Boolean);
  const van = String(bericht.from).replace(/^.*<([^>]+)>.*$/, '$1').trim();
  try {
    await t.sendMail({ envelope: { from: van, to: ontvangers }, raw });
  } catch (e) {
    console.error('[mail]', e.message);
    const server = mailServer();
    if (e.code === 'EAUTH') throw new MailFout(server === 'Gmail'
      ? 'Gmail weigert de aanmelding. Controleer smtp_user en het app-wachtwoord (smtp_pass).'
      : `${server} weigert de aanmelding. Controleer smtp_user (het volledige e-mailadres) en het wachtwoord (smtp_pass).`);
    if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(e.code) || /ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(e.message)) {
      throw new MailFout(`Geen verbinding met de mailserver ${server}${process.env.SMTP_HOST ? `:${Number(process.env.SMTP_PORT) || 465}` : ''}. Klopt smtp_host en smtp_port (OVH: ssl0.ovh.net, 465)?`);
    }
    if (e.responseCode >= 500 && e.responseCode < 600) throw new MailFout(`De mailserver weigerde de e-mail: ${String(e.response || e.message).slice(0, 200)}`);
    throw new MailFout(`De e-mail kon niet verstuurd worden via ${server}.`);
  }
  if (imapIngesteld()) {
    try { await bewaarIn('verzonden', raw); } catch (e) { console.error('[mail] niet in Verzonden gezet:', e.message); }
  }
  return raw;
}

// Een gewone mail vanuit de tegel Mail (30-09): meerdere ontvangers, cc/bcc,
// bijlagen, en bij een antwoord de juiste koppen (zelfde gesprek in de
// mailbox van de klant).
const lijst = v => [...new Set(String(v ?? '').split(/[,;]/).map(x => x.trim()).filter(Boolean))];
export async function verstuurVrij({ aan, cc, bcc, onderwerp, tekst, bijlagen = [], antwoordOp = null, references = [] }) {
  const to = lijst(aan), kc = lijst(cc), bk = lijst(bcc);
  if (!to.length) throw new MailFout('Vul minstens één ontvanger in.');
  const fout = [...to, ...kc, ...bk].find(a => !EMAIL.test(a.replace(/^.*<([^>]+)>.*$/, '$1')));
  if (fout) throw new MailFout(`Ongeldig e-mailadres: ${fout}`);
  const t = haalTransport();
  if (!t) throw new MailFout('Mailen is nog niet ingesteld: vul smtp_user en smtp_pass in bij de add-on-configuratie.');
  const bericht = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'erp@localhost',
    to: to.join(', '), ...(kc.length ? { cc: kc.join(', ') } : {}), ...(bk.length ? { bcc: bk.join(', ') } : {}),
    subject: String(onderwerp ?? '').trim() || '(geen onderwerp)', text: String(tekst ?? ''),
    ...(antwoordOp ? { inReplyTo: antwoordOp, references: [...references, antwoordOp].filter(Boolean) } : {}),
    attachments: bijlagen.map(b => ({ filename: b.naam, content: b.inhoud, contentType: b.type || undefined })),
  };
  const raw = await verstuur(t, bericht);
  if (process.env.MAIL_NEP) nep.push({ ...bericht, bijlage_bytes: bijlagen.reduce((n, b) => n + (b.inhoud?.length || 0), 0) });
  return raw;
}
// Een concept bewaren in "Concepten" (niet versturen).
export async function bewaarConcept({ aan, cc, bcc, onderwerp, tekst, bijlagen = [] }) {
  const raw = await new MailComposer({ from: process.env.SMTP_FROM || process.env.SMTP_USER || 'erp@localhost',
    to: lijst(aan).join(', ') || undefined, cc: lijst(cc).join(', ') || undefined, bcc: lijst(bcc).join(', ') || undefined,
    subject: String(onderwerp ?? ''), text: String(tekst ?? ''), attachments: bijlagen.map(b => ({ filename: b.naam, content: b.inhoud, contentType: b.type || undefined })),
  }).compile().build();
  return bewaarIn('concepten', raw, ['\\Seen', '\\Draft']);
}
