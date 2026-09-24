import { useState } from 'react';
import { api, BASE } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { datum, naarInvoer, uitInvoer, vandaag, aantal as fmtAantal } from '../../lib/formaat.js';
import MailDialoog, { mailTekst } from './MailDialoog.jsx';

// Leveringen van een dossier (stap 5c): in meerdere keren, per regel en per
// aantal. Elke levering heeft een pakbon (zonder prijzen). Artikelen met
// voorraad worden bij levering FIFO uitgeboekt.
const openPdf = pad => window.open(new URL(`${BASE}${pad}`, document.baseURI).href, '_blank', 'noopener');

function LeverDialoog({ d, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const open = d.leverbaar.filter(x => x.rest > 0);
  const [f, setF] = useState({ datum: vandaag(), opmerking: '', aantallen: Object.fromEntries(open.map(x => [x.regel_id, naarInvoer(x.rest)])) });
  const [bezig, setBezig] = useState(false);
  const zetAantal = (id, w) => setF(x => ({ ...x, aantallen: { ...x.aantallen, [id]: w } }));
  const tekort = open.filter(x => x.boekt_voorraad && (uitInvoer(f.aantallen[x.regel_id]) || 0) > (x.voorraad ?? 0));
  async function ok() {
    setBezig(true);
    try {
      await api.post(`/dossiers/${d.id}/leveringen`, { datum: f.datum, opmerking: f.opmerking, regels: open.map(x => ({ regel_id: x.regel_id, aantal: f.aantallen[x.regel_id] })) });
      await onKlaar();
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  return (
    <Dialoog titel="Nieuwe levering" onSluit={onSluit} breed
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" disabled={bezig} onClick={ok}>Leveren</button></>}>
      <div className="fgrid">
        <div><label htmlFor="lv-datum">Leverdatum</label><input id="lv-datum" type="date" className="inp" value={f.datum} onChange={e => setF(x => ({ ...x, datum: e.target.value }))} /></div>
      </div>
      <div className="tabelvak" style={{ marginTop: 12 }}>
        <table className="mini leveren">
          <thead><tr><th>Wat</th><th className="r">Nog te leveren</th><th className="r">Nu leveren</th></tr></thead>
          <tbody>
            {open.map(x => (
              <tr key={x.regel_id}>
                <td>{x.omschrijving}{x.boekt_voorraad && <div className="sub">voorraad: {fmtAantal(x.voorraad)}</div>}</td>
                <td className="r num">{fmtAantal(x.rest)}</td>
                <td className="r"><input className="inp num" inputMode="decimal" aria-label={`Nu leveren ${x.omschrijving}`} value={f.aantallen[x.regel_id]} onChange={e => zetAantal(x.regel_id, e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tekort.length > 0 && <p className="regelfout">Onvoldoende voorraad voor {tekort.map(x => x.omschrijving).join(', ')}. Boek eerst de voorraad in (Voorraad → artikel) of lever minder.</p>}
      <label className="lbl" htmlFor="lv-opm" style={{ marginTop: 12 }}>Opmerking op de pakbon</label>
      <textarea id="lv-opm" className="inp" rows={2} value={f.opmerking} onChange={e => setF(x => ({ ...x, opmerking: e.target.value }))} placeholder="bv. Rest volgt volgende week" />
      <p className="note" style={{ marginBottom: 0 }}>Laat een aantal leeg of op 0 om die regel nu niet te leveren. Artikelen met voorraad worden bij het leveren uitgeboekt.</p>
    </Dialoog>
  );
}

export default function LeveringenTab({ d, vuil, herlaad, bedrijf }) {
  const { melding, bevestig } = useOmgeving();
  const [nieuw, setNieuw] = useState(false);
  const [mail, setMail] = useState(null);
  async function ongedaan(l) {
    if (!await bevestig({ titel: 'Levering ongedaan maken', tekst: `Levering ${l.nummer} (${datum(l.datum)}) ongedaan maken? Artikelen gaan terug in voorraad. Het pakbonnummer wordt niet opnieuw gebruikt.`, bevestigLabel: 'Ongedaan maken', annuleerLabel: 'Terug', gevaarlijk: true })) return;
    try { await api.delete(`/leveringen/${l.id}`); await herlaad(); melding('Levering ongedaan gemaakt.'); }
    catch (e) { melding(e.message, 'fout'); }
  }
  if (!d.leverbaar.length) return <p className="sub">Er is niets te leveren: voeg print- of artikelregels toe. (Diensten zoals verzending en ontwerp worden niet geleverd.)</p>;
  return (
    <>
      <div className="tabelvak">
        <table className="mini">
          <thead><tr><th>Wat</th><th className="r">Besteld</th><th className="r">Geleverd</th><th className="r">Nog te leveren</th></tr></thead>
          <tbody>
            {d.leverbaar.map(x => (
              <tr key={x.regel_id}>
                <td>{x.omschrijving}</td>
                <td className="r num">{fmtAantal(x.besteld)}</td>
                <td className="r num">{fmtAantal(x.geleverd)}</td>
                <td className="r num">{x.rest > 0 ? <b>{fmtAantal(x.rest)}</b> : <span className="badge b-pos">klaar</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.acties.leveren && (
        <button type="button" className="btn primary" style={{ margin: '12px 0' }} disabled={vuil}
          onClick={() => (vuil ? melding('Sla eerst je wijzigingen op.', 'fout') : setNieuw(true))}>
          <Icoon naam="plus" maat={14} /> Nieuwe levering
        </button>
      )}
      <div className="doc-lijst" style={{ marginTop: 8 }}>
        {[...d.leveringen].reverse().map(l => (
          <div className="doc-kaart" key={l.id}>
            <div className="doc-kop"><span><b className="mono">{l.nummer}</b> <span className="sub">{datum(l.datum)}</span></span></div>
            <div className="sub">{l.regels.map(r => `${fmtAantal(r.aantal)} × ${r.omschrijving}`).join(' · ')}</div>
            {l.opmerking && <div className="sub">Opmerking: {l.opmerking}</div>}
            <div className="doc-knoppen">
              <button type="button" className="btn" onClick={() => openPdf(`/leveringen/${l.id}/pdf`)}><Icoon naam="lijst" maat={14} /> Pakbon</button>
              <button type="button" className="btn" onClick={() => setMail(l)}>Mailen</button>
              {l.laatste && <button type="button" className="btn ghost" onClick={() => ongedaan(l)}>Ongedaan maken</button>}
            </div>
          </div>
        ))}
      </div>
      {nieuw && <LeverDialoog d={d} onSluit={() => setNieuw(false)} onKlaar={async () => { setNieuw(false); await herlaad(); melding('Geleverd.'); }} />}
      {mail && <MailDialoog titel={`Pakbon ${mail.nummer} mailen`} aan={d.klant_gegevens?.email}
        onderwerp={`Pakbon ${mail.nummer} – ${d.titel}`} tekst={mailTekst({ klant: d.klant_gegevens, bedrijf, wat: 'de pakbon', titel: d.titel })}
        onSluit={() => setMail(null)}
        onVerstuur={async f => {
          try { await api.post(`/leveringen/${mail.id}/mail`, f); await herlaad(); melding(`Pakbon gemaild naar ${f.aan}.`); setMail(null); }
          catch (e) { melding(e.message, 'fout'); }
        }} />}
    </>
  );
}
