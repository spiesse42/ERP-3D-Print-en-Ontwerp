// ═══════════════════════════════════════════════════════════════════════
// ONTBREKENDE GEGEVENS (stap 4b) — één overzicht over het hele pakket
// ═══════════════════════════════════════════════════════════════════════
// Enkel wat een berekening of een klantdocument echt blokkeert of fout
// maakt. Elke melding heeft een link naar het scherm waar je het oplost.
// Nieuwe controles komen erbij naarmate er apps bijkomen (bv. stap 6:
// printer zonder HA-koppeling).
import { NODIGE_TARIEVEN, getal } from './rekenmotor.js';
import { mailIngesteld as heeftMail } from '../documenten/mail.js';
import { vindBrowser } from '../documenten/pdf.js';
import { haIngesteld } from '../integraties/homeassistant.js';

const BEDRIJF = [['bedrijf_naam', 'naam'], ['bedrijf_adres', 'adres'], ['bedrijf_btw', 'btw-nummer'], ['bedrijf_iban', 'IBAN']];

export function ontbrekendeGegevens(db, { geminiIngesteld = !!process.env.GEMINI_API_KEY, mailIngesteld = heeftMail(), pdfBeschikbaar = !!vindBrowser() } = {}) {
  const uit = [];
  const voeg = (groep, tekst, naar, knop = 'Invullen') => uit.push({ groep, tekst, naar, knop });

  // Printers (rekenmotor weigert zonder tarief/verbruik)
  for (const p of db.prepare(`SELECT id, naam, machine_per_uur, verbruik_watt FROM printers WHERE actief = 1 ORDER BY naam COLLATE NOCASE`).all()) {
    const mist = [p.machine_per_uur == null && 'machinetarief', p.verbruik_watt == null && 'gemiddeld verbruik'].filter(Boolean);
    if (mist.length) voeg('Printers', `${p.naam}: ${mist.join(' en ')} ontbreekt`, '/instellingen/printers');
  }

  // Tarieven
  const tarieven = Object.fromEntries(db.prepare('SELECT sleutel, waarde, label FROM tarieven').all().map(t => [t.sleutel, t]));
  for (const k of NODIGE_TARIEVEN) {
    if (getal(tarieven[k]?.waarde) === null) voeg('Tarieven', `${tarieven[k]?.label || k} is niet ingevuld`, '/instellingen/tarieven');
  }

  // Materiaalprijzen: verkoopprijs/kg 0 → het materiaal wordt gratis gerekend
  for (const g of db.prepare(`SELECT ft.id, m.naam merk, mat.naam materiaal FROM filament_types ft
      JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id
      WHERE ft.verkoopprijs_per_kg IS NULL OR ft.verkoopprijs_per_kg <= 0 ORDER BY m.naam, mat.naam`).all()) {
    voeg('Materiaalprijzen', `${g.merk} ${g.materiaal}: geen verkoopprijs per kg`, '/instellingen/materiaal');
  }

  // Verkochte artikelen/diensten zonder verkoopprijs
  for (const a of db.prepare(`SELECT id, naam FROM artikelen WHERE gearchiveerd = 0 AND wordt_verkocht = 1
      AND type <> 'filament' AND verkoopprijs IS NULL ORDER BY naam COLLATE NOCASE`).all()) {
    voeg('Artikelen', `${a.naam}: wordt verkocht maar heeft geen verkoopprijs`, `/voorraad/artikelen/${a.id}`);
  }

  // Bedrijfsgegevens (op alle documenten)
  const inst = Object.fromEntries(db.prepare('SELECT sleutel, waarde FROM instellingen').all().map(i => [i.sleutel, i.waarde]));
  const mistB = BEDRIJF.filter(([k]) => !String(inst[k] ?? '').trim()).map(([, l]) => l);
  if (mistB.length) voeg('Bedrijfsgegevens', `Ontbreekt: ${mistB.join(', ')} (komen op offertes en facturen)`, '/instellingen/bedrijf');

  // Zakelijke klanten zonder btw-nummer (Peppol)
  for (const k of db.prepare(`SELECT id, COALESCE(NULLIF(bedrijfsnaam,''), TRIM(COALESCE(voornaam,'') || ' ' || COALESCE(naam,''))) weergave
      FROM klanten WHERE type = 'zakelijk' AND gearchiveerd = 0 AND (btw_nummer IS NULL OR TRIM(btw_nummer) = '')
      ORDER BY weergave COLLATE NOCASE`).all()) {
    voeg('Klanten', `${k.weergave}: zakelijke klant zonder btw-nummer (nodig voor Peppol)`, `/klanten/${k.id}`);
  }

  // Integraties (geheim: enkel ja/nee, nooit de waarde)
  if (!geminiIngesteld) voeg('Integraties', 'Gemini-sleutel niet ingesteld: factuur inlezen werkt niet', '/instellingen/integraties', 'Bekijken');
  // Printers die via Home Assistant gevolgd moeten worden (stap 6a)
  const gekoppeld = db.prepare(`SELECT naam FROM printers WHERE actief = 1 AND koppeling <> 'manueel'`).all().map(p => p.naam);
  if (gekoppeld.length && !haIngesteld()) voeg('Integraties', `Home Assistant niet ingesteld: ${gekoppeld.join(', ')} worden niet gevolgd`, '/instellingen/integraties', 'Bekijken');
  if (!mailIngesteld) voeg('Integraties', 'Mailen niet ingesteld (SMTP_USER / SMTP_PASS): offertes en werkbonnen mailen werkt niet', '/instellingen/integraties', 'Bekijken');
  if (!pdfBeschikbaar) voeg('Integraties', 'Geen Chrome, Edge of Chromium gevonden: PDF\'s maken werkt niet', '/instellingen/integraties', 'Bekijken');

  return uit;
}
