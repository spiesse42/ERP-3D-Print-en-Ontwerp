// Mailserver instelbaar (25-09): leeg = Gmail, anders eigen SMTP (bv. OVH).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { smtpInstellingen, mailServer, verstuurMail, MailFout } from '../documenten/mail.js';

const bewaar = { ...process.env };
afterEach(() => { for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_NEP']) { if (bewaar[k] === undefined) delete process.env[k]; else process.env[k] = bewaar[k]; } });

test('M1. zonder host: Gmail; met host: SSL op 465, STARTTLS op 587', () => {
  delete process.env.MAIL_NEP;
  process.env.SMTP_USER = 'info@3dprintenontwerp.be'; process.env.SMTP_PASS = 'x';
  delete process.env.SMTP_HOST; delete process.env.SMTP_PORT;
  assert.equal(smtpInstellingen().service, 'gmail'); assert.equal(mailServer(), 'Gmail');
  process.env.SMTP_HOST = 'ssl0.ovh.net';
  assert.deepEqual(smtpInstellingen(), { host: 'ssl0.ovh.net', port: 465, secure: true, requireTLS: false, auth: { user: 'info@3dprintenontwerp.be', pass: 'x' } });
  process.env.SMTP_PORT = '587';
  const s = smtpInstellingen();
  assert.deepEqual([s.port, s.secure, s.requireTLS], [587, false, true]);
  assert.equal(mailServer(), 'ssl0.ovh.net');
});

test('M2. verkeerde server/poort: duidelijke melding met de server', async () => {
  delete process.env.MAIL_NEP;
  const vrij = net.createServer().listen(0); await new Promise(r => vrij.once('listening', r));
  const poort = vrij.address().port; await new Promise(r => vrij.close(r));
  Object.assign(process.env, { SMTP_USER: 'a@b.be', SMTP_PASS: 'x', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(poort) });
  await assert.rejects(verstuurMail({ aan: 'klant@voorbeeld.be', onderwerp: 't', tekst: 't' }),
    e => e instanceof MailFout && e.message.includes(`127.0.0.1:${poort}`) && /smtp_host/.test(e.message));
});
