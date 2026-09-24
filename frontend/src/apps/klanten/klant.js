// Weergavenaam: bedrijf → bedrijfsnaam; particulier → voornaam + naam.
export function klantNaam(k) {
  if (!k) return '';
  if (k.type === 'zakelijk' && k.bedrijfsnaam) return k.bedrijfsnaam;
  return [k.voornaam, k.naam].filter(Boolean).join(' ') || k.naam || '';
}

// Belgisch Peppol-ID = schema 0208 + ondernemingsnummer (10 cijfers).
// Enkel een VOORSTEL op basis van het ingevulde nummer; niet gecontroleerd
// of de klant effectief op Peppol staat.
export function peppolVoorstel(btw) {
  const cijfers = String(btw || '').replace(/\D/g, '');
  if (cijfers.length === 10) return `0208:${cijfers}`;
  if (cijfers.length === 9) return `0208:0${cijfers}`;
  return null;
}

export const LEGE_KLANT = {
  type: 'particulier', naam: '', voornaam: '', bedrijfsnaam: '',
  email: '', telefoon: '', gsm: '', straat: '', huisnummer: '', postcode: '', gemeente: '',
  btw_nummer: '', peppol_id: '', notities: '',
};

export function naarFormulier(k) {
  const f = { ...LEGE_KLANT };
  for (const s of Object.keys(LEGE_KLANT)) f[s] = k?.[s] ?? LEGE_KLANT[s];
  return f;
}
