// E-mail met PDF-bijlage via Gmail SMTP (nodemailer), zoals in het oude
// pakket. SMTP_USER / SMTP_PASS (app-wachtwoord) / SMTP_FROM komen ENKEL uit
// de add-on-configuratie of omgevingsvariabelen — nooit uit de databank.
// MAIL_NEP=1 (tests): niets versturen, enkel bijhouden.
import nodemailer from 'nodemailer';

const nep = [];
export const nepPostvak = () => nep;
export function mailIngesteld() {
  return !!(process.env.MAIL_NEP || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

let transport = null, sleutel = null;
function haalTransport() {
  if (process.env.MAIL_NEP) return nodemailer.createTransport({ jsonTransport: true });
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  if (!transport || sleutel !== `${user}:${pass}`) {
    transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    sleutel = `${user}:${pass}`;
  }
  return transport;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export class MailFout extends Error {}

export async function verstuurMail({ aan, onderwerp, tekst, bijlage }) {
  const ontvanger = String(aan || '').trim();
  if (!EMAIL.test(ontvanger)) throw new MailFout('Vul een geldig e-mailadres in.');
  const t = haalTransport();
  if (!t) throw new MailFout('Mailen is nog niet ingesteld: vul SMTP_USER en SMTP_PASS (Gmail-app-wachtwoord) in bij de add-on-configuratie (lokaal: omgevingsvariabelen).');
  const bericht = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'erp@localhost',
    to: ontvanger, subject: onderwerp, text: tekst,
    attachments: bijlage ? [{ filename: bijlage.naam, content: bijlage.inhoud, contentType: 'application/pdf' }] : [],
  };
  try {
    await t.sendMail(bericht);
  } catch (e) {
    console.error('[mail]', e.message);
    if (e.code === 'EAUTH') throw new MailFout('Gmail weigert de aanmelding. Controleer SMTP_USER en het app-wachtwoord (SMTP_PASS).');
    throw new MailFout('De e-mail kon niet verstuurd worden (geen verbinding met de mailserver?).');
  }
  if (process.env.MAIL_NEP) nep.push({ ...bericht, bijlage_bytes: bijlage?.inhoud?.length || 0 });
}
