// Wat Gemini hoort terug te geven voor drie echte facturen (24-09-2026),
// met de hand opgesteld uit de PDF's. Enkel leveranciersgegevens en
// productregels; geen klantgegevens. Gebruikt om het koppelen en bevestigen
// te testen zonder echte oproep naar Gemini.
export const AC_PRODUCTS = {
  leverancier: { naam: 'AC products', btw_nummer: 'NL867451853B01', website: 'acproducts.nl' },
  factuurnummer: '16317', datum: '2026-08-21', totaal_incl_btw: 16.27,
  regels: [
    { soort: 'filament', omschrijving: 'eSUN PLA-Basic Dark Blue 1.75 mm 1KG', productcode: 'PLA-Basic175D-U1P1', aantal: 1, prijs_per_eenheid: 10.32, regeltotaal: 10.32,
      merk: 'eSUN', materiaal: 'PLA', kleur: 'Blauw', kleur_hex: '#1e3a8a' },
    { soort: 'kost', omschrijving: 'Verzending (Standard)', aantal: 1, prijs_per_eenheid: 5.95, regeltotaal: 5.95 },
  ],
};

export const BAMBU = {
  leverancier: { naam: 'Bambu Lab EU', btw_nummer: 'DE360354704', website: 'eu.store.bambulab.com' },
  factuurnummer: 'BBLEU2621H781XG22', datum: '2026-08-22', totaal_incl_btw: 56.76,
  regels: [
    { soort: 'filament', omschrijving: 'PLA Matte - Donkergroen (11501) / Bijvullen / 1 kg', productcode: 'A01-G7-1.75-1000-SPLFREE', aantal: 1, prijs_per_eenheid: 23.38, regeltotaal: 23.38,
      merk: 'Bambu Lab', materiaal: 'PLA Matte', kleur: 'Donkergroen', kleur_hex: '#1f5130' },
    { soort: 'filament', omschrijving: 'PLA Basic - Felgroen (10503) / Bijvullen / 1kg', productcode: 'A00-G3-1.75-1000-SPLFREE', aantal: 1, prijs_per_eenheid: 23.38, regeltotaal: 23.38,
      merk: 'Bambu Lab', materiaal: 'PLA', kleur: 'Groen', kleur_hex: '#43a047' },
    { soort: 'kost', omschrijving: 'Shipping', aantal: 1, prijs_per_eenheid: 10, regeltotaal: 10 },
  ],
};

const joy = (oms, kleur, hex, aantal, sub) => ({ soort: 'filament', omschrijving: oms, aantal, prijs_per_eenheid: Math.round(sub / aantal * 10000) / 10000, regeltotaal: sub, merk: oms.includes('eSUN') ? 'eSUN' : 'AnyCubic', materiaal: oms.includes('PETG') ? 'PETG' : 'PLA', kleur, kleur_hex: hex });
export const JOYBUY = {
  leverancier: { naam: 'Jingdong Retail (Netherlands) B.V. (Joybuy)', btw_nummer: 'NL861678370B01' },
  factuurnummer: 'NL20260002895943', datum: '2026-09-21', totaal_incl_btw: 98.89,
  regels: [
    joy('JOYBUY x ANYCUBIC PLA Basic Filament 1kg 1.75mm - Cyan', 'Cyaan', '#00bcd4', 1, 8.24),
    joy('JOYBUY x ANYCUBIC PLA Basic Filament 1kg 1.75mm - Texture Grey', 'Textuurgrijs', '#8a8a8a', 2, 16.49),
    joy('JOYBUY x ANYCUBIC PLA Basic Filament 1kg 1.75mm - Orange', 'Oranje', '#f57c00', 1, 8.24),
    joy('JOYBUY x ANYCUBIC PLA Basic Filament 1kg 1.75mm - Blue', 'Blauw', '#1e88e5', 1, 8.24),
    joy('JOYBUY x ANYCUBIC PLA Basic Filament 1kg 1.75mm - Purple', 'Paars', '#8e24aa', 1, 8.24),
    joy('eSUN PLA-Basic 3D Printing Filament 1.75mm - Black 1kg', 'Zwart', '#1a1a1a', 2, 16.48),
    joy('eSUN PLA-Basic 3D Printing Filament 1.75mm - Yellow 1kg', 'Geel', '#fdd835', 1, 8.24),
    joy('eSUN PLA-Basic 3D Printing Filament 1.75mm - White 1kg', 'Wit', '#f5f5f0', 2, 16.48),
    joy('JOYBUYxANYCUBIC Filament PETG 1KG - Red', 'Rood', '#d32f2f', 1, 8.24),
    { soort: 'kost', omschrijving: 'Freight', aantal: 1, prijs_per_eenheid: 0, regeltotaal: 0 },
  ],
};

// Bestelmail van Joybuy (25-09-2026, uit een screenshot): geen prijzen,
// Nederlandse omschrijvingen, bestelnummer = ordernummer op de factuur.
const joyMail = (oms, kleur, aantal) => ({ soort: 'filament', omschrijving: oms, aantal, merk: oms.includes('eSUN') ? 'eSUN' : 'AnyCubic', materiaal: oms.includes('PETG') ? 'PETG' : 'PLA', kleur, kleur_hex: '#888888' });
export const JOYBUY_BESTELMAIL = {
  documentsoort: 'bestelbon', leverancier: { naam: 'Joybuy', website: 'joybuy.nl' }, bestelnummer: '1062802400000080695', datum: '2026-09-21',
  regels: [
    joyMail('JOYBUY x ANYCUBIC PLA Basic printfilament, 1 kg spoel - Cyaan', 'Cyaan', 1),
    joyMail('JOYBUY x ANYCUBIC PLA Basic printfilament, 1 kg spoel - Textuur grijs', 'Textuurgrijs', 2),
    joyMail('JOYBUY x ANYCUBIC PLA Basic printfilament, 1 kg spoel - Oranje', 'Oranje', 1),
    joyMail('JOYBUY x ANYCUBIC PLA Basic printfilament, 1 kg spoel - Blauw', 'Blauw', 1),
    joyMail('JOYBUY x ANYCUBIC PLA Basic printfilament, 1 kg spoel - Paars', 'Paars', 1),
    joyMail('eSUN PLA-Basic 3D-printfilament 1,75 mm - Zwart 1 kg', 'Zwart', 2),
    joyMail('eSUN PLA-Basic 3D-printfilament 1,75 mm - Geel 1 kg', 'Geel', 1),
    joyMail('eSUN PLA-Basic 3D-printfilament 1,75 mm - Wit 1 kg', 'Wit', 2),
    joyMail('JOYBUYxANYCUBIC PETG-filament 1 kg - Rood', 'Rood', 1),
  ],
};
// De factuur van dezelfde bestelling, zoals Gemini ze nu ook teruggeeft.
export const JOYBUY_FACTUUR = { ...JOYBUY, documentsoort: 'factuur', bestelnummer: '1062802400000080695', leverancier: { naam: 'JINGDONG RETAIL (NETHERLANDS) B.V.', btw_nummer: 'NL861678370B01' } };
