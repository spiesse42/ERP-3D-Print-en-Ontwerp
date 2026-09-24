// ═══════════════════════════════════════════════════════════════════════
// PRINTER-ADAPTERS — Home Assistant-entiteiten → één vaste vorm (stap 6a)
// ═══════════════════════════════════════════════════════════════════════
// Entiteitsnamen en statuswaarden overgenomen uit het oude pakket
// (backend/routes/printers.js /config en frontend/lib/usePrinterData.js),
// waar ze live getest zijn:
// - Bambu Lab-integratie (A1 Mini, A1), Nederlandstalige entiteiten
// - Anycubic S1 MQTT Bridge (Kobra S1): "printer_state" (busy/free) is de
//   stabiele hoofdstatus; "print_state" wisselt te vaak en dient ENKEL om
//   mislukt/geannuleerd te herkennen (live vastgesteld 10-09-2026)
//
// Genormaliseerde status: 'bezig' | 'pauze' | 'klaar' | 'mislukt' |
// 'geannuleerd' | 'vrij' | 'offline' | 'onbekend'

export const KOPPELINGEN = {
  manueel: 'Manueel (starten/stoppen met een knop)',
  bambu_ha: 'Bambu Lab via Home Assistant',
  anycubic_ha: 'Anycubic S1 MQTT Bridge via Home Assistant',
};

// "a1mini_0309_" of "sensor.a1mini_0309_" → altijd met domein.
export function metDomein(id, domein = 'sensor') {
  const t = String(id || '').trim();
  if (!t) return '';
  return /^[a-z_]+\./.test(t) ? t : `${domein}.${t}`;
}

const ENTITEITEN = {
  bambu_ha: {
    status: 'printstatus', voortgang: 'printvoortgang', bestand: 'taaknaam', resterend: 'resterende_tijd',
    laag: 'huidige_laag', lagen: 'hoeveelheid_lagen', gewicht: 'gewicht_van_print', starttijd: 'starttijd',
    bed: 'bedtemperatuur', nozzle: 'nozzle_temperatuur',
  },
  anycubic_ha: {
    status: 'printer_state', fout: 'print_state', voortgang: 'print_progress', bestand: 'print_filename',
    resterend: 'print_time_remaining', verstreken: 'print_time_elapsed', laag_ruw: 'print_layer',
    materiaal_mm: 'material_usage', bed: 'hotbed_temperature', nozzle: 'nozzle_temperature',
  },
};

// Welke entiteiten een printer gebruikt (voor "koppeling testen").
export function entiteitenVan(p) {
  const e = {};
  const basis = ENTITEITEN[p.koppeling];
  if (basis && p.ha_prefix) {
    const prefix = metDomein(p.ha_prefix);
    for (const [k, v] of Object.entries(basis)) e[k] = `${prefix}${v}`;
  }
  if (p.watt_entity) e.watt = metDomein(p.watt_entity);
  if (p.kwh_entity) e.kwh = metDomein(p.kwh_entity);
  return e;
}

const getal = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const ACTIEF = ['running', 'printing', 'prepare', 'busy', 'slicing', 'init'];
const PAUZE = ['pause', 'paused', 'pausing'];
const KLAAR = ['finish', 'finished', 'complete', 'completed', 'success', 'done'];
const VRIJ = ['idle', 'standby', 'free', 'stoped', 'stopped', 'ready'];
const OFFLINE = ['offline', 'unavailable', 'unknown', ''];

function normaalStatus(ruw) {
  const s = String(ruw ?? '').toLowerCase().trim();
  if (ACTIEF.includes(s)) return 'bezig';
  if (PAUZE.includes(s)) return 'pauze';
  if (KLAAR.includes(s)) return 'klaar';
  if (s === 'failed') return 'mislukt';
  if (s === 'cancelled' || s === 'canceled') return 'geannuleerd';
  if (VRIJ.includes(s)) return 'vrij';
  if (OFFLINE.includes(s)) return 'offline';
  return 'onbekend';
}

// staten: Map entity_id → { state, attributes }
export function leesPrinter(p, staten) {
  const e = entiteitenVan(p);
  const st = k => (e[k] ? staten.get(e[k]) : undefined);
  const w = k => st(k)?.state;
  const uit = { status: 'onbekend', ruwe_status: null, voortgang: null, bestand: null, resterend_min: null, verstreken_min: null,
    laag: null, lagen: null, bed: null, nozzle: null, watt: getal(w('watt')), kwh_meter: getal(w('kwh')), gewicht_g: null,
    ontbrekend: Object.entries(e).filter(([, id]) => !staten.has(id)).map(([k, id]) => `${k}: ${id}`) };
  if (p.koppeling === 'bambu_ha') {
    uit.ruwe_status = w('status') ?? null;
    uit.status = normaalStatus(uit.ruwe_status);
    uit.voortgang = getal(w('voortgang'));
    uit.bestand = w('bestand') && !OFFLINE.includes(String(w('bestand')).toLowerCase()) ? w('bestand') : null;
    // Bambu geeft de resterende tijd in UREN (oude pakket: × 3600 s). De eenheid
    // uit Home Assistant heeft voorrang als die er is (h / min / s).
    const rest = getal(w('resterend'));
    const eenheid = String(st('resterend')?.attributes?.unit_of_measurement || 'h').toLowerCase();
    uit.resterend_min = rest == null ? null : eenheid.startsWith('min') ? rest : eenheid === 's' ? rest / 60 : rest * 60;
    uit.laag = getal(w('laag')); uit.lagen = getal(w('lagen'));
    uit.gewicht_g = getal(w('gewicht'));
    uit.bed = getal(w('bed')); uit.nozzle = getal(w('nozzle'));
    const start = w('starttijd'); const t = start ? Date.parse(start) : NaN;
    if (Number.isFinite(t)) uit.gestart_op = new Date(t).toISOString();
  } else if (p.koppeling === 'anycubic_ha') {
    uit.ruwe_status = w('status') ?? null;
    const hoofd = String(uit.ruwe_status ?? '').toLowerCase();
    const fout = String(w('fout') ?? '').toLowerCase();
    // busy/free is stabiel; mislukt/geannuleerd komt uit print_state
    if (fout === 'failed') uit.status = 'mislukt';
    else if (fout === 'cancelled' || fout === 'canceled') uit.status = 'geannuleerd';
    else if (hoofd === 'busy') uit.status = PAUZE.includes(fout) ? 'pauze' : 'bezig';
    else if (hoofd === 'free') uit.status = ['finished', 'finish', 'done'].includes(fout) ? 'klaar' : 'vrij';
    else uit.status = normaalStatus(hoofd);
    uit.voortgang = getal(w('voortgang'));
    uit.bestand = w('bestand') && !OFFLINE.includes(String(w('bestand')).toLowerCase()) ? w('bestand') : null;
    uit.resterend_min = getal(w('resterend'));
    uit.verstreken_min = getal(w('verstreken'));
    const m = String(w('laag_ruw') ?? '').match(/(\d+)\s*\/\s*(\d+)/);
    if (m) { uit.laag = Number(m[1]); uit.lagen = Number(m[2]); }
    uit.bed = getal(w('bed')); uit.nozzle = getal(w('nozzle'));
  }
  return uit;
}
