// ═══════════════════════════════════════════════════════════════════════
// KLANT OPZOEKEN OP BTW-NUMMER (29-09): naam/adres + Peppol-ID
// ═══════════════════════════════════════════════════════════════════════
// Drie openbare bronnen, geen account of sleutel nodig:
// 1. VIES (Europese Commissie): is het btw-nummer geldig, en naam + adres
//    (niet elk land geeft die vrij: Nederland en Duitsland bv. niet).
// 2. Peppol SML (DNS van de Europese Commissie): is een Peppol-ID écht
//    geregistreerd? We proberen de ID's die uit het btw-nummer volgen:
//    België 0208:<ondernemingsnummer> en voor elk land het btw-schema
//    (9925:BE…, 9944:NL…, 9930:DE…, …). NAPTR-record (nieuw, SHA-256) of
//    CNAME (oud, MD5).
// 3. Peppol Directory: zoekt op naam/nummer, voor wie met een ander nummer
//    geregistreerd is (bv. Nederlandse bedrijven met hun KvK-nummer, 0106:…).
//    Dat zijn voorstellen: niet elk bedrijf staat in de Directory.
import crypto from 'crypto';
import { promises as dnsStandaard } from 'dns';
import { DomeinFout } from './hulp.js';

// Peppol-schema's (ISO 6523 ICD / EAS) voor een btw-nummer per land.
export const BTW_SCHEMA = {
  AD: '9922', AL: '9923', AT: '9914', BA: '9924', BE: '9925', BG: '9926', CH: '9927', CY: '9928', CZ: '9929', DE: '9930',
  EE: '9931', GB: '9932', GR: '9933', EL: '9933', HR: '9934', IE: '9935', LI: '9936', LT: '9937', LU: '9938', LV: '9939',
  MC: '9940', ME: '9941', MK: '9942', MT: '9943', NL: '9944', PL: '9945', PT: '9946', RO: '9947', RS: '9948', SI: '9949',
  SK: '9950', SM: '9951', TR: '9952', VA: '9953', FR: '9957', HU: '9910', IT: '0211', ES: '9920',
};
const SML_ZONE = 'edelivery.tech.ec.europa.eu';

// "be 0543.857.422" → { land: 'BE', nummer: '0543857422', btw: 'BE0543857422' }
export function leesBtw(invoer, standaardLand = 'BE') {
  const t = String(invoer ?? '').replace(/[\s.\-/]/g, '').toUpperCase();
  if (!t) throw new DomeinFout('Vul een btw-nummer in (bv. BE0123456789 of NL123456789B01)');
  const m = t.match(/^([A-Z]{2})([0-9A-Z]{2,14})$/);
  let land = m ? m[1] : String(standaardLand || 'BE').toUpperCase();
  let nummer = m ? m[2] : t;
  if (land === 'EL') land = 'GR';
  // Belgisch ondernemingsnummer: 10 cijfers (een oud nummer van 9 cijfers krijgt een 0 vooraan)
  if (land === 'BE' && /^\d{9}$/.test(nummer)) nummer = `0${nummer}`;
  if (!/^[0-9A-Z]{2,14}$/.test(nummer)) throw new DomeinFout('Dit btw-nummer lijkt niet geldig');
  if (land === 'BE' && !/^[01]\d{9}$/.test(nummer)) throw new DomeinFout('Een Belgisch btw-nummer heeft 10 cijfers (BE0123456789)');
  return { land, nummer, btw: `${land}${nummer}` };
}

// De Peppol-ID's die uit een btw-nummer volgen (meest waarschijnlijke eerst).
export function kandidaten({ land, nummer }) {
  const uit = [];
  if (land === 'BE') uit.push(`0208:${nummer}`);
  const s = BTW_SCHEMA[land];
  if (s) uit.push(s === '0211' ? `0211:IT${nummer}` : `${s}:${land === 'GR' ? 'EL' : land}${nummer}`);
  return uit;
}

// DNS-namen in de SML voor een Peppol-ID (nieuw + oud algoritme).
function base32(buf) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, waarde = 0, uit = '';
  for (const b of buf) {
    waarde = (waarde << 8) | b; bits += 8;
    while (bits >= 5) { uit += a[(waarde >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) uit += a[(waarde << (5 - bits)) & 31];
  return uit;
}
export function smlNamen(id) {
  const w = String(id).toLowerCase();
  return {
    naptr: `${base32(crypto.createHash('sha256').update(w).digest())}.iso6523-actorid-upis.${SML_ZONE}`,
    cname: `B-${crypto.createHash('md5').update(w).digest('hex')}.iso6523-actorid-upis.${SML_ZONE}`,
  };
}
export async function isGeregistreerd(id, dns = dnsStandaard) {
  const n = smlNamen(id);
  const bestaat = p => p.then(r => (Array.isArray(r) ? r.length > 0 : !!r), e => {
    if (['ENOTFOUND', 'ENODATA', 'ENONAME'].includes(e?.code)) return false;
    throw e;
  });
  if (await bestaat(dns.resolveNaptr(n.naptr))) return true;
  return bestaat(dns.resolveCname(n.cname));
}

async function json(fetchFn, url) {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// VIES-adres "Straat 14\n8700 Aarsele" → velden (enkel als het duidelijk is).
export function splitsAdres(adres) {
  const lijnen = String(adres || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
  if (!lijnen.length) return {};
  const uit = {};
  const pc = lijnen.at(-1).match(/^(\d{4}(?:\s?[A-Z]{2})?|\d{5})\s+(.+)$/i);
  if (pc) { uit.postcode = pc[1]; uit.gemeente = pc[2].replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase()); }
  const str = lijnen[0] !== lijnen.at(-1) || !pc ? lijnen[0] : null;
  if (str) {
    const m = str.match(/^(.*?)\s+(\d+\s?[A-Za-z]?(?:[\s/-]?(?:bus\s)?\w+)?)$/);
    if (m) { uit.straat = m[1]; uit.huisnummer = m[2]; } else uit.straat = str;
  }
  return uit;
}
const netjes = t => {
  const s = String(t ?? '').trim();
  return !s || s === '---' ? null : s;
};

export async function zoekKlant(btwInvoer, { land: standaardLand, fetchFn = fetch, dns = dnsStandaard } = {}) {
  const b = leesBtw(btwInvoer, standaardLand);
  const uit = { btw: b.btw, land: b.land, vies: null, peppol: null, suggesties: [], fouten: [] };
  const [vies, reg, dir] = await Promise.allSettled([
    json(fetchFn, `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${b.land === 'GR' ? 'EL' : b.land}/vat/${encodeURIComponent(b.nummer)}`),
    Promise.all(kandidaten(b).map(async id => ({ id, ok: await isGeregistreerd(id, dns) }))),
    json(fetchFn, `https://directory.peppol.eu/search/1.0/json?q=${encodeURIComponent(b.nummer)}&rpc=20`),
  ]);
  if (vies.status === 'fulfilled') {
    const v = vies.value;
    const geldig = v.isValid ?? v.valid;
    uit.vies = { geldig: geldig === true, naam: netjes(v.name), adres: netjes(v.address), ...splitsAdres(netjes(v.address)) };
  } else uit.fouten.push(`VIES (btw-nummer controleren) niet bereikbaar: ${vies.reason?.message || vies.reason}`);
  if (reg.status === 'fulfilled') {
    const ok = reg.value.find(x => x.ok);
    uit.peppol = ok ? { id: ok.id, bevestigd: true } : null;
    uit.gecontroleerd = reg.value.map(x => x.id);
  } else uit.fouten.push(`Peppol-register niet bereikbaar: ${reg.reason?.message || reg.reason}`);
  let matches = dir.status === 'fulfilled' ? dir.value?.matches || [] : [];
  if (dir.status !== 'fulfilled') uit.fouten.push(`Peppol Directory niet bereikbaar: ${dir.reason?.message || dir.reason}`);
  // niets op het nummer? zoek op de naam uit VIES, in hetzelfde land
  if (!uit.peppol && !matches.length && uit.vies?.naam) {
    try {
      matches = (await json(fetchFn, `https://directory.peppol.eu/search/1.0/json?name=${encodeURIComponent(uit.vies.naam)}&country=${b.land}&rpc=20`))?.matches || [];
    } catch { /* enkel voorstellen */ }
  }
  uit.suggesties = matches.map(m => {
    const e = m.entities?.[0] || {};
    const pid = String(m.participantID?.value || '');
    return { id: pid, naam: e.name?.[0]?.name || null, land: e.countryCode || null };
  }).filter(x => x.id && x.id !== uit.peppol?.id).slice(0, 10);
  return uit;
}
