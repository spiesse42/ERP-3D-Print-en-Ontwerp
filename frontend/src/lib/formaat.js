// Getallen en datums in Belgische notatie, op één plaats.
const nl = (n, min, max) => Number(n).toLocaleString('nl-BE', { minimumFractionDigits: min, maximumFractionDigits: max });

// € 1.234,50 — kleine prijzen (bv. € 0,035 per ring) houden tot 4 decimalen.
export const euro = n => (n == null || n === '' ? '—' : `€ ${nl(n, 2, 4)}`);
export const aantal = n => (n == null || n === '' ? '—' : nl(n, 0, 3));
// Getal → tekst voor een invoerveld (komma als decimaalteken).
export const naarInvoer = n => (n == null ? '' : String(n).replace('.', ','));
// Tekst uit een invoerveld → getal (of null als leeg, NaN als ongeldig).
export const uitInvoer = t => {
  const s = String(t ?? '').trim();
  if (!s) return null;
  return /^-?\d+([.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN;
};
// SQLite: 'JJJJ-MM-DD' (lokale datum) of 'JJJJ-MM-DD uu:mm:ss' (UTC);
// ook ISO-tijden zoals '2026-09-25T10:00:00.000Z' (printerwachter, stap 6a).
export function alsDatum(t) {
  const s = String(t);
  if (s.length === 10) return new Date(`${s}T00:00:00`);
  if (s.includes('T')) return new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`);
  return new Date(`${s.replace(' ', 'T')}Z`);
}
export const datum = t => (t ? alsDatum(t).toLocaleDateString('nl-BE') : '');
export const datumTijd = t => (t ? alsDatum(t).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const vandaag = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
