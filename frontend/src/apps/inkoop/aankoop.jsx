// Statussen van een aankoop (afgeleid in de backend, domein/aankopen.js).
export const STATUS = {
  concept: ['b-neutral', 'Concept'],
  besteld: ['b-info', 'Besteld'],
  deels: ['b-warn', 'Deels ontvangen'],
  ontvangen: ['b-pos', 'Ontvangen'],
  geannuleerd: ['b-crit', 'Geannuleerd'],
};
export const STAPPEN = ['Concept', 'Besteld', 'Deels ontvangen', 'Ontvangen'];
export const STAP_INDEX = { concept: 0, besteld: 1, deels: 2, ontvangen: 3 };

export function AankoopStatus({ status }) {
  const [k, l] = STATUS[status] || STATUS.concept;
  return <span className={`badge ${k}`}>{l}</span>;
}
