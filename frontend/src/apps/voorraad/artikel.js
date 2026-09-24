import { naarInvoer } from '../../lib/formaat.js';

export const TYPE_LABEL = { filament: 'Filament', artikel: 'Artikel', dienst: 'Dienst' };

// Korte omschrijving van de vinkjes, bv. "gekocht · verkocht".
export function vinkjesTekst(a) {
  if (a.type === 'filament') return 'gekocht';
  return [a.wordt_gekocht && 'gekocht', a.zelf_geprint && 'zelf geprint', a.wordt_verkocht && 'verkocht'].filter(Boolean).join(' · ');
}

export const LEGE_REGEL = { leverancier_id: '', productcode: '', omschrijving: '', laatste_prijs: '', levertijd_dagen: '', voorkeur: false };

export function naarFormulier(a, type = 'artikel') {
  if (!a) {
    return {
      type, wordt_gekocht: type !== 'dienst', wordt_verkocht: type === 'dienst', zelf_geprint: false,
      categorie_id: '', naam: '', filament_type_id: '', kleur_id: '', eenheid: type === 'filament' ? 'rollen' : 'stuks',
      verkoopprijs: '', inkoopprijs: '', marge_pct: '', productieprijs: '', vaste_prijs: false,
      min_voorraad: '', max_voorraad: '', locatie: '', notities: '', leveranciers: [],
    };
  }
  const s = v => (v == null ? '' : String(v));
  return {
    type: a.type, wordt_gekocht: !!a.wordt_gekocht, wordt_verkocht: !!a.wordt_verkocht, zelf_geprint: !!a.zelf_geprint,
    categorie_id: s(a.categorie_id), naam: a.naam || '', filament_type_id: s(a.filament_type_id), kleur_id: s(a.kleur_id),
    eenheid: a.eenheid || 'stuks',
    verkoopprijs: naarInvoer(a.verkoopprijs), inkoopprijs: naarInvoer(a.inkoopprijs), marge_pct: naarInvoer(a.marge_pct),
    productieprijs: naarInvoer(a.productieprijs), vaste_prijs: !!a.vaste_prijs,
    min_voorraad: naarInvoer(a.min_voorraad), max_voorraad: naarInvoer(a.max_voorraad),
    locatie: a.locatie || '', notities: a.notities || '',
    leveranciers: (a.leveranciers || []).map(l => ({
      leverancier_id: s(l.leverancier_id), productcode: l.productcode || '', omschrijving: l.omschrijving || '',
      laatste_prijs: naarInvoer(l.laatste_prijs), levertijd_dagen: s(l.levertijd_dagen), voorkeur: !!l.voorkeur,
    })),
  };
}

// Formulier → body voor de API (komma's mogen, de backend leest die).
export function naarBody(f) {
  return { ...f, leveranciers: f.leveranciers.filter(l => l.leverancier_id) };
}

// Voorstel verkoopprijs = inkoopprijs × (1 + marge%).
export function voorstelVerkoopprijs(inkoop, marge) {
  const i = Number(String(inkoop).replace(',', '.'));
  const m = Number(String(marge).replace(',', '.'));
  if (String(inkoop).trim() === '' || String(marge).trim() === '' || !Number.isFinite(i) || !Number.isFinite(m)) return null;
  return Math.round(i * (1 + m / 100) * 10000) / 10000;
}

// Badge voor de voorraadstatus (uit de backend: ok / besteld / bestellen / geen).
export const STATUS = {
  ok: ['b-pos', 'Op peil'],
  besteld: ['b-info', 'Besteld'],
  in_productie: ['b-info', 'In productie'],
  bestellen: ['b-warn', 'Onder minimum'],
  geen: ['b-neutral', 'Geen opvolging'],
};

// Eenheid bij een aantal: "1 rol" maar "2 rollen".
export const eenheid = (n, e) => (e === 'rollen' && Number(n) === 1 ? 'rol' : e);
