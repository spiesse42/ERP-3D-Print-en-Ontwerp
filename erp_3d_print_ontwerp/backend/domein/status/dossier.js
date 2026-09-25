// Fase van een dossier, AFGELEID uit gebeurtenissen met een datum
// (domeinmodel → "Statussen"). Nooit een los statusveld dat uit sync raakt.
// nieuw → offerte verstuurd → akkoord → in productie → klaar → deels
// geleverd → geleverd → afgerekend → betaald (of geannuleerd).
// `lever` = 'geen' | 'deels' | 'geleverd' | null (niets te leveren).
// `prod` = 'geen' | 'productie' | 'klaar' | null (geen printregels) — stap 6b:
// in productie zodra er een printopdracht is; klaar als elke printregel
// genoeg goede stuks heeft uit voltooide printopdrachten.
// `offerte` = de laatst verstuurde offerteversie (of null), `werkbon` = de
// werkbon van het dossier (of null).

export const FASES = {
  nieuw:       'Nieuw',
  offerte:     'Offerte verstuurd',
  akkoord:     'Akkoord',
  productie:   'In productie',
  klaar:       'Klaar',
  deels:       'Deels geleverd',
  geleverd:    'Geleverd',
  afgerekend:  'Afgerekend',
  betaald:     'Betaald',
  gratis:      'Gratis geleverd',
  geannuleerd: 'Geannuleerd',
};
const VOOR_AFREKENING = ['nieuw', 'offerte', 'akkoord', 'productie', 'klaar', 'deels', 'geleverd'];

export function faseVan(d, { offerte = null, lever = null, prod = null } = {}) {
  if (d.geannuleerd_op) return 'geannuleerd';
  if (d.betaald_op) return 'betaald';
  if (d.gratis_op) return 'gratis';
  if (d.afgerekend_op) return 'afgerekend';
  if (lever === 'geleverd') return 'geleverd';
  if (lever === 'deels') return 'deels';
  if (prod === 'klaar') return 'klaar';
  if (prod === 'productie') return 'productie';
  if (offerte?.aanvaard_op) return 'akkoord';
  if (offerte?.verstuurd_op && !offerte.geweigerd_op) return 'offerte';
  return 'nieuw';
}

// De stappen in de statusbalk. Eigen producten en interne dossiers worden
// niet afgerekend en krijgen geen offerte.
export function stappenVan(d, { lever = null, prod = null } = {}) {
  const print = prod ? ['productie', 'klaar'] : [];
  const einde = d.gratis_op ? ['gratis'] : ['afgerekend', 'betaald'];
  return d.soort === 'klant' ? ['nieuw', 'offerte', 'akkoord', ...print, lever === 'deels' ? 'deels' : 'geleverd', ...einde] : ['nieuw', ...print];
}

// Welke acties nu toegelaten zijn; de backend controleert ze, de frontend
// toont enkel de knoppen die hier "true" zijn.
export function actiesVan(d, { aantalRegels = 0, offerte = null, werkbon = null, verstuurdeOffertes = 0, lever = null, leveringen = 0, prod = null, printopdrachten = 0 } = {}) {
  const fase = faseVan(d, { offerte, lever, prod });
  const klant = d.soort === 'klant';
  const open = VOOR_AFREKENING.includes(fase);
  return {
    bewerken: open,                                           // kop + regels
    // nieuwe offerte(versie); ook als er al geprint wordt zonder akkoord
    offerte: klant && (fase === 'nieuw' || fase === 'offerte' || ((fase === 'productie' || fase === 'klaar') && !offerte?.aanvaard_op)),
    werkbon: open && !werkbon,
    // Starten (25-09): werkbon (klant) + printopdrachten; eenmalig
    starten: open && !d.gestart_op && aantalRegels > 0 && (klant || prod != null),
    // zonder werkbon maakt afrekenen hem eerst zelf aan (25-09)
    afrekenen: klant && open && aantalRegels > 0,
    // gratis geleverd (25-09): klant betaalt niets; geen omzet, wel kost in Marges
    gratis: klant && open && aantalRegels > 0,
    gratis_ongedaan: fase === 'gratis',
    betaald: fase === 'afgerekend',
    betaling_ongedaan: fase === 'betaald' && d.afgerekend_soort === 'factuur',
    afrekening_ongedaan: fase === 'afgerekend' || fase === 'betaald',
    annuleren: open && leveringen === 0,
    heropenen: fase === 'geannuleerd',
    verwijderen: (open || fase === 'geannuleerd') && verstuurdeOffertes === 0 && leveringen === 0 && printopdrachten === 0,
    // printopdracht plannen voor een printregel (Productie-tabblad); kan ook
    // na afrekenen (bv. betaald op de markt, nog te printen)
    printopdracht: fase !== 'geannuleerd',
    // leveren kan ook na afrekenen (bv. betaald op de markt, later geleverd)
    leveren: klant && fase !== 'geannuleerd' && (lever === 'geen' || lever === 'deels'),
  };
}
