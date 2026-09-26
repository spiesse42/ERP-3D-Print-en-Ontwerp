// E-mail met PDF-bijlage via SMTP (nodemailer). SMTP_USER / SMTP_PASS /
// SMTP_FROM (+ SMTP_HOST / SMTP_PORT) komen ENKEL uit de add-on-configuratie
// of omgevingsvariabelen — nooit uit de databank.
// - zonder SMTP_HOST: Gmail (zoals het oude pakket; SMTP_PASS = app-wachtwoord)
// - met SMTP_HOST: eigen mailserver, bv. OVH MX Plan: ssl0.ovh.net, poort 465
//   (SSL/TLS), gebruiker = het volledige e-mailadres. Poort 465 = SSL/TLS
//   meteen; een andere poort (587) = STARTTLS.
// MAIL_NEP=1 (tests): niets versturen, enkel bijhouden.
import nodemailer from 'nodemailer';

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
  try {
    await t.sendMail(bericht);
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
  if (process.env.MAIL_NEP) nep.push({ ...bericht, bijlage_bytes: bijlage?.inhoud?.length || 0 });
}
