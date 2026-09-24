import { useState } from 'react';
import { Dialoog } from '../../schil/Omgeving.jsx';
import { euro, naarInvoer, vandaag, datum as fmtDatum } from '../../lib/formaat.js';
import { klantNaam } from '../klanten/klant.js';

// Afrekening = VERWIJZING naar Accountable (domeinmodel, optie A): het ERP
// nummert zelf geen facturen of bonnetjes.
export function AfrekenDialoog({ dossier, onSluit, onBevestig }) {
  // Standaardbedrag = bedrag van de werkbon (offerteprijs bij een aanvaarde offerte, anders volgens de metingen).
  const totaal = dossier.werkbon?.bedrag ?? dossier.berekening.totaal;
  const [f, setF] = useState({ soort: 'factuur', nummer: '', datum: vandaag(), bedrag: naarInvoer(totaal) });
  const [bezig, setBezig] = useState(false);
  const zet = (k, w) => setF(x => ({ ...x, [k]: w }));
  async function ok() { setBezig(true); try { await onBevestig(f); } finally { setBezig(false); } }
  return (
    <Dialoog titel="Afrekenen in Accountable" onSluit={onSluit}
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !f.nummer.trim()} onClick={ok}>Afgerekend</button>
      </>}>
      <p className="note" style={{ marginTop: 0 }}>Maak de {f.soort === 'factuur' ? 'factuur' : 'het bonnetje'} in Accountable (gebruik de overnamefiche) en vul hier het nummer in dat Accountable gaf. De werkbon {dossier.werkbon?.weergave} wordt daarmee definitief.</p>
      {(dossier.lever_status === 'geen' || dossier.lever_status === 'deels') && (
        <div className="waarschuwing" style={{ margin: '0 0 12px' }}>Nog niet alles geleverd{dossier.lever_status === 'deels' ? ' (deels geleverd)' : ''}. Afrekenen kan, bv. als de klant al betaald heeft; lever daarna verder via het tabblad Leveringen.</div>
      )}
      <div className="fgrid">
        <div style={{ gridColumn: '1/-1' }}>
          <span className="lbl">Soort</span>
          <div className="seg" role="group" aria-label="Soort afrekening">
            <button type="button" aria-pressed={f.soort === 'factuur'} onClick={() => zet('soort', 'factuur')}>Factuur</button>
            <button type="button" aria-pressed={f.soort === 'bonnetje'} onClick={() => zet('soort', 'bonnetje')}>Bonnetje</button>
          </div>
          <div className="sub" style={{ marginTop: 4 }}>{f.soort === 'bonnetje' ? 'Een bonnetje staat meteen op betaald (dagontvangsten).' : 'Een factuur zet je later op betaald.'}</div>
        </div>
        <div><label htmlFor="af-nr">Nummer in Accountable</label><input id="af-nr" className="inp mono" value={f.nummer} onChange={e => zet('nummer', e.target.value)} autoFocus /></div>
        <div><label htmlFor="af-datum">Datum</label><input id="af-datum" type="date" className="inp" value={f.datum} onChange={e => zet('datum', e.target.value)} /></div>
        <div><label htmlFor="af-bedrag">Bedrag</label><div className="unit"><input id="af-bedrag" className="inp num" inputMode="decimal" value={f.bedrag} onChange={e => zet('bedrag', e.target.value)} /><span>€</span></div></div>
      </div>
    </Dialoog>
  );
}

export function BetaaldDialoog({ onSluit, onBevestig }) {
  const [d, setD] = useState(vandaag());
  return (
    <Dialoog titel="Betaald" onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" onClick={() => onBevestig(d)}>Betaald</button></>}>
      <label className="lbl" htmlFor="bt-datum">Betaald op</label>
      <input id="bt-datum" type="date" className="inp" value={d} onChange={e => setD(e.target.value)} autoFocus />
    </Dialoog>
  );
}

function Kopieer({ tekst }) {
  const [ok, setOk] = useState(false);
  if (!tekst) return null;
  return (
    <button type="button" className="btn ghost kopieer" aria-label={`Kopieer ${tekst}`}
      onClick={async () => { try { await navigator.clipboard.writeText(String(tekst)); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* geen klembord */ } }}>
      {ok ? 'Gekopieerd' : 'Kopieer'}
    </button>
  );
}

// Overnamefiche: alles wat je in Accountable moet overtypen, met een
// kopieerknop per waarde.
export function Overnamefiche({ dossier, onSluit }) {
  const k = dossier.klant_gegevens;
  const b = dossier.overname || { regels: [], totaal: null, vast: 0 };
  const adres = k ? [[k.straat, k.huisnummer].filter(Boolean).join(' '), [k.postcode, k.gemeente].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const klantRijen = k ? [
    ['Klant', klantNaam(k)], ['Adres', adres], ['Btw-nummer', k.btw_nummer], ['Peppol-ID', k.peppol_id], ['E-mail', k.email], ['Telefoon', k.gsm || k.telefoon],
  ].filter(([, v]) => v) : [];
  return (
    <Dialoog titel={`Overnamefiche ${dossier.nummer}`} onSluit={onSluit} breed
      voet={<button type="button" className="btn primary" onClick={onSluit}>Sluiten</button>}>
      <p className="note" style={{ marginTop: 0 }}>{dossier.werkbon ? `Volgens werkbon ${dossier.werkbon.weergave}${dossier.werkbon.definitief_op ? ' (definitief)' : ''}.` : 'Volgens de regels van het dossier (nog geen werkbon).'}</p>
      {k ? (
        <table className="mini overname">
          <tbody>{klantRijen.map(([l, v]) => <tr key={l}><th>{l}</th><td>{v}</td><td className="r"><Kopieer tekst={v} /></td></tr>)}</tbody>
        </table>
      ) : <p className="sub">Geen klant gekozen in dit dossier.</p>}
      <div className="tabelvak" style={{ marginTop: 14 }}>
        <table className="mini overname">
          <thead><tr><th>Omschrijving</th><th className="r">Aantal</th><th className="r">Prijs/stuk</th><th className="r">Bedrag</th><th><span className="sr-only">Kopieer</span></th></tr></thead>
          <tbody>
            {b.regels.map((r, i) => (
              <tr key={i}>
                <td>{r.omschrijving} <Kopieer tekst={r.omschrijving} /></td>
                <td className="r num">{r.aantal}</td>
                <td className="r num">{r.per_stuk != null ? euro(r.per_stuk) : '—'}</td>
                <td className="r num">{euro(r.bedrag)}</td>
                <td className="r"><Kopieer tekst={r.bedrag != null ? naarInvoer(r.bedrag) : ''} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={3}>Totaal</th><th className="r num">{euro(b.totaal)}</th><td className="r"><Kopieer tekst={naarInvoer(b.totaal)} /></td></tr></tfoot>
        </table>
      </div>
      <p className="note" style={{ marginBottom: 0 }}>Vrijgesteld van btw (art. 56bis). {b.vast > 0 && `Waarvan ${euro(b.vast)} vaste prijs (bv. verzending). `}Aangemaakt op {fmtDatum(dossier.aangemaakt_op)}.</p>
    </Dialoog>
  );
}
