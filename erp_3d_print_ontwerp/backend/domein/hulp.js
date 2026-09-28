// Kleine gedeelde hulpfuncties. Staan hier ÉÉN keer, in plaats van gekopieerd
// in elke route zoals in het oude pakket (getTarieven stond daar in 3
// bestanden, getalOfDefault in 5).

// Getal uit invoer, met terugval enkel als er écht niets bruikbaars is.
// Een bewust ingevulde 0 blijft 0 (met `x || standaard` ging die verloren).
export function getalOfDefault(waarde, standaard) {
  if (waarde === null || waarde === undefined || waarde === '') return standaard;
  const n = typeof waarde === 'number' ? waarde : parseFloat(String(waarde).replace(',', '.'));
  return Number.isFinite(n) ? n : standaard;
}

// Optioneel getal uit een formulier: leeg → null, ongeldig → NaN (de route
// meldt dan zelf een fout), anders het getal.
export function optioneelGetal(waarde) {
  if (waarde === null || waarde === undefined || waarde === '') return null;
  const n = typeof waarde === 'number' ? waarde : parseFloat(String(waarde).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

// Alle tarieven als { sleutel: waarde }.
export function getTarieven(db) {
  const rijen = db.prepare('SELECT sleutel, waarde FROM tarieven').all();
  return Object.fromEntries(rijen.map(r => [r.sleutel, r.waarde]));
}

// Bedrijfsgegevens voor op offerte, werkbon en pakbon.
export function getBedrijfsgegevens(db) {
  const rijen = db.prepare(`SELECT sleutel, waarde FROM instellingen WHERE sleutel LIKE 'bedrijf_%'`).all();
  const m = Object.fromEntries(rijen.map(r => [r.sleutel, r.waarde || '']));
  return {
    naam: m.bedrijf_naam || '', btw: m.bedrijf_btw || '', adres: m.bedrijf_adres || '',
    email: m.bedrijf_email || '', iban: m.bedrijf_iban || '',
  };
}

export function isFkFout(e) {
  return typeof e?.message === 'string' && e.message.includes('FOREIGN KEY constraint failed');
}
export function isUniekFout(e) {
  return typeof e?.message === 'string' && e.message.includes('UNIQUE constraint failed');
}

// Fout in de bedrijfsregels (bv. "onvoldoende voorraad"). Een route geeft
// die door als 400 met de tekst; elke andere fout blijft een 500.
export class DomeinFout extends Error {}

// Afronden op 4 decimalen, tegen 0,1 + 0,2 = 0,30000000000000004.
export const rond = x => Math.round(x * 1e4) / 1e4;

// Dossier afgerekend via een losse verkoop (26-09): het bedrag staat dan op
// het dossier ÉN in de verkoop. Omzet/aantallen tellen het via de verkoop;
// deze voorwaarde sluit zulke dossiers uit (alias = de dossiers-tabel).
export const VIA_VERKOOP = alias => `EXISTS (SELECT 1 FROM verkoop_regels vr_ JOIN verkopen v_ ON v_.id = vr_.verkoop_id
  WHERE vr_.dossier_id = ${alias}.id AND v_.geannuleerd_op IS NULL)`;
