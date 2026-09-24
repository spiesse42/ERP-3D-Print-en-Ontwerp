// ═══════════════════════════════════════════════════════════════════════
// HOME ASSISTANT — printers uitlezen en bedienen (stap 6a)
// ═══════════════════════════════════════════════════════════════════════
// Token en adres ENKEL via de add-on of omgevingsvariabelen, nooit in de
// databank (vaste afspraak):
// - in de add-on: SUPERVISOR_TOKEN (automatisch), adres http://supervisor/core
// - lokaal: HA_URL (bv. http://homeassistant.local:8123) + HA_TOKEN
//   (langdurig toegangstoken, aan te maken in je HA-profiel)
// HA_TOKEN heeft voorrang op SUPERVISOR_TOKEN (zoals het oude pakket).
// HA_NEP = pad naar een JSON-bestand { entity_id: toestand | {state, attributes} }
// voor tests zonder echte Home Assistant.
import fs from 'fs';

export function haConfig() {
  const token = process.env.HA_TOKEN || process.env.SUPERVISOR_TOKEN || '';
  const url = (process.env.HA_URL || (process.env.SUPERVISOR_TOKEN ? 'http://supervisor/core' : '')).replace(/\/$/, '');
  return { url, token, ingesteld: !!process.env.HA_NEP || !!(url && token) };
}
export const haIngesteld = () => haConfig().ingesteld;

export class HaFout extends Error {}

// "fetch failed" zegt niets: de echte oorzaak zit in e.cause (stap 6b).
export function oorzaak(e) {
  if (e?.name === 'TimeoutError') return 'geen antwoord binnen 10 s (zelfde netwerk? firewall? juiste poort?)';
  const c = e?.cause || {};
  const code = c.code || c.errno || '';
  const host = c.hostname || c.host || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `naam niet gevonden${host ? ` (${host})` : ''}; gebruik het IP-adres, bv. http://192.168.1.50:8123`;
  if (code === 'ECONNREFUSED') return `verbinding geweigerd${c.port ? ` op poort ${c.port}` : ''}; klopt de poort (meestal 8123)?`;
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'toestel onbereikbaar; klopt het IP-adres en zit je op hetzelfde netwerk?';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'geen antwoord (time-out); klopt het IP-adres?';
  if (/CERT|SSL|TLS/i.test(String(code)) || /certificate|ssl/i.test(String(c.message || ''))) return 'certificaatfout; gebruik het lokale http://-adres of het juiste https-adres';
  if (code === 'ECONNRESET') return 'verbinding onderbroken; http en https verwisseld?';
  return c.message || e?.message || 'onbekende fout';
}

// Testhaak (backend-tests): vervang de HTTP-aanroep door een functie.
let nepFetch = null;
export function vervangHa(fn) { nepFetch = fn; }

function nepStaten() {
  const ruw = JSON.parse(fs.readFileSync(process.env.HA_NEP, 'utf8'));
  return Object.entries(ruw).filter(([k]) => !k.startsWith('_')).map(([entity_id, v]) =>
    (v && typeof v === 'object' ? { entity_id, state: String(v.state), attributes: v.attributes || {} } : { entity_id, state: String(v), attributes: {} }));
}

async function haFetch(pad, opties = {}) {
  if (nepFetch) return nepFetch(pad, opties);
  const { url, token } = haConfig();
  if (!url || !token) throw new HaFout('Home Assistant is niet ingesteld (HA_URL en HA_TOKEN, of de add-on).');
  let res;
  try {
    res = await fetch(`${url}/api/${pad}`, { ...opties, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opties.headers || {}) }, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new HaFout(`Home Assistant niet bereikbaar op ${url}: ${oorzaak(e)}`);
  }
  if (res.status === 401) throw new HaFout('Home Assistant weigert het token (401). Controleer HA_TOKEN.');
  if (!res.ok) throw new HaFout(`Home Assistant gaf fout ${res.status} op ${pad.split('?')[0]}.`);
  return res;
}

// Alle toestanden in één aanroep (efficiënter dan per entiteit), als Map.
export async function haStaten() {
  if (process.env.HA_NEP && !nepFetch) return new Map(nepStaten().map(s => [s.entity_id, s]));
  const res = await haFetch('states');
  const lijst = typeof res.json === 'function' ? await res.json() : res;
  return new Map(lijst.map(s => [s.entity_id, s]));
}

// Dienst aanroepen, bv. button.press op een knop-entiteit.
export async function haDienst(domein, dienst, data) {
  if (process.env.HA_NEP && !nepFetch) {
    const ruw = JSON.parse(fs.readFileSync(process.env.HA_NEP, 'utf8'));
    (ruw._diensten ||= []).push({ domein, dienst, data });
    fs.writeFileSync(process.env.HA_NEP, JSON.stringify(ruw));
    return;
  }
  await haFetch(`services/${domein}/${dienst}`, { method: 'POST', body: JSON.stringify(data || {}) });
}

// Momentopname van een camera (het token blijft in de backend).
export async function haCameraBeeld(entity) {
  if (process.env.HA_NEP && !nepFetch) {
    // 1×1 grijze pixel
    return { type: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4+P//fwAJ5wP0fKJpYQAAAABJRU5ErkJggg==', 'base64') };
  }
  const res = await haFetch(`camera_proxy/${encodeURIComponent(entity)}`);
  return { type: res.headers?.get?.('content-type') || 'image/jpeg', data: Buffer.from(await res.arrayBuffer()) };
}

// Geschiedenis van één entiteit (bv. de kWh-meter) tussen twee tijdstippen.
export async function haGeschiedenis(entity, van, tot) {
  if (process.env.HA_NEP && !nepFetch) {
    const ruw = JSON.parse(fs.readFileSync(process.env.HA_NEP, 'utf8'));
    return (ruw._geschiedenis?.[entity] || []).filter(x => x.last_changed >= van && x.last_changed <= tot);
  }
  const pad = `history/period/${encodeURIComponent(van)}?filter_entity_id=${encodeURIComponent(entity)}&end_time=${encodeURIComponent(tot)}&minimal_response&no_attributes`;
  const res = await haFetch(pad);
  const data = typeof res.json === 'function' ? await res.json() : res;
  return (data?.[0] || []).map(x => ({ state: x.state, last_changed: x.last_changed || x.last_updated }));
}

// Stand van een meter op een tijdstip: de laatste gekende waarde op of vóór
// dat moment (zoekt tot 12 u terug), anders de eerste erna (binnen 15 min).
export async function meterOp(entity, tijdstip) {
  const t = Date.parse(tijdstip);
  const lijst = (await haGeschiedenis(entity, new Date(t - 12 * 3600e3).toISOString(), new Date(t + 15 * 60e3).toISOString()))
    .map(x => ({ w: parseFloat(x.state), t: Date.parse(x.last_changed) })).filter(x => Number.isFinite(x.w) && Number.isFinite(x.t));
  const voor = lijst.filter(x => x.t <= t).at(-1);
  return voor ? voor.w : (lijst.find(x => x.t > t)?.w ?? null);
}
