// Register van alle apps (startscherm-tegels + menu bovenaan).
// `klaar: false` → de tegel bestaat al, maar opent een "komt in stap X"-scherm.
export const APPS = [
  { id: 'dossiers',     naam: 'Dossiers',     icoon: 'map',      kleur: '#c2531a', klaar: true,
    menu: [['', 'Dossiers'], ['offertes', 'Offertes'], ['leveringen', 'Leveringen']] },
  { id: 'productie',    naam: 'Productie',    icoon: 'nozzle',   kleur: '#3a6ea8', klaar: true,
    menu: [['', 'Printers'], ['opdrachten', 'Printopdrachten'], ['runs', 'Runs']] },
  { id: 'inkoop',       naam: 'Inkoop',       icoon: 'kar',      kleur: '#6b7d3a', klaar: true,
    menu: [['aankopen', 'Aankopen'], ['inlezen', 'Factuur / bestelbon inlezen'], ['leveranciers', 'Leveranciers']] },
  { id: 'voorraad',     naam: 'Voorraad',     icoon: 'spoel',    kleur: '#8a5a2b', klaar: true,
    menu: [['artikelen', 'Artikelen'], ['te-bestellen', 'Te bestellen'], ['mutaties', 'Mutaties'], ['telling', 'Voorraadtelling'], ['categorieen', 'Categorieën']] },
  { id: 'klanten',      naam: 'Klanten',      icoon: 'mensen',   kleur: '#7a4f86', klaar: true,
    menu: [['', 'Klanten']] },
  { id: 'financien',    naam: 'Financiën',    icoon: 'euro',     kleur: '#2f7a6a', klaar: true,
    menu: [['overzicht', 'Overzicht'], ['opvolging', 'Opvolging'], ['marges', 'Marges'], ['statistieken', 'Statistieken'], ['import', 'Accountable-import']] },
  { id: 'instellingen', naam: 'Instellingen', icoon: 'tandwiel', kleur: '#5c5347', klaar: true,
    menu: [['', 'Instellingen']] },
];

export function appVoorPad(pathname) {
  const eerste = pathname.split('/').filter(Boolean)[0];
  return APPS.find(a => a.id === eerste) || null;
}
