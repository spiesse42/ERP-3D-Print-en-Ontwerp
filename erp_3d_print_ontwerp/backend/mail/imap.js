// ═══════════════════════════════════════════════════════════════════════
// MAILBOX via IMAP (30-09) — tegel "Mail"
// ═══════════════════════════════════════════════════════════════════════
// De mailbox zelf (OVH Zimbra, of een andere IMAP-server) blijft de bron:
// het ERP bewaart GEEN mails in de databank, het leest en bewerkt ze live
// (mappen, lezen, vlaggen, verplaatsen, verwijderen, mappen beheren) en zet
// wat het verstuurt in de map "Verzonden". Zo blijft de webmail gewoon werken.
// Instellingen (add-on-configuratie, nooit in de databank):
//   IMAP_HOST (standaard = SMTP_HOST; OVH: ssl0.ovh.net), IMAP_PORT (993),
//   IMAP_USER / IMAP_PASS (standaard = SMTP_USER / SMTP_PASS).
// Eén gedeelde verbinding; opdrachten na elkaar (wachtrij), bij een
// verbroken verbinding wordt er opnieuw verbonden.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { DomeinFout } from '../domein/hulp.js';

export class ImapFout extends Error {}

export function imapInstellingen() {
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  const smtpHost = String(process.env.SMTP_HOST || '').trim();
  const host = String(process.env.IMAP_HOST || '').trim() || smtpHost || (user && /@gmail\.com$/i.test(user) ? 'imap.gmail.com' : '');
  const port = Number(process.env.IMAP_PORT) || 993;
  return { host, port, secure: port === 993, auth: { user, pass } };
}
let maker = cfg => new ImapFlow({ ...cfg, logger: false, emitLogs: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 5 * 60000 });
// tests: een nagebootste client (zelfde methodes als ImapFlow)
export function zetImapMaker(fn) { maker = fn; sluitImap(); }
export function imapIngesteld() {
  const c = imapInstellingen();
  return !!(process.env.IMAP_NEP || (c.host && c.auth.user && c.auth.pass));
}
export const eigenAdres = () => String(process.env.IMAP_USER || process.env.SMTP_FROM || process.env.SMTP_USER || '').replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();

let client = null;
let wachtrij = Promise.resolve();
export function sluitImap() {
  const c = client; client = null;
  if (c) { try { c.logout().catch(() => {}); } catch { /* al dicht */ } }
}
function vertaal(e) {
  if (e instanceof DomeinFout || e instanceof ImapFout) return e;
  const t = `${e?.responseText || ''} ${e?.message || ''}`;
  const h = imapInstellingen().host;
  if (e?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(t)) return new ImapFout(`${h} weigert de aanmelding. Controleer het e-mailadres en het wachtwoord (smtp_user/smtp_pass of imap_user/imap_pass in de add-on-configuratie).`);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET|timeout|Connection not available/i.test(t) || e?.code === 'NoConnection') return new ImapFout(`Geen verbinding met de mailserver ${h}:${imapInstellingen().port}. Klopt imap_host (OVH: ssl0.ovh.net, poort 993)?`);
  if (/NONEXISTENT|doesn't exist|not exist|no such/i.test(t)) return new ImapFout('Die map bestaat niet (meer).');
  return new ImapFout(`De mailserver gaf een fout: ${String(e?.responseText || e?.message || e).slice(0, 200)}`);
}
async function verbind() {
  if (client?.usable) return client;
  if (!imapIngesteld()) throw new ImapFout('De mailbox is nog niet ingesteld: vul smtp_user/smtp_pass (en imap_host, OVH: ssl0.ovh.net) in bij de add-on-configuratie.');
  sluitImap();
  const c = maker(imapInstellingen());
  c.on?.('error', () => { if (client === c) client = null; });
  c.on?.('close', () => { if (client === c) client = null; });
  await c.connect();
  client = c;
  return c;
}
// Eén opdracht tegelijk op de gedeelde verbinding; één nieuwe poging als de
// verbinding intussen weggevallen was.
export function metImap(fn) {
  const taak = wachtrij.then(async () => {
    for (let poging = 0; ; poging++) {
      try { return await fn(await verbind()); }
      catch (e) {
        const verbroken = !client?.usable || /Connection not available|ECONNRESET|closed/i.test(String(e?.message));
        if (verbroken) sluitImap();
        if (poging === 0 && verbroken && !(e instanceof DomeinFout)) continue;
        throw vertaal(e);
      }
    }
  });
  wachtrij = taak.catch(() => {});
  return taak;
}
async function inMap(c, pad, fn, { lezen = false } = {}) {
  const lock = await c.getMailboxLock(pad, { readOnly: lezen });
  try { return await fn(); } finally { lock.release(); }
}

// ── mappen ──────────────────────────────────────────────────────────────
const SPECIAAL = { '\\Inbox': 'inbox', '\\Sent': 'verzonden', '\\Drafts': 'concepten', '\\Trash': 'prullenbak', '\\Junk': 'spam', '\\Archive': 'archief' };
const VOLGORDE = ['inbox', 'concepten', 'verzonden', 'archief', 'spam', 'prullenbak'];
export function mappen() {
  return metImap(async c => {
    const lijst = await c.list({ statusQuery: { messages: true, unseen: true } });
    const plat = lijst
      .map(m => ({ pad: m.path, naam: m.name, scheiding: m.delimiter || '/', ouder: m.parentPath || null,
        soort: m.path.toUpperCase() === 'INBOX' ? 'inbox' : SPECIAAL[m.specialUse] || null,
        selecteerbaar: !m.flags?.has?.('\\Noselect'), berichten: m.status?.messages ?? null, ongelezen: m.status?.unseen ?? null }));
    // als boom: speciale mappen eerst, dan de rest alfabetisch; submappen meteen onder hun map
    const rang = m => (VOLGORDE.indexOf(m.soort) + 1 || 99);
    const kinderen = ouder => plat.filter(m => (m.ouder || null) === ouder && m.pad !== ouder)
      .sort((a, b) => rang(a) - rang(b) || a.naam.localeCompare(b.naam, 'nl'));
    const uit = [], gezien = new Set();
    const loop = m => { if (gezien.has(m.pad)) return; gezien.add(m.pad); uit.push(m); kinderen(m.pad).forEach(loop); };
    kinderen(null).forEach(loop);
    plat.filter(m => !gezien.has(m.pad)).forEach(m => uit.push(m));   // ouder onbekend
    return uit;
  });
}
async function mapVanSoort(c, soort) {
  const l = await c.list();
  const m = l.find(x => SPECIAAL[x.specialUse] === soort)
    || l.find(x => ({ verzonden: /^(inbox[./])?(sent( items| messages)?|verzonden( items)?|envoy[ée]s)$/i, prullenbak: /^(inbox[./])?(trash|deleted( items| messages)?|prullenbak|corbeille)$/i, concepten: /^(inbox[./])?(drafts|concepten|brouillons)$/i }[soort]?.test(x.path)));
  return m?.path || null;
}
const geldigePad = p => { const t = String(p ?? '').trim(); if (!t || t.length > 300) throw new DomeinFout('Kies een map'); return t; };
export function mapMaken(pad) { return metImap(c => c.mailboxCreate(geldigePad(pad))); }
export function mapHernoemen(van, naar) { return metImap(c => c.mailboxRename(geldigePad(van), geldigePad(naar))); }
export function mapVerwijderen(pad) {
  const p = geldigePad(pad);
  if (p.toUpperCase() === 'INBOX') throw new DomeinFout('De inbox kan niet verwijderd worden.');
  return metImap(c => c.mailboxDelete(p));
}

// ── berichten ───────────────────────────────────────────────────────────
const adres = a => (a ? { naam: a.name || null, adres: String(a.address || '').toLowerCase() || null } : null);
function heeftBijlagen(s) {
  if (!s) return false;
  if (s.disposition === 'attachment' || (s.dispositionParameters?.filename && s.disposition !== 'inline')) return true;
  return (s.childNodes || []).some(heeftBijlagen);
}
function rij(m) {
  const f = m.flags || new Set();
  return { uid: m.uid, onderwerp: m.envelope?.subject || '(geen onderwerp)', datum: (m.envelope?.date || m.internalDate)?.toISOString?.() ?? null,
    van: adres(m.envelope?.from?.[0]), aan: (m.envelope?.to || []).map(adres),
    gelezen: f.has('\\Seen'), ster: f.has('\\Flagged'), beantwoord: f.has('\\Answered'), concept: f.has('\\Draft'),
    bijlagen: heeftBijlagen(m.bodyStructure), grootte: m.size ?? null };
}
const nieuwsteEerst = (a, b) => String(b.datum || '').localeCompare(String(a.datum || '')) || b.uid - a.uid;
const OPHALEN = { uid: true, envelope: true, flags: true, bodyStructure: true, size: true, internalDate: true };
// Nieuwste eerst, per pagina van 50. zoek: onderwerp, afzender, ontvanger of tekst.
export function berichten(pad, { pagina = 0, aantal = 50, zoek = '', ongelezen = false } = {}) {
  const map = geldigePad(pad);
  return metImap(c => inMap(c, map, async () => {
    const totaalMap = c.mailbox.exists || 0;
    const q = String(zoek || '').trim();
    let uids;
    if (q || ongelezen) {
      const crit = { ...(q ? { or: [{ subject: q }, { from: q }, { to: q }, { body: q }] } : {}), ...(ongelezen ? { seen: false } : {}) };
      uids = ((await c.search(crit, { uid: true })) || []).sort((a, b) => b - a);
    } else {
      if (!totaalMap) return { map, totaal: 0, pagina, berichten: [] };
      const hoog = totaalMap - pagina * aantal, laag = Math.max(1, hoog - aantal + 1);
      if (hoog < 1) return { map, totaal: totaalMap, pagina, berichten: [] };
      const lijst = [];
      for await (const m of c.fetch(`${laag}:${hoog}`, OPHALEN)) lijst.push(rij(m));
      return { map, totaal: totaalMap, pagina, berichten: lijst.sort(nieuwsteEerst) };
    }
    const deel = uids.slice(pagina * aantal, (pagina + 1) * aantal);
    const lijst = [];
    if (deel.length) for await (const m of c.fetch(deel.join(','), OPHALEN, { uid: true })) lijst.push(rij(m));
    return { map, totaal: uids.length, pagina, zoek: q, berichten: lijst.sort(nieuwsteEerst) };
  }, { lezen: true }));
}
const geldigeUid = u => { const n = Number(u); if (!Number.isInteger(n) || n <= 0) throw new DomeinFout('Onbekend bericht'); return n; };
const uidLijst = l => { const a = (Array.isArray(l) ? l : [l]).map(geldigeUid); if (!a.length) throw new DomeinFout('Kies minstens één bericht'); return a.join(','); };

// Het volledige bericht (bron), ontleed. markeer: als gelezen zetten.
export function bronVan(pad, uid, { markeer = false } = {}) {
  const map = geldigePad(pad), u = geldigeUid(uid);
  return metImap(c => inMap(c, map, async () => {
    const m = await c.fetchOne(String(u), { uid: true, source: true, flags: true }, { uid: true });
    if (!m?.source) throw new DomeinFout('Dit bericht bestaat niet (meer) in deze map.');
    if (markeer && !m.flags?.has('\\Seen')) await c.messageFlagsAdd(String(u), ['\\Seen'], { uid: true });
    return { source: m.source, flags: m.flags || new Set() };
  }));
}
export async function ontleed(pad, uid, opties) {
  const { source, flags } = await bronVan(pad, uid, opties);
  return { mail: await simpleParser(source, { skipTextToHtml: true }), source, flags };
}
export function vlaggen(pad, uids, { gelezen, ster, beantwoord } = {}) {
  const map = geldigePad(pad), lijst = uidLijst(uids);
  return metImap(c => inMap(c, map, async () => {
    const zet = async (aan, vlag) => {
      if (aan === true) await c.messageFlagsAdd(lijst, [vlag], { uid: true });
      if (aan === false) await c.messageFlagsRemove(lijst, [vlag], { uid: true });
    };
    await zet(gelezen, '\\Seen'); await zet(ster, '\\Flagged'); await zet(beantwoord, '\\Answered');
  }));
}
export function verplaats(pad, uids, doel) {
  const map = geldigePad(pad), naar = geldigePad(doel), lijst = uidLijst(uids);
  if (map === naar) throw new DomeinFout('Het bericht staat al in die map.');
  return metImap(c => inMap(c, map, () => c.messageMove(lijst, naar, { uid: true })));
}
// Verwijderen = naar de prullenbak; in de prullenbak (of zonder prullenbak) = definitief.
export function verwijder(pad, uids) {
  const map = geldigePad(pad), lijst = uidLijst(uids);
  return metImap(async c => {
    const prul = await mapVanSoort(c, 'prullenbak');
    return inMap(c, map, async () => {
      if (prul && prul !== map) { await c.messageMove(lijst, prul, { uid: true }); return { naar: prul }; }
      await c.messageDelete(lijst, { uid: true });
      return { definitief: true };
    });
  });
}
// Een verstuurd bericht in "Verzonden" (of een concept in "Concepten") zetten.
export function bewaarIn(soort, raw, vlaggenLijst = ['\\Seen']) {
  return metImap(async c => {
    const pad = await mapVanSoort(c, soort) || (soort === 'verzonden' ? 'Sent' : soort === 'concepten' ? 'Drafts' : null);
    if (!pad) return null;
    try { await c.append(pad, raw, vlaggenLijst); } catch (e) {
      if (!/NONEXISTENT|TRYCREATE|not exist/i.test(`${e?.responseText || ''} ${e?.message || ''}`)) throw e;
      await c.mailboxCreate(pad); await c.append(pad, raw, vlaggenLijst);
    }
    return pad;
  });
}
// Mails van of aan een adres (klantfiche): inbox + verzonden, nieuwste eerst.
export function vanOfAan(emailadres, { max = 30 } = {}) {
  const a = String(emailadres || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) throw new DomeinFout('Geen geldig e-mailadres');
  return metImap(async c => {
    const uit = [];
    for (const pad of ['INBOX', await mapVanSoort(c, 'verzonden')].filter(Boolean)) {
      await inMap(c, pad, async () => {
        const uids = ((await c.search({ or: [{ from: a }, { to: a }, { cc: a }] }, { uid: true })) || []).sort((x, y) => y - x).slice(0, max);
        if (uids.length) for await (const m of c.fetch(uids.join(','), OPHALEN, { uid: true })) uit.push({ ...rij(m), map: pad });
      }, { lezen: true });
    }
    return uit.sort((x, y) => String(y.datum).localeCompare(String(x.datum))).slice(0, max);
  });
}
export function aantalOngelezen() {
  return metImap(async c => (await c.status('INBOX', { unseen: true })).unseen ?? 0);
}
