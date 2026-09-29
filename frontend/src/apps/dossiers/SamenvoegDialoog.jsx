import { useState } from 'react';
import { useData } from '../../schil/useData.js';
import { Dialoog } from '../../schil/Omgeving.jsx';
import { euro } from '../../lib/formaat.js';
import { FaseBadge, VOOR_AFREKENING } from './dossier.jsx';

// Dossiers samenvoegen (29-09): andere OPEN dossiers van dezelfde klant (en
// hetzelfde soort) in dit dossier. Hun regels, printopdrachten, runs,
// leveringen, bijlagen en notities komen hierbij; zij worden "Samengevoegd"
// en gearchiveerd. De backend controleert alles opnieuw (bv. een aanvaarde
// offerte).
export default function SamenvoegDialoog({ d, onSluit, onBevestig }) {
  const { data: lijst } = useData('/dossiers');
  const [gekozen, setGekozen] = useState([]);
  const [bezig, setBezig] = useState(false);
  const kandidaten = (lijst || []).filter(x => x.id !== d.id && x.soort === d.soort && (x.klant_id ?? null) === (d.klant_id ?? null)
    && VOOR_AFREKENING.includes(x.fase));
  const wissel = id => setGekozen(g => (g.includes(id) ? g.filter(x => x !== id) : [...g, id]));
  async function bevestig() {
    setBezig(true);
    if (!await onBevestig(gekozen)) setBezig(false);
  }
  return (
    <Dialoog titel={`Samenvoegen in ${d.nummer}`} breed onSluit={onSluit}
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Terug</button>
        <button type="button" className="btn primary" disabled={!gekozen.length || bezig} onClick={bevestig}>
          {gekozen.length > 1 ? `${gekozen.length} dossiers samenvoegen` : 'Samenvoegen'}
        </button>
      </>}>
      <p style={{ marginTop: 0 }}>Kies de dossiers {d.klant ? <>van <b>{d.klant}</b> </> : ''}die in <b>{d.nummer} "{d.titel}"</b> opgaan.
        Hun regels (met printopdrachten en runs), leveringen, foto's, bijlagen en notities komen hierbij. De gekozen dossiers krijgen de fase <b>Samengevoegd</b> en worden gearchiveerd.</p>
      {lijst === null ? <p className="sub">Laden…</p> : !kandidaten.length ? (
        <p className="sub">Er zijn geen andere open dossiers {d.klant ? 'van deze klant' : 'zonder klant'} (van dit soort) om samen te voegen.</p>
      ) : (
        <div className="tabelvak">
          <table className="mini">
            <thead><tr><th /><th>Dossier</th><th>Titel</th><th>Fase</th><th className="r">Totaal</th></tr></thead>
            <tbody>
              {kandidaten.map(x => (
                <tr key={x.id} className="row" onClick={() => wissel(x.id)}>
                  <td><input type="checkbox" checked={gekozen.includes(x.id)} aria-label={`${x.nummer} samenvoegen`} onChange={() => wissel(x.id)} onClick={e => e.stopPropagation()} /></td>
                  <td className="mono">{x.nummer}</td>
                  <td>{x.titel}</td>
                  <td><FaseBadge fase={x.fase} /></td>
                  <td className="r num">{x.volledig ? euro(x.totaal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">Heeft een van de dossiers een <b>aanvaarde offerte</b>, maak dan eerst het antwoord ongedaan (tab Offertes): anders zou de werkbon enkel de offerteprijs aanrekenen. Maak na het samenvoegen een nieuwe offerte voor het geheel.</p>
    </Dialoog>
  );
}
