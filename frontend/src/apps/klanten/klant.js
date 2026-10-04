// Weergavenaam: bedrijf → bedrijfsnaam; particulier → voornaam + naam.
export function klantNaam(k) {
  if (!k) return '';
  if (k.type === 'zakelijk' && k.bedrijfsnaam) return k.bedrijfsnaam;
  return [k.voornaam, k.naam].filter(Boolean).join(' ') || k.naam || '';
}

// Belgisch Peppol-ID = schema 0208 + ondernemingsnummer (10 cijfers).
// Enkel een VOORSTEL op basis van het ingevulde nummer; niet gecontroleerd
// of de klant effectief op Peppol staat.
export function peppolVoorstel(btw, land) {
  if (land && land !== 'BE') return null;
  if (/^[A-Z]{2}/i.test(String(btw || '').trim()) && !/^BE/i.test(String(btw).trim())) return null;
  const cijfers = String(btw || '').replace(/\D/g, '');
  if (cijfers.length === 10) return `0208:${cijfers}`;
  if (cijfers.length === 9) return `0208:0${cijfers}`;
  return null;
}

export const LEGE_KLANT = {
  type: 'particulier', naam: '', voornaam: '', bedrijfsnaam: '',
  email: '', telefoon: '', gsm: '', straat: '', huisnummer: '', postcode: '', gemeente: '', land: '',
  btw_nummer: '', peppol_id: '', notities: '', familie: false,
};

export function naarFormulier(k) {
  const f = { ...LEGE_KLANT };
  for (const s of Object.keys(LEGE_KLANT)) f[s] = k?.[s] ?? LEGE_KLANT[s];
  f.familie = !!f.familie;
  return f;
}

// Landen voor het adres (29-09): leeg = België.
export const LANDEN = [['', 'België'], ['NL', 'Nederland'], ['FR', 'Frankrijk'], ['DE', 'Duitsland'], ['LU', 'Luxemburg'],
  ['ES', 'Spanje'], ['IT', 'Italië'], ['AT', 'Oostenrijk'], ['PT', 'Portugal'], ['IE', 'Ierland'], ['DK', 'Denemarken'], ['SE', 'Zweden'],
  ['FI', 'Finland'], ['PL', 'Polen'], ['CZ', 'Tsjechië'], ['GB', 'Verenigd Koninkrijk'], ['CH', 'Zwitserland'], ['NO', 'Noorwegen'], ['US', 'Verenigde Staten']];
