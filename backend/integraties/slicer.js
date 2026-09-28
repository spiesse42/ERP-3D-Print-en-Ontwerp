// ═══════════════════════════════════════════════════════════════════════
// SLICERBESTAND inlezen (28-09) — Bambu Studio / OrcaSlicer (.gcode.3mf)
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

export async function leesSlicerBestand(buffer) {
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
