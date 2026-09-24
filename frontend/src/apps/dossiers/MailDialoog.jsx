import { useState } from 'react';
import { Dialoog } from '../../schil/Omgeving.jsx';

// E-mail met het document als PDF-bijlage. De afzender en het wachtwoord
// komen uit de add-on-configuratie (SMTP_USER/SMTP_PASS), nooit uit de app.
export default function MailDialoog({ titel, aan, onderwerp, tekst, waarschuwing, onSluit, onVerstuur }) {
  const [f, setF] = useState({ aan: aan || '', onderwerp, tekst });
  const [bezig, setBezig] = useState(false);
  const zet = (k, w) => setF(x => ({ ...x, [k]: w }));
  async function ok() { setBezig(true); try { await onVerstuur(f); } finally { setBezig(false); } }
  return (
    <Dialoog titel={titel} onSluit={onSluit} breed
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !f.aan.trim()} onClick={ok}>{bezig ? 'Bezig…' : 'Versturen'}</button>
      </>}>
      {waarschuwing && <p className="note" style={{ marginTop: 0 }}>{waarschuwing}</p>}
      <div className="fgrid">
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="ml-aan">Aan</label><input id="ml-aan" type="email" className="inp" value={f.aan} onChange={e => zet('aan', e.target.value)} /></div>
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="ml-ond">Onderwerp</label><input id="ml-ond" className="inp" value={f.onderwerp} onChange={e => zet('onderwerp', e.target.value)} /></div>
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="ml-tekst">Bericht</label><textarea id="ml-tekst" className="inp" rows={7} value={f.tekst} onChange={e => zet('tekst', e.target.value)} /></div>
      </div>
      <p className="note" style={{ marginBottom: 0 }}>De PDF wordt als bijlage meegestuurd.</p>
    </Dialoog>
  );
}

// Standaardtekst voor een mail aan de klant.
export function mailTekst({ klant, bedrijf, wat, titel }) {
  const naam = klant?.voornaam || (klant?.type === 'zakelijk' ? '' : klant?.naam) || '';
  return `Beste${naam ? ` ${naam}` : ''},\n\nIn bijlage vind je ${wat} voor "${titel}".\n\nMet vriendelijke groeten,\n${bedrijf || ''}`.trim();
}
