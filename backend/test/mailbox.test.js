// 30-09: tegel Mail (mailbox) — mailbox via IMAP (hier een nagebootste mailserver met
// dezelfde methodes als ImapFlow), versturen via SMTP (MAIL_NEP), koppelingen
// met het ERP.
process.env.MAIL_NEP = '1';
process.env.IMAP_NEP = '1';
process.env.SMTP_USER = 'info@3dprintenontwerp.be';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser } from 'mailparser';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { maakApp } from '../app.js';
import { nepPostvak } from '../documenten/mail.js';
import { zetImapMaker, sluitImap } from '../mail/imap.js';
import { veiligeHtml } from '../mail/weergave.js';
import { stopWachter } from '../productie/wachter.js';

// ── nagebootste IMAP-server ──────────────────────────────────────────────
const doos = {
  INBOX: { specialUse: '\\Inbox', berichten: [], volgende: 1 },
  Sent: { specialUse: '\\Sent', berichten: [], volgende: 1 },
  Drafts: { specialUse: '\\Drafts', berichten: [], volgende: 1 },
  Trash: { specialUse: '\\Trash', berichten: [], volgende: 1 },
  'INBOX/Leveranciers': { berichten: [], volgende: 1 },
};
async function leg(pad, raw, vlaggen = []) {
  const m = await simpleParser(raw);
  const map = doos[pad];
  const uid = map.volgende++;
  map.berichten.push({ uid, source: Buffer.from(raw), flags: new Set(vlaggen), internalDate: m.date || new Date(), size: raw.length,
    envelope: { subject: m.subject, date: m.date, from: m.from?.value || [], to: m.to?.value || [] },
    bodyStructure: { childNodes: (m.attachments || []).filter(a => a.contentDisposition !== 'inline').map(a => ({ disposition: 'attachment', dispositionParameters: { filename: a.filename } })) },
    tekst: `${m.subject} ${m.text} ${m.from?.text} ${m.to?.text}`.toLowerCase(), van: m.from?.text?.toLowerCase() || '', aan: `${m.to?.text || ''} ${m.cc?.text || ''}`.toLowerCase() });
  return uid;
}
const bouw = o => new MailComposer(o).compile().build();
class NepImap {
  constructor() { this.usable = false; this.mailbox = null; }
  on() {}
  async connect() { this.usable = true; }
  async logout() { this.usable = false; }
  async list(o = {}) {
    return Object.entries(doos).map(([p, m]) => ({ path: p, name: p.split('/').at(-1), delimiter: '/', parentPath: p.includes('/') ? p.split('/').slice(0, -1).join('/') : null,
      specialUse: m.specialUse, flags: new Set(), ...(o.statusQuery ? { status: { messages: m.berichten.length, unseen: m.berichten.filter(b => !b.flags.has('\\Seen')).length } } : {}) }));
  }
  async status(p) { return { unseen: doos[p].berichten.filter(b => !b.flags.has('\\Seen')).length }; }
  async getMailboxLock(p) {
    if (!doos[p]) throw Object.assign(new Error('Mailbox doesn\'t exist'), { responseText: 'NONEXISTENT' });
    this.pad = p; this.mailbox = { path: p, exists: doos[p].berichten.length };
    return { release() {} };
  }
  kies(reeks, opts) {
    const lijst = doos[this.pad].berichten;
    if (opts?.uid) { const set = new Set(String(reeks).split(',').map(Number)); return lijst.filter(b => set.has(b.uid)); }
    const [a, b] = String(reeks).split(':').map(Number);
    return lijst.slice(a - 1, (b || a));
  }
  async* fetch(reeks, q, opts) { for (const b of this.kies(reeks, opts)) yield { ...b }; }
  async fetchOne(reeks, q, opts) { return this.kies(reeks, opts)[0] || false; }
  async search(c) {
    return doos[this.pad].berichten.filter(b => {
      if (c.seen === false && b.flags.has('\\Seen')) return false;
      if (c.or) return c.or.some(x => (x.subject && b.tekst.includes(x.subject.toLowerCase())) || (x.body && b.tekst.includes(x.body.toLowerCase()))
        || (x.from && b.van.includes(x.from.toLowerCase())) || (x.to && b.aan.includes(x.to.toLowerCase())) || (x.cc && b.aan.includes(x.cc.toLowerCase())));
      return true;
    }).map(b => b.uid);
  }
  async messageFlagsAdd(r, f, o) { for (const b of this.kies(r, o)) f.forEach(x => b.flags.add(x)); }
  async messageFlagsRemove(r, f, o) { for (const b of this.kies(r, o)) f.forEach(x => b.flags.delete(x)); }
  async messageMove(r, doel, o) {
    if (!doos[doel]) throw Object.assign(new Error('no such mailbox'), { responseText: 'NONEXISTENT' });
    for (const b of this.kies(r, o)) { doos[this.pad].berichten = doos[this.pad].berichten.filter(x => x !== b); doos[doel].berichten.push({ ...b, uid: doos[doel].volgende++ }); }
  }
  async messageDelete(r, o) { const weg = new Set(this.kies(r, o)); doos[this.pad].berichten = doos[this.pad].berichten.filter(x => !weg.has(x)); }
  async append(p, raw, f) { if (!doos[p]) throw Object.assign(new Error('x'), { responseText: 'TRYCREATE' }); await leg(p, raw, f); }
  async mailboxCreate(p) { doos[p] ||= { berichten: [], volgende: 1 }; }
  async mailboxRename(a, b) { doos[b] = doos[a]; delete doos[a]; }
  async mailboxDelete(p) { delete doos[p]; }
}

let server, basis;
before(async () => {
  initDb(':memory:');
  zetImapMaker(() => new NepImap());
  server = maakApp().listen(0);
  await new Promise(r => server.once('listening', r));
  basis = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); stopWachter(); sluitImap(); sluitDb(); });
async function vraag(methode, pad, body) {
  const fd = body instanceof FormData;
  const res = await fetch(basis + pad, { method: methode, headers: body !== undefined && !fd ? { 'Content-Type': 'application/json' } : undefined, body: body === undefined ? undefined : fd ? body : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, data: await res.json() };
}
const ok = (r, s = 200) => { assert.equal(r.status, s, JSON.stringify(r.data)); return r.data; };
const fout = (r, patroon) => { assert.ok(r.status >= 400, JSON.stringify(r.data)); assert.match(r.data.error, patroon); };
let klant, dossier, vraagUid, fotoIndex;

test('M0. voorbereiding: klant met dossier, mails in de inbox', async () => {
  klant = ok(await vraag('POST', '/klanten', { type: 'particulier', voornaam: 'Els', naam: 'Mertens', email: 'els@voorbeeld.be' }), 201).id;
  dossier = ok(await vraag('POST', '/dossiers', { titel: 'Lithofaan', klant_id: klant, regels: [{ type: 'extra', bedrag: 20 }] }), 201).id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  vraagUid = await leg('INBOX', await bouw({ from: 'Els Mertens <els@voorbeeld.be>', to: 'info@3dprintenontwerp.be', subject: 'Vraag lithofaan', messageId: '<vraag-1@voorbeeld.be>',
    date: new Date('2026-09-28T10:00:00Z'), text: 'Hallo, kan je een lithofaan maken van deze foto?',
    html: '<p onclick="alert(1)">Hallo, <b>kan</b> je een lithofaan maken?</p><script>alert(1)</script><img src="https://tracker.voorbeeld/pixel.gif"><img src="cid:logo@els"><a href="javascript:alert(1)">klik</a><form><input></form>',
    attachments: [{ filename: 'foto.jpg', content: Buffer.from('JPEGDATA'), contentType: 'image/jpeg' }, { filename: 'logo.png', content: png, contentType: 'image/png', cid: 'logo@els' }] }));
  for (let i = 0; i < 3; i++) await leg('INBOX', await bouw({ from: 'nieuwsbrief@winkel.be', to: 'info@3dprintenontwerp.be', subject: `Aanbieding ${i}`, text: 'Korting', date: new Date(`2026-09-2${i}T08:00:00Z`) }), i === 0 ? ['\\Seen'] : []);
});

test('M1. status en mappen: speciale mappen herkend, ongelezen per map', async () => {
  const s = ok(await vraag('GET', '/mail/status?ongelezen=1'));
  assert.equal(s.ingesteld, true); assert.equal(s.adres, 'info@3dprintenontwerp.be'); assert.equal(s.ongelezen, 3);
  const m = ok(await vraag('GET', '/mail/mappen'));
  assert.deepEqual(m.map(x => [x.pad, x.soort]), [['INBOX', 'inbox'], ['INBOX/Leveranciers', null], ['Drafts', 'concepten'], ['Sent', 'verzonden'], ['Trash', 'prullenbak']], 'boom: submap onder de inbox');
  assert.equal(m.find(x => x.pad === 'INBOX').ongelezen, 3);
  assert.equal(m.find(x => x.pad === 'INBOX/Leveranciers').ouder, 'INBOX');
});

test('M2. lijst: nieuwste eerst, per pagina, zoeken en enkel ongelezen', async () => {
  const l = ok(await vraag('GET', '/mail/berichten?map=INBOX'));
  assert.equal(l.totaal, 4);
  assert.deepEqual(l.berichten.map(b => b.onderwerp), ['Vraag lithofaan', 'Aanbieding 2', 'Aanbieding 1', 'Aanbieding 0'], 'nieuwste eerst (datum)');
  const v = l.berichten.find(b => b.uid === vraagUid);
  assert.equal(v.van.adres, 'els@voorbeeld.be'); assert.equal(v.bijlagen, true); assert.equal(v.gelezen, false);
  assert.equal(ok(await vraag('GET', '/mail/berichten?map=INBOX&zoek=lithofaan')).berichten.length, 1);
  assert.equal(ok(await vraag('GET', '/mail/berichten?map=INBOX&ongelezen=1')).totaal, 3);
  fout(await vraag('GET', '/mail/berichten?map=Bestaatniet'), /bestaat niet/);
});

test('M3. lezen: veilige HTML (geen script/handlers/formulier/javascript:), externe afbeelding geblokkeerd, ingesloten afbeelding getoond; klant en dossier herkend', async () => {
  const b = ok(await vraag('GET', `/mail/bericht?map=INBOX&uid=${vraagUid}`));
  assert.equal(b.onderwerp, 'Vraag lithofaan');
  assert.ok(!/script|onclick|javascript:|<form|<input/i.test(b.html), b.html);
  assert.ok(b.html.includes('data-src="https://tracker.voorbeeld/pixel.gif"')); assert.equal(b.geblokkeerd, 1);
  assert.ok(/src="data:image\/png;base64,/.test(b.html), 'cid → data-URI');
  assert.deepEqual(b.bijlagen.map(x => x.naam), ['foto.jpg'], 'ingesloten logo niet als bijlage');
  fotoIndex = b.bijlagen[0].index;
  assert.equal(b.erp.klanten[0].id, klant); assert.equal(b.erp.klanten[0].dossiers[0].id, dossier);
  assert.match(b.citaat.kop, /schreef Els Mertens <els@voorbeeld\.be>/);
  // nu gelezen
  assert.equal(ok(await vraag('GET', '/mail/berichten?map=INBOX')).berichten.find(x => x.uid === vraagUid).gelezen, true);
  // met afbeeldingen
  assert.ok(ok(await vraag('GET', `/mail/bericht?map=INBOX&uid=${vraagUid}&afbeeldingen=1`)).html.includes('src="https://tracker.voorbeeld/pixel.gif"'));
  // bijlage + bron
  const a = await vraag('GET', `/mail/bijlage?map=INBOX&uid=${vraagUid}&index=${fotoIndex}`);
  assert.equal(a.buf.toString(), 'JPEGDATA'); assert.match(a.headers.get('content-disposition'), /inline; filename\*=UTF-8''foto\.jpg/);
  assert.match((await vraag('GET', `/mail/bron?map=INBOX&uid=${vraagUid}`)).buf.toString(), /Subject: Vraag lithofaan/);
});

test('M4. veiligheid: stijlen met url() en data-URI buiten img verdwijnen', () => {
  const { html } = veiligeHtml('<div style="color:red;background:url(https://x/y.png)">a</div><a href="data:text/html,x">b</a><iframe src="https://x"></iframe>');
  assert.ok(html.includes('color:red') && !html.includes('url(') && !html.includes('data:text') && !html.includes('iframe'), html);
});

test('M5. vlaggen, verplaatsen, verwijderen (prullenbak, dan definitief), mappen beheren', async () => {
  const nb = ok(await vraag('GET', '/mail/berichten?map=INBOX')).berichten.filter(x => /Aanbieding/.test(x.onderwerp)).map(x => x.uid);
  ok(await vraag('POST', '/mail/vlaggen', { map: 'INBOX', uids: nb, gelezen: true, ster: true }));
  assert.ok(ok(await vraag('GET', '/mail/berichten?map=INBOX')).berichten.filter(x => nb.includes(x.uid)).every(x => x.gelezen && x.ster));
  ok(await vraag('POST', '/mail/verplaats', { map: 'INBOX', uids: [nb[0]], doel: 'INBOX/Leveranciers' }));
  assert.equal(ok(await vraag('GET', '/mail/berichten?map=INBOX%2FLeveranciers')).totaal, 1);
  assert.deepEqual(ok(await vraag('POST', '/mail/verwijder', { map: 'INBOX', uids: [nb[1]] })), { naar: 'Trash' });
  const inPrul = ok(await vraag('GET', '/mail/berichten?map=Trash')).berichten[0].uid;
  assert.deepEqual(ok(await vraag('POST', '/mail/verwijder', { map: 'Trash', uids: [inPrul] })), { definitief: true });
  assert.equal(ok(await vraag('GET', '/mail/berichten?map=Trash')).totaal, 0);
  ok(await vraag('POST', '/mail/mappen', { pad: 'Klanten' }), 201);
  let m = ok(await vraag('PUT', '/mail/mappen', { van: 'Klanten', naar: 'Klantvragen' }));
  assert.ok(m.some(x => x.pad === 'Klantvragen'));
  m = ok(await vraag('DELETE', '/mail/mappen?pad=Klantvragen'));
  assert.ok(!m.some(x => x.pad === 'Klantvragen'));
  fout(await vraag('DELETE', '/mail/mappen?pad=INBOX'), /inbox kan niet/);
});

test('M6. beantwoorden: zelfde gesprek (In-Reply-To), origineel "beantwoord", kopie in Verzonden, historiek bij het dossier', async () => {
  const fd = new FormData();
  Object.entries({ aan: 'els@voorbeeld.be', onderwerp: 'Re: Vraag lithofaan', tekst: 'Dag Els, dat kan!', soort: 'antwoord', antwoord_map: 'INBOX', antwoord_uid: String(vraagUid),
    entiteit: 'dossier', entiteit_id: String(dossier) }).forEach(([k, v]) => fd.append(k, v));
  fd.append('bestanden', new Blob(['%PDF-1.4 voorbeeld'], { type: 'application/pdf' }), 'prijs.pdf');
  ok(await vraag('POST', '/mail/versturen', fd));
  const m = nepPostvak().at(-1);
  assert.equal(m.to, 'els@voorbeeld.be'); assert.equal(m.inReplyTo, '<vraag-1@voorbeeld.be>');
  assert.equal(m.attachments[0].filename, 'prijs.pdf');
  assert.ok(ok(await vraag('GET', '/mail/berichten?map=INBOX')).berichten.find(x => x.uid === vraagUid).beantwoord);
  const sent = ok(await vraag('GET', '/mail/berichten?map=Sent')).berichten;
  assert.equal(sent[0].onderwerp, 'Re: Vraag lithofaan'); assert.equal(sent[0].gelezen, true);
  assert.ok(ok(await vraag('GET', `/historiek/dossier/${dossier}`)).some(h => /Mail verstuurd naar els@voorbeeld\.be: Re: Vraag lithofaan/.test(h.tekst)));
  // ongeldig adres
  const f2 = new FormData(); f2.append('aan', 'geen-adres'); f2.append('onderwerp', 'x');
  fout(await vraag('POST', '/mail/versturen', f2), /Ongeldig e-mailadres/);
});

test('M7. doorsturen met de bijlage van het origineel; concept in Concepten', async () => {
  const fd = new FormData();
  Object.entries({ aan: 'collega@voorbeeld.be, tweede@voorbeeld.be', onderwerp: 'Fwd: Vraag lithofaan', tekst: 'Ter info', soort: 'doorsturen', antwoord_map: 'INBOX', antwoord_uid: String(vraagUid),
    doorsturen_bijlagen: JSON.stringify([fotoIndex]) }).forEach(([k, v]) => fd.append(k, v));
  ok(await vraag('POST', '/mail/versturen', fd));
  const m = nepPostvak().at(-1);
  assert.equal(m.to, 'collega@voorbeeld.be, tweede@voorbeeld.be'); assert.equal(m.inReplyTo, undefined);
  assert.equal(m.attachments[0].filename, 'foto.jpg'); assert.equal(m.attachments[0].content.toString(), 'JPEGDATA');
  const c = new FormData(); c.append('aan', 'els@voorbeeld.be'); c.append('onderwerp', 'Half klaar'); c.append('tekst', '...');
  assert.equal(ok(await vraag('POST', '/mail/concept', c)).map, 'Drafts');
  const d = ok(await vraag('GET', '/mail/berichten?map=Drafts')).berichten[0];
  assert.equal(d.onderwerp, 'Half klaar'); assert.equal(d.concept, true);
});

test('M8. bewaren bij het dossier: bijlage + de mail als .eml, historiek; mails van een klant; ERP-documenten ook in Verzonden', async () => {
  const r = ok(await vraag('POST', '/mail/bewaar', { map: 'INBOX', uid: vraagUid, entiteit: 'dossier', entiteit_id: dossier, indexen: [fotoIndex], mail: true }), 201);
  assert.deepEqual(r.bewaard, ['foto.jpg', 'Vraag lithofaan.eml']);
  const bij = ok(await vraag('GET', `/bijlagen/dossier/${dossier}`));
  assert.deepEqual(bij.map(b => [b.bestandsnaam, b.mimetype]), [['foto.jpg', 'image/jpeg'], ['Vraag lithofaan.eml', 'message/rfc822']]);
  assert.ok(ok(await vraag('GET', `/historiek/dossier/${dossier}`)).some(h => /Uit de mail van els@voorbeeld\.be \("Vraag lithofaan"\) bewaard: foto\.jpg, Vraag lithofaan\.eml/.test(h.tekst)));
  fout(await vraag('POST', '/mail/bewaar', { map: 'INBOX', uid: vraagUid, entiteit: 'dossier', entiteit_id: dossier }), /Kies wat je wilt bewaren/);
  fout(await vraag('POST', '/mail/bewaar', { map: 'INBOX', uid: vraagUid, entiteit: 'dossier', entiteit_id: 999, mail: true }), /bestaat niet/);
  // klantfiche: mails van en aan de klant (inbox + verzonden)
  const lijst = ok(await vraag('GET', '/mail/adres?adres=els@voorbeeld.be'));
  assert.deepEqual(lijst.map(x => [x.map, x.onderwerp]).sort(), [['INBOX', 'Vraag lithofaan'], ['Sent', 'Re: Vraag lithofaan']]);
  // een offerte-mail van het ERP komt ook in Verzonden
  const { verstuurMail } = await import('../documenten/mail.js');
  await verstuurMail({ aan: 'els@voorbeeld.be', onderwerp: 'Offerte OFF-2026-001', tekst: 'In bijlage', bijlage: { naam: 'Offerte.pdf', inhoud: Buffer.from('%PDF') } });
  assert.ok(ok(await vraag('GET', '/mail/berichten?map=Sent')).berichten.some(x => x.onderwerp === 'Offerte OFF-2026-001'));
});

test('M9. mailserver onbereikbaar: duidelijke melding, geen crash', async () => {
  zetImapMaker(() => { const c = new NepImap(); c.connect = async () => { throw Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:993'), { code: 'ECONNREFUSED' }); }; return c; });
  fout(await vraag('GET', '/mail/mappen'), /Geen verbinding met de mailserver/);
  zetImapMaker(() => { const c = new NepImap(); c.connect = async () => { throw Object.assign(new Error('Authentication failed'), { authenticationFailed: true }); }; return c; });
  fout(await vraag('GET', '/mail/mappen'), /weigert de aanmelding/);
  zetImapMaker(() => new NepImap());
  assert.ok(ok(await vraag('GET', '/mail/mappen')).length > 0, 'daarna weer verbonden');
});
