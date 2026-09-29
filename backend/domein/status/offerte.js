// Status van een offerte, afgeleid uit datums (domeinmodel → "Statussen"):
// concept → verstuurd → aanvaard / geweigerd / verlopen. Een verstuurde
// versie waarvan er een nieuwere versie is, heet "vervangen".
export const OFFERTE_STATUS = {
  concept: 'Concept', verstuurd: 'Verstuurd', aanvaard: 'Aanvaard', geweigerd: 'Geweigerd', verlopen: 'Verlopen', vervangen: 'Vervangen',
};
// Datum van vandaag in België (29-09): niet UTC, anders is het tussen
// middernacht en 2 u 's nachts voor het ERP nog "gisteren" (en weigert het
// bv. een bonnetje van vandaag als "in de toekomst").
export const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });

export function offerteStatus(o, { nieuwereVersie = false, op = vandaag() } = {}) {
  if (o.aanvaard_op) return 'aanvaard';
  if (o.geweigerd_op) return 'geweigerd';
  if (!o.verstuurd_op) return 'concept';
  if (nieuwereVersie) return 'vervangen';
  if (o.geldig_tot && o.geldig_tot < op) return 'verlopen';
  return 'verstuurd';
}
