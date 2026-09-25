import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import { euro, datum } from '../../lib/formaat.js';

// Financiën → Accountable-import (stap 7): de Excel-export (of een CSV) van
// Accountable inlezen om de betaald-status van de afgerekende dossiers bij te
// werken. De kolommen stelt het ERP voor; jij kijkt ze na. Pas na
// "Toepassen" verandert er iets. Aankoopfacturen (UBL) lees je in via
// Inkoop → Factuur inlezen.
const STATUS = {
  betalen: ['b-pos', 'Wordt betaald'], open: ['b-neutral', 'Nog open'], in_orde: ['b-neutral', 'In orde'], niet_gevonden: ['b-warn', 'Geen dossier'],
};
const toon = v => (v == null ? '' : String(v));

export default function AccountableImport() {
  const { melding, navigeer } = useOmgeving();
  const [bestand, setBestand] = useState(null);    // antwoord van het inlezen
  const [blad, setBlad] = useState(0);
  const [kolommen, setKolommen] = useState({});
  const [resultaat, setResultaat] = useState(null);
  const [kies, setKies] = useState(new Set());
  const [bezig, setBezig] = useState(false);
  const b = bestand?.bladen[blad];

  async function lees(f) {
    if (!f) return;
    setBezig(true); setResultaat(null);
    try {
      const fd = new FormData(); fd.append('bestand', f);
      const r = await api.upload('/financien/accountable', fd);
      setBestand(r); setBlad(0); setKolommen(r.bladen[0].voorstel);
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  function kiesBlad(i) { setBlad(i); setKolommen(bestand.bladen[i].voorstel); setResultaat(null); }
  async function vergelijk() {
    setBezig(true);
    try {
      const v = await api.post(`/financien/accountable/${bestand.token}/vergelijk`, { blad, kolommen });
      setResultaat(v); setKies(new Set(v.rijen.filter(r => r.status === 'betalen').map(r => r.dossier.id)));
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function toepassen() {
    setBezig(true);
    try {
      const r = await api.post(`/financien/accountable/${bestand.token}/toepassen`, { blad, kolommen, dossier_ids: [...kies] });
      melding(`${r.betaald} dossier${r.betaald === 1 ? '' : 's'} als betaald gemarkeerd.`);
      setBestand(null); setResultaat(null);
      navigeer('/financien/opvolging');
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  const betalen = useMemo(() => (resultaat?.rijen || []).filter(r => r.status === 'betalen'), [resultaat]);
  const wissel = id => setKies(k => { const n = new Set(k); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Accountable-import' }]} />
      <div className="fin">
        <div className="panel"><h3>1. Export inlezen</h3>
          <div className="pbody">
            <label className="btn" style={{ cursor: 'pointer' }}>
              {bezig && !bestand ? 'Lezen…' : bestand ? 'Ander bestand kiezen' : 'Excel (.xlsx) of CSV kiezen'}
              <input type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Export van Accountable" onChange={e => { lees(e.target.files[0]); e.target.value = ''; }} />
            </label>
            {bestand && <span className="sub" style={{ marginLeft: 10 }}>{bestand.bestandsnaam}</span>}
            <p className="note" style={{ marginBottom: 0 }}>Exporteer in Accountable de lijst met je facturen/inkomsten naar Excel. Het ERP koppelt elke rij op het <b>nummer</b> aan het dossier waar je dat nummer bij het afrekenen invulde, en zet dossiers die in de export betaald zijn ook hier op betaald. Aankoopfacturen (UBL) lees je in via <Link naar="/inkoop/inlezen">Inkoop → Factuur / bestelbon inlezen</Link>.</p>
          </div>
        </div>
        {b && (
          <div className="panel"><h3>2. Kolommen nakijken</h3>
            <div className="pbody" style={{ display: 'grid', gap: 12 }}>
              {bestand.bladen.length > 1 && (
                <div><label className="lbl" htmlFor="ac-blad">Werkblad</label>
                  <select id="ac-blad" className="inp" value={blad} onChange={e => kiesBlad(Number(e.target.value))}>
                    {bestand.bladen.map(x => <option key={x.index} value={x.index}>{x.naam} ({x.aantal} rijen)</option>)}
                  </select></div>
              )}
              <div className="mapping">
                {Object.entries(bestand.velden).map(([veld, label]) => (
                  <div key={veld}><label htmlFor={`ac-${veld}`}>{label}{veld === 'nummer' ? ' *' : ''}</label>
                    <select id={`ac-${veld}`} className="inp" value={kolommen[veld] ?? ''} onChange={e => { setKolommen(k => ({ ...k, [veld]: e.target.value === '' ? undefined : Number(e.target.value) })); setResultaat(null); }}>
                      <option value="">— niet gebruiken —</option>
                      {b.koppen.map((k, i) => <option key={i} value={i}>{k}</option>)}
                    </select></div>
                ))}
              </div>
              <p className="sub" style={{ margin: 0 }}>Betaald wordt bepaald door de betaaldatum, anders de kolom "openstaand bedrag" (0 = betaald), anders de status-kolom (ja / betaald / paid = betaald).</p>
              <div className="scroll-x">
                <table className="mini"><thead><tr>{b.koppen.map((k, i) => <th key={i}>{k}</th>)}</tr></thead>
                  <tbody>{b.voorbeeld.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{toon(c)}</td>)}</tr>)}</tbody></table>
              </div>
              <div><button type="button" className="btn primary" disabled={bezig || kolommen.nummer == null} onClick={vergelijk}>Vergelijken</button></div>
            </div>
          </div>
        )}
        {resultaat && (
          <div className="panel"><h3>3. Nakijken en toepassen</h3>
            <div className="pbody" style={{ display: 'grid', gap: 12 }}>
              <div className="jaarkeuze">
                <span className="badge b-pos">{resultaat.telling.betalen} wordt betaald</span>
                <span className="badge b-neutral">{resultaat.telling.open} nog open</span>
                <span className="badge b-neutral">{resultaat.telling.in_orde} in orde</span>
                <span className="badge b-warn">{resultaat.telling.niet_gevonden} zonder dossier</span>
              </div>
              <div className="scroll-x">
                <table className="mini">
                  <thead><tr><th /><th>Nummer</th><th>Datum</th><th className="r">Bedrag</th><th>Dossier</th><th>Status</th></tr></thead>
                  <tbody>{resultaat.rijen.map(r => (
                    <tr key={r.rij}>
                      <td>{r.status === 'betalen' && <input type="checkbox" aria-label={`${r.nummer} als betaald markeren`} checked={kies.has(r.dossier.id)} onChange={() => wissel(r.dossier.id)} />}</td>
                      <td className="mono">{r.nummer}</td><td className="num">{datum(r.datum)}</td>
                      <td className="r num">{euro(r.bedrag)}{r.bedrag_verschilt && <div className="sub neg">ERP: {euro(r.dossier.afgerekend_bedrag)}</div>}</td>
                      <td>{r.dossier ? <Link naar={`/dossiers/${r.dossier.id}`}><span className="mono">{r.dossier.nummer}</span></Link> : <span className="sub">—</span>}{r.dossier?.titel ? ` · ${r.dossier.titel}` : ''}</td>
                      <td><span className={`badge ${STATUS[r.status][0]}`}>{STATUS[r.status][1]}</span>{r.status === 'betalen' && r.betaald_op && <span className="sub"> op {datum(r.betaald_op)}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {resultaat.ontbreekt_in_export.length > 0 && (
                <div className="waarschuwing" style={{ margin: 0, display: 'block' }}>
                  <b>Afgerekend in het ERP maar niet in deze export</b> ({datum(resultaat.periode.van)} – {datum(resultaat.periode.tot)}):{' '}
                  {resultaat.ontbreekt_in_export.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link naar={`/dossiers/${d.id}`}>{d.afgerekend_nummer}</Link></span>)}. Klopt het nummer in het dossier?
                </div>
              )}
              <div><button type="button" className="btn primary" disabled={bezig || !betalen.some(r => kies.has(r.dossier.id))} onClick={toepassen}>
                Toepassen ({betalen.filter(r => kies.has(r.dossier.id)).length} als betaald)</button></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
