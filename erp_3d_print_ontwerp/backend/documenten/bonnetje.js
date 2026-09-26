// ═══════════════════════════════════════════════════════════════════════
// BONNETJE van het ERP (26-09) — gedeeld door "Bonnetje maken" op een dossier
// en de losse verkoop (tegel Verkoop).
// ═══════════════════════════════════════════════════════════════════════
// - PDF: titel "BONNETJE 2026-021", "Betaald op", btw-kolom 0 % en de
//   vermelding van art. 56bis (verplichte velden voor het dagontvangstenboek)
// - mail: ALTIJD naar Accountable (inkomsten@accountable.eu); optioneel naar
//   de klant, met Accountable in cc. Accountable krijgt elk bonnetje EXACT één
//   keer: een tweede mail zou een dubbele inkomst geven.
import { documentHtml, dmjDatum } from './sjabloon.js';
import { htmlNaarPdf } from './pdf.js';
import { verstuurMail, geldigAdres } from './mail.js';
import { DomeinFout } from '../domein/hulp.js';

export const accountableAdres = () => String(process.env.ACCOUNTABLE_INKOMSTEN || 'inkomsten@accountable.eu').trim();
export const afzender = () => String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim() || null;
export const kaalNummer = n => String(n ?? '').replace(/^bonnetje\s+/i, '');   // "Bonnetje 2026-020" → "2026-020"
export const DREMPEL_BONNETJE = 250;   // Accountable: boven € 250 per verkoop nagaan of een factuur nodig is
export const bonnetjeBestand = (nummer, extra = '') => `Bonnetje ${kaalNummer(nummer)}${extra}.pdf`.replace(/[^\w .-]/g, '_');
const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function bonnetjeHtml({ inhoud, nummer, datum, concept = false }) {
  return documentHtml({ soort: 'BONNETJE', nummer: kaalNummer(nummer), datum, concept, inhoud, btwKolom: true,
    info: [['Betaald op', dmjDatum(datum)]] });
}

// Mailt het bonnetje. Gooit een fout als er niets verstuurd kon worden; de
// oproeper bewaart daarna zelf WAT er verstuurd is (gemaild_op, klantadres).
// al_bij_accountable: werd het al naar Accountable gestuurd? (dan geweigerd)
export async function stuurBonnetje({ nummer, titel, bedrag, context, html, naar_klant, aan, onderwerp, tekst, naar_accountable, al_bij_accountable }) {
  if (!naar_klant && !naar_accountable) throw new DomeinFout('Kies naar wie het bonnetje moet.');
  if (naar_accountable && al_bij_accountable) throw new DomeinFout(`${nummer} werd al naar Accountable gemaild. Een tweede keer zou een dubbele inkomst geven.`);
  const klantAdres = String(aan ?? '').trim();
  if (naar_klant && !geldigAdres(klantAdres)) throw new DomeinFout('Vul een geldig e-mailadres van de klant in.');
  const acc = accountableAdres();
  const bijlage = { naam: bonnetjeBestand(nummer), inhoud: await htmlNaarPdf(html) };
  if (naar_klant) {
    await verstuurMail({ aan: klantAdres, cc: naar_accountable ? acc : null, onderwerp: String(onderwerp ?? '').trim() || `${nummer}${titel ? ` – ${titel}` : ''}`, tekst: tekst || '', bijlage });
  } else {
    await verstuurMail({ aan: acc, onderwerp: nummer, tekst: `${nummer} (${context}, ${euro(bedrag)}).`, bijlage });
  }
  return { klantAdres: naar_klant ? klantAdres : null, accountable: naar_accountable ? acc : null,
    tekst: `${nummer} gemaild naar ${[naar_klant && klantAdres, naar_accountable && `Accountable (${acc})`].filter(Boolean).join(' en ')}` };
}
