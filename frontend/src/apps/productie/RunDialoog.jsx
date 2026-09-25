import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { Link } from '../../schil/Schil.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { datumTijd, naarInvoer } from '../../lib/formaat.js';
import { StatusBadge } from './PrintersLive.jsx';
import { KoppelDialoog, duur } from './opdracht.jsx';

// Het venster van één run (stap 6b; 25-09: apart bestand zodat het ook vanuit
// een printopdracht en vanuit het dossier opent). Koppelen, ontkoppelen,
// verbruik aanvullen, uitkomst of starttijd corrigeren.
export function Koppeling({ r }) {
  if (r.opdracht) return r.opdracht.dossier_id
    ? <span>{r.opdracht.naam} · <Link naar={`/dossiers/${r.opdracht.dossier_id}?tab=productie`}><span className="mono">{r.opdracht.dossier_nummer}</span></Link></span>
    : <span>{r.opdracht.naam}</span>;
  if (r.intern) return <span className="sub">{r.intern_label}</span>;
  return <span className="badge b-warn">Te koppelen</span>;
}

// datetime-local ↔ ISO (lokale tijd)
export const lokaal = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

export function RunDialoog({ run, onSluit, onKlaar }) {
  const { melding, bevestig } = useOmgeving();
  const [koppelen, setKoppelen] = useState(false);
  const [bezig, setBezig] = useState(false);
  // corrigeren (25-09): uitkomst en starttijd, zolang de printopdracht niet bevestigd is
  const [corr, setCorr] = useState(null);
  const vast = !!run.opdracht?.voltooid_op;
  async function doe(fn, tekst) {
    setBezig(true);
    try { await fn(); melding(tekst); await onKlaar(); } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  if (koppelen) return <KoppelDialoog run={run} onSluit={() => setKoppelen(false)} onKlaar={onKlaar} />;
  const aanvullen = run.uitkomst !== 'bezig' ? (run.onvolledig || run.kwh == null || run.kwh === 0) : run.onvolledig;
  return (
    <Dialoog titel={`Run · ${run.printer}`} onSluit={onSluit}
      voet={<>
        {run.bron === 'manueel' && run.uitkomst !== 'bezig' && !run.opdracht && <button type="button" className="btn ghost" disabled={bezig}
          onClick={async () => { if (await bevestig({ titel: 'Run verwijderen', tekst: 'Deze met de hand toegevoegde run verwijderen?', bevestigLabel: 'Verwijderen', gevaarlijk: true })) doe(() => api.delete(`/productie/runs/${run.id}`), 'Run verwijderd.'); }}>Verwijderen</button>}
        {(run.opdracht || run.intern) && <button type="button" className="btn ghost" disabled={bezig} onClick={() => doe(() => api.post(`/productie/runs/${run.id}/ontkoppel`), 'Koppeling verwijderd.')}>Ontkoppelen</button>}
        {aanvullen && <button type="button" className="btn" disabled={bezig} onClick={() => doe(() => api.post(`/productie/runs/${run.id}/aanvullen`), 'Verbruik aangevuld uit Home Assistant.')}>Verbruik aanvullen</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onSluit}>Sluiten</button>
        <button type="button" className={`btn ${run.te_koppelen ? 'primary' : ''}`} onClick={() => setKoppelen(true)}>{run.te_koppelen ? 'Koppelen' : 'Anders koppelen'}</button>
      </>}>
      <dl className="pwaarden">
        <dt>Bestand</dt><dd className="mono">{run.bestand || '—'}</dd>
        <dt>Gestart</dt><dd className="num">{datumTijd(run.gestart_op)}</dd>
        <dt>Duur</dt><dd className="num">{duur(run.duur_min)}</dd>
        <dt>Verbruik</dt><dd className="num">{naarInvoer(run.kwh) || '—'} kWh{run.onvolledig ? ' (onvolledig)' : run.aangevuld ? ' (aangevuld uit HA)' : ''}</dd>
        <dt>Uitkomst</dt><dd><StatusBadge status={run.uitkomst} /></dd>
        <dt>Hoort bij</dt><dd><Koppeling r={run} /></dd>
      </dl>
      {run.te_koppelen && run.voorstel && <p className="sub">Voorstel: {run.voorstel.naam}</p>}
      {!corr && (vast
        ? <p className="sub" style={{ marginBottom: 0 }}>De printopdracht is bevestigd: heropen ze om deze run nog te corrigeren.</p>
        : <button type="button" className="btn klein" onClick={() => setCorr({ uitkomst: run.uitkomst, gestart_op: lokaal(run.gestart_op) })}><Icoon naam="pen" maat={12} /> Uitkomst of starttijd corrigeren</button>)}
      {corr && (
        <div className="panel" style={{ marginTop: 8 }}><div className="pbody">
          <div className="fgrid">
            <div><label htmlFor="rc-uitkomst">Uitkomst</label>
              <select id="rc-uitkomst" className="inp" value={corr.uitkomst} disabled={run.uitkomst === 'bezig'} onChange={e => setCorr(c => ({ ...c, uitkomst: e.target.value }))}>
                {run.uitkomst === 'bezig' && <option value="bezig">Bezig</option>}
                <option value="klaar">Geslaagd</option><option value="mislukt">Mislukt</option><option value="geannuleerd">Geannuleerd</option>
              </select></div>
            <div><label htmlFor="rc-van">Gestart</label><input id="rc-van" type="datetime-local" className="inp" value={corr.gestart_op} onChange={e => setCorr(c => ({ ...c, gestart_op: e.target.value }))} /></div>
          </div>
          <p className="sub">Gestopt of mislukt telt niet op de werkbon, maar wel als kost voor jou. Een andere starttijd haalt het verbruik opnieuw uit Home Assistant.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setCorr(null)}>Terug</button>
            <button type="button" className="btn primary" disabled={bezig} onClick={async () => {
              setBezig(true);
              try {
                const body = { ...(run.uitkomst !== 'bezig' ? { uitkomst: corr.uitkomst } : {}),
                  ...(corr.gestart_op !== lokaal(run.gestart_op) ? { gestart_op: new Date(corr.gestart_op).toISOString() } : {}) };
                const r = await api.put(`/productie/runs/${run.id}`, body);
                melding(r.melding || (body.gestart_op && r.aangevuld ? `Run gecorrigeerd; verbruik opnieuw uit Home Assistant: ${naarInvoer(r.kwh)} kWh.` : 'Run gecorrigeerd.'), r.melding ? 'fout' : undefined);
                await onKlaar();
              } catch (e) { melding(e.message, 'fout'); setBezig(false); }
            }}>Bewaren</button>
          </div>
        </div></div>
      )}
    </Dialoog>
  );
}

// Run openen op id (vanuit een printopdracht of het dossier): haalt de run
// op en toont het run-venster.
export function RunVenster({ runId, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const [run, setRun] = useState(null);
  useEffect(() => {
    let weg = false;
    api.get(`/productie/runs/${runId}`).then(r => { if (!weg) setRun(r); }).catch(e => { melding(e.message, 'fout'); onSluit(); });
    return () => { weg = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
  if (!run) return null;
  return <RunDialoog run={run} onSluit={onSluit} onKlaar={onKlaar} />;
}
