// ═══════════════════════════════════════════════════════════════════════
// SLICERBESTAND inlezen (28-09) — Bambu Studio / OrcaSlicer (.gcode.3mf of .gcode)
// ═══════════════════════════════════════════════════════════════════════
// Een geslicet 3mf-bestand is een zip met per GESLICETE plaat de voorspelde
// printtijd en de grammen per filamentslot (Metadata/slice_info.config).
// Enkel geslicete platen staan erin: "Slice plate" → één plaat, "Slice all"
// → alle platen. Geen AI nodig: de getallen komen rechtstreeks uit de slicer.
// - Metadata/slice_info.config     per plaat: index, prediction (s), weight (g),
//                                   objecten, filamenten (slot, type, kleur, used_g)
// - Metadata/project_settings.config (JSON) per slot: merk (filament_vendor),
//                                   profiel (filament_settings_id), printermodel
// - Metadata/model_settings.config naam van de plaat (plater_name)
// - Metadata/plate_N.png (anders plate_N_small.png): afbeelding van de plaat
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { DomeinFout } from '../domein/hulp.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, trimValues: true });
const lijst = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const getal = v => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; };
const r2 = v => Math.round(v * 100) / 100;
const meta = (knoop, sleutel) => lijst(knoop?.metadata).find(m => m['@key'] === sleutel)?.['@value'];

async function leesTekst(zip, pad) {
  const f = zip.file(pad);
  return f ? f.async('string') : null;
}

// ── losse .gcode (28-09) ─────────────────────────────────────────────────
// Bambu Studio / OrcaSlicer / PrusaSlicer zetten in het commentaar:
// - tijd: "; total estimated time: 1h 30m 2s" (Bambu) of
//   "; estimated printing time (normal mode) = 1h 30m 2s" (Orca/Prusa)
// - gram per filament: "; total filament weight [g] : 12.02,3.10" (Bambu) of
//   "; filament used [g] = 12.02, 3.10" (Orca/Prusa); Bambu zegt met
//   "; filament: 1,3" welke slots dat zijn
// - instellingen: "; filament_type = PLA;PLA", filament_colour, filament_vendor,
//   filament_settings_id, printer_model
// - voorbeeld: "; thumbnail begin 300x300 …" … "; thumbnail end" (PNG, base64)
// Kop en staart volstaan (de instellingen staan bij Prusa/Orca achteraan).
const STUK = 4 * 1024 * 1024;
function duurMin(t) {
  if (!t) return null;
  const d = n => Number(new RegExp(`(\\d+)\\s*${n}`).exec(t)?.[1] || 0);
  const min = d('d') * 1440 + d('h') * 60 + d('m') + d('s') / 60;
  return min > 0 ? Math.round(min) : null;
}
const lijstUit = (v, sep) => (v == null ? [] : String(v).split(sep).map(x => x.trim().replace(/^"(.*)"$/, '$1')));

export function leesGcode(buffer, bestandsnaam = '') {
  const tekst = buffer.length <= 2 * STUK ? buffer.toString('utf8')
    : `${buffer.subarray(0, STUK).toString('utf8')}\n${buffer.subarray(buffer.length - STUK).toString('utf8')}`;
  const instelling = {};
  for (const m of tekst.matchAll(/^;\s*([A-Za-z_][\w ]*?(?:\s*\[[^\]]*\])?(?:\s*\([^)]*\))?)\s*[=:]\s*(.*)$/gm)) {
    const sleutel = m[1].trim().toLowerCase();
    if (!(sleutel in instelling)) instelling[sleutel] = m[2].trim();
  }
  const bambuTijd = /total estimated time:\s*([^;\n]+)/.exec(tekst)?.[1];
  const tijd_min = duurMin(bambuTijd || instelling['estimated printing time (normal mode)']);
  const gramTekst = instelling['total filament weight [g]'] ?? instelling['filament used [g]'];
  const grammen = lijstUit(gramTekst, ',').map(g => Number(g) || 0);
  if (!grammen.length && tijd_min == null) {
    throw new DomeinFout('In dit bestand staan geen printtijd en filamentgewicht van de slicer. Gebruik een gcode uit Bambu Studio, OrcaSlicer of PrusaSlicer, of het geslicete 3mf-bestand.');
  }
  const slots = lijstUit(instelling.filament, ',').map(Number).filter(n => Number.isInteger(n) && n > 0);
  const slotVan = i => (slots.length === grammen.length ? slots[i] : i + 1);
  const perSlot = (sleutel, slot) => lijstUit(instelling[sleutel], ';')[slot - 1] || null;
  const filamenten = grammen.map((g, i) => {
    const slot = slotVan(i);
    return { slot, type: perSlot('filament_type', slot), merk: perSlot('filament_vendor', slot), profiel: perSlot('filament_settings_id', slot),
      kleur: (perSlot('filament_colour', slot) || '').slice(0, 7) || null, gram: r2(g) };
  }).filter(f => f.gram > 0);
  // grootste PNG-voorbeeld
  let afbeelding = null, grootste = 0;
  for (const m of tekst.matchAll(/^; thumbnail begin (\d+)x(\d+) \d+\s*$([\s\S]*?)^; thumbnail end/gm)) {
    const opp = Number(m[1]) * Number(m[2]);
    if (opp > grootste) { grootste = opp; afbeelding = `data:image/png;base64,${m[3].replace(/^;\s?/gm, '').replace(/\s+/g, '')}`; }
  }
  const naam = String(bestandsnaam).replace(/\.(gcode|gco|g)$/i, '').replace(/[_-]+/g, ' ').trim() || null;
  return {
    printer_model: (instelling.printer_model || '').replace(/^"(.*)"$/, '$1') || null,
    platen: [{ nummer: 1, naam, objecten: [], tijd_min: tijd_min ?? 0, gram: r2(filamenten.reduce((t, f) => t + f.gram, 0)), filamenten, afbeelding }],
  };
}

// 3mf (zip) of gcode (tekst), herkend aan de inhoud.
export async function leesSlicerBestand(buffer, bestandsnaam = '') {
  const isZip = buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!isZip && /\.(gcode|gco|g)$/i.test(bestandsnaam)) return leesGcode(buffer, bestandsnaam);
  if (!isZip && /^;/m.test(buffer.subarray(0, 64 * 1024).toString('utf8'))) return leesGcode(buffer, bestandsnaam);
  let zip;
  try { zip = await JSZip.loadAsync(buffer); }
  catch { throw new DomeinFout('Dit is geen 3mf-bestand. Exporteer in Bambu Studio via Bestand → Exporteren → "Export plate sliced file" of "Export all sliced file".'); }

  const info = await leesTekst(zip, 'Metadata/slice_info.config');
  const platen = lijst(info ? parser.parse(info)?.config?.plate : null);
  if (!platen.length) {
    throw new DomeinFout('Dit 3mf-bestand bevat geen geslicete platen. Slice eerst in Bambu Studio ("Slice plate" of "Slice all") en exporteer dan het geslicete bestand (.gcode.3mf).');
  }

  let instellingen = {};
  try { instellingen = JSON.parse(await leesTekst(zip, 'Metadata/project_settings.config') || '{}'); } catch { /* optioneel */ }
  const perSlot = (sleutel, slot) => lijst(instellingen[sleutel])[slot - 1] ?? null;

  const namen = new Map();
  const model = await leesTekst(zip, 'Metadata/model_settings.config');
  if (model) {
    for (const p of lijst(parser.parse(model)?.config?.plate)) {
      const naam = String(meta(p, 'plater_name') ?? '').trim();
      if (naam) namen.set(Number(meta(p, 'plater_id')), naam);
    }
  }

  const uit = [];
  for (const p of platen) {
    const nummer = Number(meta(p, 'index'));
    const objecten = lijst(p.object).filter(o => o['@skipped'] !== 'true').map(o => String(o['@name'] || '').replace(/\.(stl|3mf|obj|step|stp)$/i, '').trim()).filter(Boolean);
    const filamenten = lijst(p.filament).map(f => {
      const slot = Number(f['@id']);
      return {
        slot,
        type: f['@type'] || perSlot('filament_type', slot),
        merk: perSlot('filament_vendor', slot),
        profiel: perSlot('filament_settings_id', slot),
        kleur: (f['@color'] || perSlot('filament_colour', slot) || '').slice(0, 7) || null,
        gram: r2(getal(f['@used_g']) ?? 0),
      };
    }).filter(f => f.gram > 0);
    const png = zip.file(`Metadata/plate_${nummer}.png`) || zip.file(`Metadata/plate_${nummer}_small.png`);
    uit.push({
      nummer,
      naam: namen.get(nummer) || (objecten.length === 1 ? objecten[0] : null),
      objecten,
      tijd_min: Math.round((getal(meta(p, 'prediction')) ?? 0) / 60),
      gram: r2(getal(meta(p, 'weight')) ?? filamenten.reduce((t, f) => t + f.gram, 0)),
      filamenten,
      afbeelding: png ? `data:image/png;base64,${await png.async('base64')}` : null,
    });
  }
  uit.sort((a, b) => a.nummer - b.nummer);
  return { printer_model: instellingen.printer_model || null, platen: uit };
}
