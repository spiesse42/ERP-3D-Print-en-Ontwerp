// Fases en soorten van een dossier. De fase zelf wordt AFGELEID in de
// backend (domein/status/dossier.js); hier enkel labels en kleuren.
export const FASE = {
  nieuw: ['b-info', 'Nieuw'],
  offerte: ['b-neutral', 'Offerte verstuurd'],
  akkoord: ['b-info', 'Akkoord'],
  productie: ['b-info', 'In productie'],
  klaar: ['b-pos', 'Klaar'],
  deels: ['b-warn', 'Deels geleverd'],
  geleverd: ['b-info', 'Geleverd'],
  afgerekend: ['b-warn', 'Afgerekend'],
  betaald: ['b-pos', 'Betaald'],
  geannuleerd: ['b-crit', 'Geannuleerd'],
};
export const FASE_VOLGORDE = ['nieuw', 'offerte', 'akkoord', 'productie', 'klaar', 'deels', 'geleverd', 'afgerekend', 'betaald', 'geannuleerd'];
export const OFFERTE_STATUS = {
  concept: ['b-neutral', 'Concept'], verstuurd: ['b-info', 'Verstuurd'], aanvaard: ['b-pos', 'Aanvaard'],
  geweigerd: ['b-crit', 'Geweigerd'], verlopen: ['b-warn', 'Verlopen'], vervangen: ['b-neutral', 'Vervangen'],
};
export function OfferteBadge({ status }) {
  const [k, l] = OFFERTE_STATUS[status] || OFFERTE_STATUS.concept;
  return <span className={`badge ${k}`}>{l}</span>;
}
export const VOOR_AFREKENING = ['nieuw', 'offerte', 'akkoord', 'productie', 'klaar', 'deels', 'geleverd'];
export const SOORT = { klant: 'Klantopdracht', eigen: 'Eigen product', intern: 'Intern' };

export function FaseBadge({ fase }) {
  const [k, l] = FASE[fase] || FASE.nieuw;
  return <span className={`badge ${k}`}>{l}</span>;
}

// Standaardomschrijving van een regel voor de overnamefiche / weergave.
export function regelLabel(r, b) {
  if (r.omschrijving) return r.omschrijving;
  if (r.type === 'artikel') return b?.naam || r.naam || 'Artikel';
  return { printen: 'Printwerk', ontwerp: 'Ontwerp', aanpassing: 'Aanpassing', extra: 'Extra kost' }[r.type] || r.type;
}
export function regelAantal(r) {
  if (r.type === 'printen' || r.type === 'artikel') return Number(r.aantal ?? 1);
  if (r.type === 'extra' && r.per_stuk) return Number(r.aantal ?? 1);
  return 1;
}
