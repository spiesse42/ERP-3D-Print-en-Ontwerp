// Status van een offerte, afgeleid uit datums (domeinmodel → "Statussen"):
// concept → verstuurd → aanvaard / geweigerd / verlopen. Een verstuurde
// versie waarvan er een nieuwere versie is, heet "vervangen".
export const OFFERTE_STATUS = {
  concept: 'Concept', verstuurd: 'Verstuurd', aanvaard: 'Aanvaard', geweigerd: 'Geweigerd', verlopen: 'Verlopen', vervangen: 'Vervangen',
};
export const vandaag = () => new Date().toISOString().slice(0, 10);

export function offerteStatus(o, { nieuwereVersie = false, op = vandaag() } = {}) {
  if (o.aanvaard_op) return 'aanvaard';
  if (o.geweigerd_op) return 'geweigerd';
  if (!o.verstuurd_op) return 'concept';
  if (nieuwereVersie) return 'vervangen';
  if (o.geldig_tot && o.geldig_tot < op) return 'verlopen';
  return 'verstuurd';
}
