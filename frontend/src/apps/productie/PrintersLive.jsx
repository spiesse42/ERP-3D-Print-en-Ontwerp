import { useEffect, useState } from 'react';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { aantal, naarInvoer, datumTijd } from '../../lib/formaat.js';
import { KoppelDialoog, OpdrachtBadge, OpdrachtDialoog, BevestigDialoog, PlaatBadge, PlaatBevestigDialoog } from './opdracht.jsx';
import RolLeegDialoog from './RolLeeg.jsx';

// Productie → Printers (stap 6a): de VOLLEDIGE printerkaarten met live
// gegevens. Vaste afspraak: dit is de enige plek met alle telemetrie; het
// startscherm toont enkel een korte teller. De gegevens komen van de
// printerwachter in de backend (/api/productie/live), niet rechtstreeks van HA.
export const STATUS = {
  bezig: ['b-info', 'Bezig'], pauze: ['b-warn', 'Pauze'], klaar: ['b-pos', 'Klaar'], vrij: ['b-neutral', 'Vrij'],
  mislukt: ['b-crit', 'Mislukt'], geannuleerd: ['b-crit', 'Geannuleerd'], offline: ['b-neutral', 'Offline'], onbekend: ['b-neutral', 'Onbekend'],
};
export function StatusBadge({ status }) { const [k, l] = STATUS[status] || STATUS.onbekend; return <span className={`badge ${k}`}>{l}</span>; }
const url = pad => new URL(`${BASE}${pad}`, document.baseURI).href;
const tijd = min => (min == null ? '—' : min >= 60 ? `${Math.floor(min / 60)} u ${String(Math.round(min % 60)).padStart(2, '0')}` : `${Math.round(min)} min`);

function Camera({ id }) {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const k = setInterval(() => setT(Date.now()), 5000); return () => clearInterval(k); }, []);
  return <img className="camera" alt="Camerabeeld" src={url(`/productie/printers/${id}/camera?t=${t}`)} />;
}

// 09-11: wachtrij van de printer: runs die nog gekoppeld moeten worden en de
// open printopdrachten (bezig, te bevestigen, gepland) in volgorde. Koppelen
// en bevestigen kan hier meteen; de tabbladen Printopdrachten en Runs blijven.
const MAX_WACHTRIJ = 6;
function Wachtrij({ p, opdrachten, runs, verberg, herlaad }) {
  const [dialoog, setDialoog] = useState(null);
  const klaar = async () => { setDialoog(null); await herlaad(); };
  const mijn = (opdrachten || []).filter(o => o.printer_id === p.id);
  const teKoppelen = (runs || []).filter(r => r.printer_id === p.id && r.id !== verberg);
  const toon = mijn.slice(0, MAX_WACHTRIJ);
  return (
    <div className="pwachtrij" aria-label={`Wachtrij ${p.naam}`}>
      <div className="pwachtrij-kop"><b>Wachtrij</b><span className="sub">{mijn.length ? `${mijn.length} open` : 'leeg'}</span></div>
      {teKoppelen.map(r => (
        <div key={`r${r.id}`} className="prij te-koppelen-rij">
          <span className="badge b-warn">Te koppelen</span>
          <span className="pnaam">{r.bestand ? <span className="mono">{r.bestand}</span> : 'Run'}<span className="sub"> · {datumTijd(r.gestart_op)} · {tijd(r.duur_min)}</span></span>
          <button type="button" className="btn klein primary" onClick={() => setDialoog({ soort: 'koppel', run: r })}>Koppelen</button>
        </div>
      ))}
      {toon.map(o => (
        <div key={o.id} className="prij klikbaar" role="button" tabIndex={0} title="Printopdracht openen"
          onClick={() => setDialoog({ soort: 'open', o })} onKeyDown={e => { if (e.key === 'Enter') setDialoog({ soort: 'open', o }); }}>
          <OpdrachtBadge status={o.status} />
          <span className="pnaam">{o.naam}<PlaatBadge o={o} />
            <span className="sub"> · {aantal(o.aantal)} st.{o.dossier_nummer ? <> · <Link naar={`/dossiers/${o.dossier_id}?tab=productie`}><span className="mono">{o.dossier_nummer}</span></Link></> : ''}</span></span>
          {(o.status === 'te_bevestigen' || o.status === 'mislukt') && o.runs.some(r => r.uitkomst === 'klaar') && (
            <button type="button" className="btn klein primary" onClick={e => { e.stopPropagation(); setDialoog({ soort: o.plaat ? 'plaat' : 'bevestig', o }); }}>Bevestigen</button>
          )}
        </div>
      ))}
      {mijn.length > MAX_WACHTRIJ && <div className="sub"><Link naar="/productie/opdrachten">nog {mijn.length - MAX_WACHTRIJ} in de wachtrij</Link></div>}
      {!mijn.length && !teKoppelen.length && <div className="sub">Geen geplande printopdrachten. <Link naar="/productie/opdrachten">Printopdrachten</Link></div>}
      {dialoog?.soort === 'koppel' && <KoppelDialoog run={{ ...dialoog.run, printer: p.naam, printer_id: p.id }} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'open' && <OpdrachtDialoog opdracht={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'bevestig' && <BevestigDialoog o={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'plaat' && <PlaatBevestigDialoog o={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
    </div>
  );
}

function PrinterKaart({ p, herlaad, opdrachten, runs }) {
  const { melding, bevestig } = useOmgeving();
  const [camera, setCamera] = useState(false);
  const [stop, setStop] = useState(false);
  const [koppel, setKoppel] = useState(null);   // run om te koppelen
  const [rolLeeg, setRolLeeg] = useState(false);
  const l = p.lezing;
  // de lopende run, of anders de vorige als die nog niet gekoppeld is
  const teKoppelen = p.run?.te_koppelen ? p.run : p.vorige_run?.te_koppelen ? p.vorige_run : null;
  const nogMeer = p.te_koppelen - (teKoppelen ? 1 : 0);
  const status = p.koppeling === 'manueel' ? (p.run ? 'bezig' : 'vrij') : (l?.status || 'onbekend');
  const actief = status === 'bezig' || status === 'pauze';
  async function doe(actie, vraag) {
    if (vraag && !await bevestig(vraag)) return;
    try { await api.post(`/productie/printers/${p.id}/${actie}`); melding({ pauze: 'Pauze gevraagd.', hervat: 'Hervatten gevraagd.', annuleer: 'Annuleren gevraagd.', start: 'Print gestart.' }[actie]); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
  }
  return (
    <section className="pkaart" aria-label={p.naam}>
      <div className="plive">
      <div className="pkaart-kop">
        <div><b>{p.naam}</b><div className="sub">{p.koppeling_label}</div></div>
        <StatusBadge status={status} />
      </div>
      {p.fout && <div className="regelfout"><Icoon naam="let" maat={14} /> {p.fout}</div>}
      {l?.ontbrekend?.length > 0 && p.koppeling !== 'manueel' && <div className="sub">Niet gevonden in Home Assistant: {l.ontbrekend.length} entiteit(en). <Link naar="/instellingen/printers">Koppeling nakijken</Link></div>}
      {p.koppeling !== 'manueel' && l && (
        <>
          {(actief || status === 'klaar') && l.voortgang != null && (
            <div className="voortgang" role="progressbar" aria-valuenow={l.voortgang} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, l.voortgang))}%` }} /><b>{aantal(l.voortgang)} %</b></div>
          )}
          {l.bestand && <div className="pbestand mono">{l.bestand}</div>}
          <dl className="pwaarden">
            {actief && <><dt>Resterend</dt><dd>{tijd(l.resterend_min)}</dd></>}
            {l.laag != null && <><dt>Laag</dt><dd className="num">{aantal(l.laag)}{l.lagen ? ` / ${aantal(l.lagen)}` : ''}</dd></>}
            <dt>Nozzle</dt><dd className="num">{l.nozzle != null ? `${aantal(l.nozzle)} °C` : '—'}</dd>
            <dt>Bed</dt><dd className="num">{l.bed != null ? `${aantal(l.bed)} °C` : '—'}</dd>
          </dl>
        </>
      )}
      <dl className="pwaarden">
        <dt>Verbruik nu</dt><dd className="num">{l?.watt != null ? `${aantal(l.watt)} W` : '—'}</dd>
        {p.run && <><dt>Deze print</dt><dd className="num">{tijd(p.run.duur_min)} · {naarInvoer(p.run.kwh)} kWh{p.run.onvolledig ? ' (onvolledig)' : ''}</dd></>}
        {p.run?.opdracht && <><dt>Opdracht</dt><dd>{p.run.opdracht.naam}{p.run.opdracht.plaat_leden > 1 ? ` + ${p.run.opdracht.plaat_leden - 1} andere` : ''}{p.run.opdracht.dossier_nummer ? <> · <Link naar={`/dossiers/${p.run.opdracht.dossier_id}?tab=productie`}><span className="mono">{p.run.opdracht.dossier_nummer}</span></Link></> : null}</dd></>}
        {p.run?.intern && <><dt>Opdracht</dt><dd className="sub">{p.run.intern_label}</dd></>}
        {!p.run && p.vorige_run && <><dt>Vorige print</dt><dd>{p.vorige_run.uitkomst} · {tijd(p.vorige_run.duur_min)} · {naarInvoer(p.vorige_run.kwh)} kWh</dd></>}
        {!p.run && p.volgende && <><dt>Volgende</dt><dd><Link naar="/productie/opdrachten">{p.volgende.naam}</Link></dd></>}
      </dl>
      {teKoppelen && (
        <div className="koppel-lint">
          <span>{teKoppelen === p.run ? 'Deze print' : 'De vorige print'} hoort nog nergens bij.{teKoppelen.voorstel ? <> Voorstel: <b>{teKoppelen.voorstel.naam}</b>.</> : ''}</span>
          <button type="button" className="btn klein primary" onClick={() => setKoppel(teKoppelen)}>Koppelen</button>
        </div>
      )}
      {nogMeer > 0 && !runs && <div className="sub"><Link naar="/productie/runs?te_koppelen=1">{nogMeer} andere run{nogMeer > 1 ? 's' : ''} te koppelen</Link></div>}
      {camera && p.camera && <Camera id={p.id} />}
      <div className="doc-knoppen">
        {p.koppeling === 'manueel' ? (
          p.run ? <button type="button" className="btn primary" onClick={() => setStop(true)}>Print stoppen</button>
            : <button type="button" className="btn primary" onClick={() => doe('start')}>Print starten</button>
        ) : <>
          {p.knoppen.pauze && status === 'bezig' && <button type="button" className="btn" onClick={() => doe('pauze')}>Pauzeren</button>}
          {p.knoppen.hervat && status === 'pauze' && <button type="button" className="btn" onClick={() => doe('hervat')}>Hervatten</button>}
          {p.knoppen.annuleer && actief && <button type="button" className="btn ghost" onClick={() => doe('annuleer', { titel: 'Print annuleren', tekst: `De print op ${p.naam} wordt afgebroken. Dit kan niet ongedaan gemaakt worden.`, bevestigLabel: 'Print annuleren', annuleerLabel: 'Terug', gevaarlijk: true })}>Annuleren</button>}
        </>}
        {p.camera && <button type="button" className="btn ghost" aria-pressed={camera} onClick={() => setCamera(c => !c)}>{camera ? 'Camera verbergen' : 'Camera'}</button>}
        <button type="button" className="btn ghost" onClick={() => setRolLeeg(true)}>Rol leeg</button>
      </div>
      {p.bijgewerkt_op && <div className="sub klein">Bijgewerkt {datumTijd(p.bijgewerkt_op)}</div>}
      </div>
      <Wachtrij p={p} opdrachten={opdrachten} runs={runs} verberg={teKoppelen?.id} herlaad={herlaad} />
      {rolLeeg && <RolLeegDialoog printer={p} onSluit={() => setRolLeeg(false)} />}
      {koppel && <KoppelDialoog run={{ ...koppel, printer: p.naam, printer_id: p.id }} onSluit={() => setKoppel(null)} onKlaar={async () => { setKoppel(null); await herlaad(); }} />}
      {stop && (
        <Dialoog titel={`Print stoppen op ${p.naam}`} onSluit={() => setStop(false)}
          voet={<>
            <button type="button" className="btn" onClick={() => setStop(false)}>Terug</button>
            <button type="button" className="btn ghost" onClick={async () => { await api.post(`/productie/printers/${p.id}/stop`, { uitkomst: 'mislukt' }).catch(e => melding(e.message, 'fout')); setStop(false); await herlaad(); }}>Mislukt</button>
            <button type="button" className="btn primary" onClick={async () => { await api.post(`/productie/printers/${p.id}/stop`, { uitkomst: 'klaar' }).catch(e => melding(e.message, 'fout')); setStop(false); await herlaad(); }}>Klaar</button>
          </>}>
          <p style={{ margin: 0 }}>Hoe is de print afgelopen?</p>
        </Dialoog>
      )}
    </section>
  );
}

// 09-11: twee weergaven (onthouden in deze browser): kaarten naast elkaar of één rij per printer
const WEERGAVE = 'printers-weergave';
function leesWeergave() { try { return localStorage.getItem(WEERGAVE) === 'rijen' ? 'rijen' : 'kaarten'; } catch { return 'kaarten'; } }

export default function PrintersLive() {
  const { data, fout, laden, herlaad: herlaadLive } = useData('/productie/live');
  const { data: opd, herlaad: herlaadOpd } = useData('/productie/opdrachten?open=1');
  const { data: runs, herlaad: herlaadRuns } = useData('/productie/runs?te_koppelen=1');
  const { melding } = useOmgeving();
  const [weergave, setWeergave] = useState(leesWeergave);
  const kies = w => { setWeergave(w); try { localStorage.setItem(WEERGAVE, w); } catch { /* niet bewaard */ } };
  useEffect(() => { const k = setInterval(() => herlaadLive(), 5000); return () => clearInterval(k); }, [herlaadLive]);
  // wachtrij: elke 15 s (en meteen na koppelen/bevestigen)
  useEffect(() => { const k = setInterval(() => { herlaadOpd(); herlaadRuns(); }, 15000); return () => clearInterval(k); }, [herlaadOpd, herlaadRuns]);
  const herlaad = async () => { await Promise.all([herlaadLive(), herlaadOpd(), herlaadRuns()]); };
  async function vernieuw() { try { await api.post('/productie/vernieuwen'); await herlaad(); } catch (e) { melding(e.message, 'fout'); } }
  const open = (opd?.lijst || []).filter(o => !o.voltooid_op && !o.geannuleerd_op);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Printers' }]} acties={<>
        <div className="segment" role="group" aria-label="Weergave">
          <button type="button" className={`btn klein${weergave === 'kaarten' ? ' actief' : ''}`} aria-pressed={weergave === 'kaarten'} onClick={() => kies('kaarten')}>Kaarten</button>
          <button type="button" className={`btn klein${weergave === 'rijen' ? ' actief' : ''}`} aria-pressed={weergave === 'rijen'} onClick={() => kies('rijen')}>Rijen</button>
        </div>
        <button type="button" className="btn" onClick={vernieuw}>Vernieuwen</button>
      </>} />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <>
          {!data.ha && data.printers.some(p => p.koppeling !== 'manueel') && <div className="waarschuwing" style={{ margin: '12px 16px 0' }}>Home Assistant is niet ingesteld: de gekoppelde printers worden niet gevolgd. Zie <Link naar="/instellingen/integraties">Instellingen → Integraties</Link>.</div>}
          {data.printers.length === 0 ? <div className="leeg"><b>Geen actieve printers.</b>Voeg een printer toe onder Instellingen → Printers.</div> : (
            <div className={`pgrid${weergave === 'rijen' ? ' rijen' : ''}`}>{data.printers.map(p => <PrinterKaart key={p.id} p={p} herlaad={herlaad} opdrachten={opd ? open : null} runs={runs} />)}</div>
          )}
          <p className="note" style={{ margin: '0 16px 16px' }}>De printerwachter leest de printers elke {data.interval_s} s, ook als deze pagina niet openstaat. Elke print wordt automatisch een run (zie Runs); koppel ze aan een printopdracht zodat tijd en verbruik op de werkbon komen.</p>
        </>
      )}
    </>
  );
}
