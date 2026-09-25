import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { datumTijd, naarInvoer, aantal } from '../../lib/formaat.js';
import { StatusBadge } from './PrintersLive.jsx';
import { KoppelDialoog, duur } from './opdracht.jsx';

// Productie → Runs: elke print die de printerwachter zag (of die je manueel
// startte of toevoegde), met duur en gemeten kWh (stap 6a). Stap 6b: runs
// koppelen aan een printopdracht of als intern markeren, een gemiste run
// toevoegen en het verbruik aanvullen uit de geschiedenis van Home Assistant.
export function Koppeling({ r }) {
  if (r.opdracht) return r.opdracht.dossier_id
    ? <span>{r.opdracht.naam} · <Link naar={`/dossiers/${r.opdracht.dossier_id}?tab=productie`}><span className="mono">{r.opdracht.dossier_nummer}</span></Link></span>
    : <span>{r.opdracht.naam}</span>;
  if (r.intern) return <span className="sub">{r.intern_label}</span>;
  return <span className="badge b-warn">Te koppelen</span>;
}

// datetime-local ↔ ISO (lokale tijd)
const lokaal = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

function RunToevoegen({ onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const { data: printers } = useData('/printers');
  const [f, setF] = useState({ printer_id: '', gestart_op: lokaal(Date.now() - 3 * 3600e3), geeindigd_op: lokaal(Date.now()), uitkomst: 'klaar', bestand: '', kwh: '' });
  const [bezig, setBezig] = useState(false);
  const zet = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const p = (printers || []).find(x => String(x.id) === f.printer_id);
  async function ok() {
    setBezig(true);
    try {
      const r = await api.post('/productie/runs', { ...f, printer_id: Number(f.printer_id), gestart_op: new Date(f.gestart_op).toISOString(), geeindigd_op: new Date(f.geeindigd_op).toISOString() });
      melding(r.melding || (r.aangevuld ? `Run toegevoegd; ${naarInvoer(r.kwh)} kWh uit de geschiedenis van Home Assistant.` : 'Run toegevoegd.'), r.melding ? 'fout' : undefined);
      await onKlaar(r);
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  return (
    <Dialoog titel="Gemiste run toevoegen" onSluit={onSluit} breed
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" disabled={bezig || !f.printer_id} onClick={ok}>Toevoegen</button></>}>
      <div className="fgrid">
        <div><label htmlFor="rt-printer">Printer</label>
          <select id="rt-printer" className="inp" value={f.printer_id} onChange={zet('printer_id')}>
            <option value="">— kies —</option>
            {(printers || []).filter(x => x.actief).map(x => <option key={x.id} value={x.id}>{x.naam}</option>)}
          </select></div>
        <div><label htmlFor="rt-uitkomst">Uitkomst</label>
          <select id="rt-uitkomst" className="inp" value={f.uitkomst} onChange={zet('uitkomst')}>
            <option value="klaar">Geslaagd</option><option value="mislukt">Mislukt</option><option value="geannuleerd">Geannuleerd</option>
          </select></div>
        <div><label htmlFor="rt-van">Gestart</label><input id="rt-van" type="datetime-local" className="inp" value={f.gestart_op} onChange={zet('gestart_op')} /></div>
        <div><label htmlFor="rt-tot">Geëindigd</label><input id="rt-tot" type="datetime-local" className="inp" value={f.geeindigd_op} onChange={zet('geeindigd_op')} /></div>
        <div><label htmlFor="rt-bestand">Bestand (optioneel)</label><input id="rt-bestand" className="inp" value={f.bestand} onChange={zet('bestand')} /></div>
        <div><label htmlFor="rt-kwh">kWh (optioneel)</label><input id="rt-kwh" className="inp num" inputMode="decimal" value={f.kwh} onChange={zet('kwh')} placeholder={p?.kwh_entity ? 'uit Home Assistant' : '—'} /></div>
      </div>
      <p className="note" style={{ marginBottom: 0 }}>Voor een print die de printerwachter niet zag (bv. de backend stond uit). Heeft de printer een kWh-meter in Home Assistant en laat je kWh leeg, dan haalt het ERP de meterstanden op het start- en eindtijdstip uit de geschiedenis.</p>
    </Dialoog>
  );
}

function RunDialoog({ run, onSluit, onKlaar }) {
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

export default function RunsLijst() {
  const [params, setParams] = useSearchParams();
  const teKoppelen = params.get('te_koppelen') === '1';
  const { data, fout, laden, herlaad } = useData('/productie/runs');
  const [printer, setPrinter] = useState(null);
  const [zoek, setZoek] = useState('');
  const [dialoog, setDialoog] = useState(null);   // { soort: 'run', run } | { soort: 'toevoegen' }
  const printers = [...new Set((data || []).map(r => r.printer))];
  const rijen = useMemo(() => (data || []).filter(r => (!printer || r.printer === printer) && (!teKoppelen || r.te_koppelen)
    && (!zoek.trim() || `${r.bestand || ''} ${r.opdracht?.naam || ''} ${r.opdracht?.dossier_nummer || ''}`.toLowerCase().includes(zoek.trim().toLowerCase()))), [data, printer, zoek, teKoppelen]);
  const aantalTeKoppelen = (data || []).filter(r => r.te_koppelen).length;
  const kolommen = [
    { kop: 'Gestart', cel: r => <span className="num">{datumTijd(r.gestart_op)}</span> },
    { kop: 'Printer', cel: r => r.printer },
    { kop: 'Bestand', cel: r => <span className="mono">{r.bestand || '—'}</span> },
    { kop: 'Hoort bij', cel: r => <Koppeling r={r} /> },
    { kop: 'Duur', klasse: 'r', cel: r => <span className="num">{duur(r.duur_min)}</span> },
    { kop: 'kWh', klasse: 'r', cel: r => <span className="num">{naarInvoer(r.kwh)}{r.onvolledig ? ' *' : r.aangevuld ? ' †' : ''}</span> },
    { kop: 'Gewicht', klasse: 'r', cel: r => <span className="num">{r.gewicht_g != null ? `${aantal(r.gewicht_g)} g` : '—'}</span> },
    { kop: 'Uitkomst', cel: r => <StatusBadge status={r.uitkomst} /> },
  ];
  const zetTeKoppelen = aan => { const p = new URLSearchParams(params); if (aan) p.set('te_koppelen', '1'); else p.delete('te_koppelen'); setParams(p, { replace: true }); };
  const klaar = async () => { setDialoog(null); await herlaad(); };
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Runs' }]} zoek={zoek} onZoek={setZoek}
        acties={<button type="button" className="btn" onClick={() => setDialoog({ soort: 'toevoegen' })}><Icoon naam="plus" maat={14} /> Run toevoegen</button>}
        facetten={printer ? [{ label: printer, onWeg: () => setPrinter(null) }] : []}
        filters={<>
          <Chip aan={teKoppelen} onClick={() => zetTeKoppelen(!teKoppelen)}>Te koppelen{aantalTeKoppelen ? ` (${aantalTeKoppelen})` : ''}</Chip>
          {printers.map(n => <Chip key={n} aan={printer === n} onClick={() => setPrinter(x => (x === n ? null : n))}>{n}</Chip>)}
        </>}
        teller={data ? `${rijen.length} / ${data.length}` : null} />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={r => r.id} onOpen={r => setDialoog({ soort: 'run', run: r })}
          kaart={r => ({ titel: r.bestand || r.printer, rechts: <StatusBadge status={r.uitkomst} />, regel: `${r.printer} · ${datumTijd(r.gestart_op)}`, onder: `${duur(r.duur_min)} · ${naarInvoer(r.kwh)} kWh`, badge: <Koppeling r={r} /> })}
          leeg={teKoppelen ? <><b>Niets te koppelen.</b>Alle runs horen bij een printopdracht of zijn als intern gemarkeerd.</> : <><b>Nog geen runs.</b>Zodra een gekoppelde printer begint te printen, verschijnt hier een run.</>} />
      )}
      <p className="note" style={{ margin: '8px 16px' }}>* onvolledig: de print liep al voor de printerwachter hem zag; open de run en kies "Verbruik aanvullen". † verbruik aangevuld uit de geschiedenis van Home Assistant.</p>
      {dialoog?.soort === 'run' && <RunDialoog run={dialoog.run} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'toevoegen' && <RunToevoegen onSluit={() => setDialoog(null)} onKlaar={klaar} />}
    </>
  );
}
