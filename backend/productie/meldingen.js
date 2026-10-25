// ═══════════════════════════════════════════════════════════════════════
// MELDINGEN OP DE GSM (25-10) via Home Assistant (Companion-app)
// ═══════════════════════════════════════════════════════════════════════
// Instelling gsm_melding_dienst = de notify-dienst van je gsm in Home
// Assistant (bv. mobile_app_pixel_8; Ontwikkelhulpmiddelen → Acties →
// "notify."). Leeg = geen meldingen. De printerwachter meldt:
// - een print die pauzeert (Bambu pauzeert zelf bij een fout of als het
//   filament op is; ook een gewone pauze wordt gemeld)
// - een mislukte print
// - een afgewerkte print (enkel met gsm_melding_klaar = 1)
// Een melding die niet verstuurd kan worden, is nooit een fout voor de wachter.
import { haDienst, haIngesteld } from '../integraties/homeassistant.js';
import { DomeinFout } from '../domein/hulp.js';

const instelling = (db, k) => db.prepare('SELECT waarde FROM instellingen WHERE sleutel = ?').get(k)?.waarde ?? null;
export const dienstVan = db => String(instelling(db, 'gsm_melding_dienst') ?? '').trim().replace(/^notify\./, '') || null;

export async function stuurMelding(db, { titel, tekst, dringend = false }) {
  const dienst = dienstVan(db);
  if (!dienst || !haIngesteld()) return false;
  // dringend: Android = hoge prioriteit, iOS = time-sensitive (komt door "niet storen" heen waar toegelaten)
  await haDienst('notify', dienst, { title: titel, message: tekst,
    data: dringend ? { priority: 'high', ttl: 0, push: { 'interruption-level': 'time-sensitive' } } : {} });
  return true;
}

export async function testMelding(db) {
  if (!haIngesteld()) throw new DomeinFout('Home Assistant is niet ingesteld (add-on-configuratie).');
  if (!dienstVan(db)) throw new DomeinFout('Vul eerst de notify-dienst van je gsm in en bewaar.');
  try { await stuurMelding(db, { titel: 'ERP 3D Print', tekst: 'Testmelding: meldingen van de printers komen op deze gsm toe.' }); }
  catch (e) { throw new DomeinFout(`Home Assistant weigerde de melding (${e.message}). Klopt de naam van de dienst?`); }
}

// Wat er te melden valt na één lezing van een printer.
// vorig = status bij de vorige lezing (undefined na een herstart: niets melden)
// 25-10: een fout wordt METEEN gemeld, bij de eerste lezing met die status
// (niet pas als de run na de wachttijd afgesloten wordt); al gemeld = bij het
// afsluiten niet nog eens.
const foutGemeld = new Set();   // printer-ids met een gemelde fout sinds de laatste lopende print
export function meldingVoor(db, printer, vorig, lezing, gesloten) {
  const wat = lezing.bestand ? ` (${lezing.bestand})` : '';
  const ruw = lezing.ruwe_status ? ` · ${lezing.ruwe_status}` : '';
  const fout = { titel: `❌ ${printer.naam}: fout, print gestopt`, tekst: `De printer meldt een fout${wat}${ruw}. Ga kijken (verstopping, filament, bed…).`, dringend: true };
  if (lezing.status === 'bezig') foutGemeld.delete(printer.id);
  if (vorig !== undefined && vorig !== 'mislukt' && lezing.status === 'mislukt' && !foutGemeld.has(printer.id)) { foutGemeld.add(printer.id); return fout; }
  if (gesloten === 'mislukt') { if (foutGemeld.has(printer.id)) return null; foutGemeld.add(printer.id); return fout; }
  if (gesloten === 'klaar' && instelling(db, 'gsm_melding_klaar') === '1') return { titel: `✅ ${printer.naam}: print klaar`, tekst: `De print is klaar${wat}.` };
  if (vorig === 'bezig' && lezing.status === 'pauze') return { titel: `⏸ ${printer.naam}: print gepauzeerd`, tekst: `De print staat stil${wat}${ruw}. Fout, filament op, of zelf gepauzeerd?`, dringend: true };
  return null;
}
