import { useEffect, useState } from 'react';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { Link } from '../../schil/Schil.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { aantal, euro, naarInvoer } from '../../lib/formaat.js';
import { OpdrachtBadge, OpdrachtDialoog, BevestigDialoog, KoppelDialoog, duur, PlaatBadge, PlaatBevestigDialoog } from '../productie/opdracht.jsx';
import { RunVenster } from '../productie/RunDialoog.jsx';
import { StatusBadge } from '../productie/PrintersLive.jsx';
import { api, BASE } from '../../lib/api.js';
import { datumTijd } from '../../lib/formaat.js';
import RunFoto from '../../components/RunFoto.jsx';

// Productie van een dossier (stap 6b): per printregel de printopdrachten,
// hoeveel stuks er goed zijn en wat er nog gepland staat. Klaar = elke
// printregel heeft genoeg goede stuks. Mislukte pogingen tellen niet op de
// werkbon (optie A) maar worden hier getoond als kost voor jou.
const uren = u => (u == null ? '—' : `${naarInvoer(Math.round(u * 100) / 100)} u`);

export default function ProductieTab({ d, vuil, herlaad }) {
  const { melding, bevestig } = useOmgeving();
  const [dialoog, setDialoog] = useState(null);   // { soort: 'nieuw', regel } | { soort: 'open' | 'bevestig', o } | { soort: 'koppel', run }
  const [bezig, setBezig] = useState(false);
  // 23-10: samen op één plaat — open opdrachten aanvinken
  const [kies, setKies] = useState({});
  const gekozen = Object.keys(kies).filter(k => kies[k]).map(Number);
  async function opEenPlaat() {
    setBezig(true);
    try { await api.post('/productie/plaat', { opdracht_ids: gekozen }); melding(`${gekozen.length} printopdrachten liggen nu samen op één plaat: koppel de run aan één ervan, hij geldt voor allemaal.`); setKies({}); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function los(o) {
    setBezig(true);
    try { await api.post(`/productie/opdrachten/${o.id}/los`); melding(`"${o.naam}" ligt niet meer op de gedeelde plaat.`); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  // Te koppelen runs op de printers van dit dossier (25-09): in één klik aan het voorstel
  async function koppel(run) {
    setBezig(true);
    try { await api.post(`/productie/runs/${run.id}/koppel`, { printopdracht_id: run.voorstel.id }); melding(`Run gekoppeld aan "${run.voorstel.naam}".`); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  const runs = d.productie.te_koppelen_runs || [];
  // 13-10: geplande opdracht weg → de regel verlaagt mee (anders komt ze terug)
  async function verwijderOpdracht(o, r) {
    const nieuw = Math.round((r.besteld - o.aantal) * 1000) / 1000;
    if (nieuw <= 0) { melding('Dan blijft er niets over op de regel: verwijder de regel zelf (tab Regels).', 'fout'); return; }
    if (!await bevestig({ titel: 'Printopdracht verwijderen', tekst: `"${o.naam}" (${String(o.aantal).replace('.', ',')} stuks) verdwijnt, en de regel gaat van ${String(r.besteld).replace('.', ',')} naar ${String(nieuw).replace('.', ',')} stuks. De prijs van het dossier wordt herberekend (een verstuurde offerte blijft zoals ze is).`, bevestigLabel: 'Verwijderen', annuleerLabel: 'Terug', gevaarlijk: true })) return;
    setBezig(true);
    try { await api.delete(`/productie/opdrachten/${o.id}?regel=1`); melding('Printopdracht verwijderd; de regel is aangepast.'); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function herbereken(o) {
    setBezig(true);
    try {
      const r = await api.post(`/productie/opdrachten/${o.id}/herbereken`);
      melding(r.kost?.onvolledig ? `Nog steeds onvolledig — ontbreekt: ${r.kost.ontbreekt.join(' · ')}` : 'Productiekost herberekend: nu volledig.', r.kost?.onvolledig ? 'fout' : undefined);
      await herlaad();
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  const kan = d.acties.printopdracht;
  const klaar = async () => { setDialoog(null); await herlaad(); };
  function plan(x) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    const rest = x.besteld - x.goed - x.gepland;
    setDialoog({ soort: 'nieuw', regel: { dossier_regel_id: x.regel_id, naam: x.omschrijving || `Printwerk ${d.nummer}`, label: x.omschrijving || 'Printwerk',
      aantal: rest > 0 ? rest : x.besteld, printer_id: x.printer_id } });
  }
  const gemeten = Object.fromEntries(d.regels.filter(r => r.type === 'printen').map(r => [r.id, r.gemeten]));
  const alle = d.productie.regels.flatMap(x => x.opdrachten);
  const platen = [...new Map(alle.filter(o => o.plaat).map(o => [o.plaat.groep, o])).values()]
    .filter(o => o.plaat.leden.some(l => !l.voltooid && !l.geannuleerd));
  const kiesbaar = o => kan && !o.voltooid_op && !o.geannuleerd_op && (o.status === 'gepland' || o.status === 'te_bevestigen' || o.status === 'mislukt');
  return (
    <>
      {platen.map(o => (
        <section key={o.plaat.groep} className="te-koppelen" aria-label="Gedeelde plaat">
          <h4>Samen op één plaat ({o.plaat.leden.length} producten) · <OpdrachtBadge status={o.status} /></h4>
          <p className="sub" style={{ margin: '0 0 6px' }}>{o.plaat.leden.map(l => `${l.naam}${l.voltooid ? ` ✓ ${aantal(l.aantal_goed)}` : ''}`).join(' · ')}</p>
          <div className="knoppen">
            {(o.status === 'te_bevestigen' || o.status === 'mislukt') && o.runs.some(r => r.uitkomst === 'klaar') && <button type="button" className="btn klein primary" onClick={() => setDialoog({ soort: 'plaat_bevestig', o })}>Plaat bevestigen…</button>}
            {(o.status === 'gepland' || o.status === 'mislukt') && <button type="button" className="btn klein" onClick={() => setDialoog({ soort: 'run_kiezen', o })}>Run koppelen…</button>}
          </div>
        </section>
      ))}
      {gekozen.length > 0 && (
        <div className="waarschuwing" style={{ marginBottom: 10 }} role="status">
          <span>{gekozen.length} printopdracht{gekozen.length === 1 ? '' : 'en'} aangevinkt.</span>
          <button type="button" className="btn klein primary" style={{ marginLeft: 'auto' }} disabled={bezig || gekozen.length < 2} onClick={opEenPlaat}>Op één plaat zetten</button>
          <button type="button" className="btn klein ghost" onClick={() => setKies({})}>Wissen</button>
        </div>
      )}
      {runs.length > 0 && (
        <section className="te-koppelen" aria-label="Te koppelen runs">
          <h4>{runs.length === 1 ? 'Er is een run die nog niet gekoppeld is' : `Er zijn ${runs.length} runs die nog niet gekoppeld zijn`}</h4>
          {runs.map(r => (
            <div key={r.id} className="run">
              <RunFoto run={r} maat={48} />
              <div className="wat klikbaar" role="button" tabIndex={0} title="Run openen" onClick={() => setDialoog({ soort: 'run', id: r.id })}
                onKeyDown={e => { if (e.key === 'Enter') setDialoog({ soort: 'run', id: r.id }); }}><b>{r.printer}</b> · <span className="num">{datumTijd(r.gestart_op)}</span> · {duur(r.duur_min)} <StatusBadge status={r.uitkomst} />
                {r.bestand && <div className="sub mono">{r.bestand}</div>}</div>
              <div className="knoppen">
                {r.voorstel && <button type="button" className="btn klein primary" disabled={bezig} onClick={() => koppel(r)}>Koppelen aan "{r.voorstel.naam}"</button>}
                <button type="button" className="btn klein" disabled={bezig} onClick={() => setDialoog({ soort: 'koppel', run: r })}>{r.voorstel ? 'Andere keuze…' : 'Koppelen…'}</button>
              </div>
            </div>
          ))}
        </section>
      )}
      {d.productie.regels.map(x => {
        const g = gemeten[x.regel_id];
        const tekort = Math.max(0, x.besteld - x.goed);
        return (
          <section key={x.regel_id} className="prod-regel" aria-label={x.omschrijving || 'Printwerk'}>
            <div className="kop">
              <b>{x.omschrijving || 'Printwerk'}{x.eindproduct && <span className="sub" style={{ fontWeight: 400 }}> → voorraad: <Link naar={`/voorraad/artikelen/${x.eindproduct.id}`}>{x.eindproduct.naam}</Link></span>}</b>
              <span className="tel num">besteld {aantal(x.besteld)} · goed {aantal(x.goed)}{x.gepland ? ` · gepland ${aantal(x.gepland)}` : ''}
                {' '}{tekort === 0 ? <span className="badge b-pos">klaar</span> : x.opdrachten.length ? <span className="badge b-info">nog {aantal(tekort)}</span> : null}</span>
              {kan && <button type="button" className="btn klein" onClick={() => plan(x)}><Icoon naam="plus" maat={12} /> Printopdracht</button>}
            </div>
            {x.te_plannen > 0 && d.gestart_op && !x.printer_id && (
              <div className="waarschuwing" style={{ margin: '8px 0 0' }} role="status">Nog {aantal(x.te_plannen)} te plannen: kies een printer op de regel (tabblad Regels), dan komt de printopdracht vanzelf.</div>
            )}
            {x.opdrachten.filter(o => o.voltooid_op && o.kost_onvolledig).map(o => (
              <div key={`k${o.id}`} className="waarschuwing" style={{ margin: '8px 0 0' }} role="status">
                <span>Productiekost van "{o.naam}" onvolledig{o.kost_ontbreekt ? <> — ontbreekt: {o.kost_ontbreekt}</> : ''}.</span>
                <button type="button" className="btn klein" style={{ marginLeft: 'auto' }} disabled={bezig} onClick={() => herbereken(o)}>Kost herberekenen</button>
              </div>
            ))}
            {x.te_veel > 0 && (
              <div className="waarschuwing" style={{ margin: '8px 0 0' }} role="status">{aantal(x.te_veel)} stuk{x.te_veel === 1 ? '' : 's'} meer geprint of in de maak dan besteld.</div>
            )}
            {x.opdrachten.length > 0 && (
              <div className="tabelvak" style={{ marginTop: 8 }}>
                <table className="mini">
                  <thead><tr><th><span className="sr-only">Kiezen</span></th><th>Opdracht</th><th>Printer</th><th className="r">Stuks</th><th className="r">Runs</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {x.opdrachten.map(o => (
                      <tr key={o.id} className="row" tabIndex={0} onClick={() => setDialoog({ soort: 'open', o })} onKeyDown={e => { if (e.key === 'Enter') setDialoog({ soort: 'open', o }); }}>
                        <td onClick={e => e.stopPropagation()}>{kiesbaar(o) && <input type="checkbox" aria-label={`${o.naam} aanvinken (samen op één plaat)`} title="Aanvinken om samen op één plaat te zetten" checked={!!kies[o.id]} onChange={e => setKies(k => ({ ...k, [o.id]: e.target.checked }))} />}</td>
                        <td>{o.naam}<PlaatBadge o={o} />{o.slicer_bijlage_id && <div className="sub"><a href={`${BASE}/bijlagen/bestand/${o.slicer_bijlage_id}`} onClick={e => e.stopPropagation()} title="Slicerbestand downloaden (openen in Bambu Studio)">{o.slicer_bestandsnaam || 'slicerbestand'}</a>{o.slicer_plaat ? ` · plaat ${o.slicer_plaat}` : ''}</div>}</td>
                        <td>{o.printer}</td>
                        <td className="r num">{o.status === 'voltooid' ? `${aantal(o.aantal_goed)} / ${aantal(o.aantal)}` : aantal(o.aantal)}</td>
                        <td className="r num">{o.runs.length || ''}</td>
                        <td><OpdrachtBadge status={o.status} /></td>
                        <td className="r">
                          {o.status === 'te_bevestigen' && <button type="button" className="btn klein primary" onClick={e => { e.stopPropagation(); setDialoog({ soort: 'bevestig', o }); }}>Bevestigen</button>}
                          {(o.status === 'gepland' || o.status === 'mislukt') && <button type="button" className="btn klein" title="Een run (ook van een andere printer) aan deze opdracht koppelen" onClick={e => { e.stopPropagation(); setDialoog({ soort: 'run_kiezen', o }); }}>Run koppelen…</button>}
                          {o.plaat && o.status === 'gepland' && !o.runs.length && <button type="button" className="btn klein ghost" title="Van de gedeelde plaat halen" onClick={e => { e.stopPropagation(); los(o); }}>los</button>}
                          {o.status === 'gepland' && !o.runs.length && !d.afgerekend_op && !d.gratis_op && <button type="button" className="btn klein ghost" title="Deze geplande opdracht weghalen (de regel krijgt evenveel stuks minder)" aria-label={`Printopdracht ${o.naam} verwijderen`} onClick={e => { e.stopPropagation(); verwijderOpdracht(o, x); }}><Icoon naam="vuilbak" maat={14} /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {g && (
              <p className="sub" style={{ marginBottom: 0 }}>
                Gemeten (geslaagd): {g.geslaagd.runs} run{g.geslaagd.runs === 1 ? '' : 's'} · {uren(g.geslaagd.uren)} · {g.geslaagd.kwh_onbekend ? '? ' : naarInvoer(g.geslaagd.kwh)} kWh
                {g.mislukt.runs > 0 && <> · <span style={{ color: 'var(--crit)' }}>mislukte pogingen: {g.mislukt.runs} ({uren(g.mislukt.uren)}, {naarInvoer(g.mislukt.kwh)} kWh, kost {euro(g.mislukt.kost)}{g.mislukt.kost_onvolledig ? '*' : ''})</span></>}
              </p>
            )}
          </section>
        );
      })}
      {d.gestart_op && <p className="note"><b>Automatisch:</b> de printopdrachten volgen de regels. Pas je het aantal, de printer of de omschrijving van een regel aan, dan volgen de opdrachten waarop nog niets geprint is. Is er al geprint en is er meer nodig, dan komt er een extra opdracht bij. Wil je een regel over twee printers spreiden, maak dan zelf een extra opdracht voor een deel: de andere wordt kleiner.</p>}
      <p className="note"><b>Samen op één plaat:</b> liggen verschillende producten samen op één plaat (bv. 8 figuren), vink hun printopdrachten aan en kies "Op één plaat zetten". Koppel de run aan één ervan: hij geldt voor allemaal. Met "Plaat bevestigen" vul je per product de goede stuks in; wat mislukte, wordt opnieuw gepland (op wens weer samen).</p>
      <p className="note">Plan een printopdracht per printregel; ze komt in de wachtrij van de printer (<Link naar="/productie/opdrachten">Productie → Printopdrachten</Link>). Start je de print, koppel dan de run hier ("Run koppelen…" bij de opdracht) of op de printerkaart. Tijd en verbruik van de <b>geslaagde</b> runs komen op de werkbon; mislukte pogingen zijn een kost voor jou (elektriciteit + machinetarief; verloren filament niet meegerekend).</p>
      {dialoog?.soort === 'nieuw' && <OpdrachtDialoog vast={dialoog.regel} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'open' && <OpdrachtDialoog opdracht={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'bevestig' && <BevestigDialoog o={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'plaat_bevestig' && <PlaatBevestigDialoog o={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'run_kiezen' && <RunKiezen o={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'koppel' && <KoppelDialoog run={dialoog.run} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'run' && <RunVenster runId={dialoog.id} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
    </>
  );
}

// Run koppelen vanuit een opdracht (28-09): de recente, nog niet gekoppelde
// runs van ALLE printers (laatste 7 dagen). Een run van een andere printer
// koppelen verhuist de opdracht naar die printer. Eerst runs waarvan de
// bestandsnaam op de opdracht lijkt, dan die op dezelfde printer.
function RunKiezen({ o, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const [runs, setRuns] = useState(null);
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    let weg = false;
    api.get('/productie/runs?te_koppelen=1').then(lijst => {
      if (weg) return;
      const grens = Date.now() - 7 * 24 * 3600e3;
      const norm = t => String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const lijkt = r => norm(o.naam).length >= 3 && norm(r.bestand).includes(norm(o.naam));
      const score = r => (lijkt(r) ? 2 : 0) + (r.printer_id === o.printer_id ? 1 : 0);
      setRuns(lijst.filter(r => Date.parse(r.gestart_op) >= grens).map(r => ({ ...r, lijkt: lijkt(r) }))
        .sort((a, b) => score(b) - score(a) || String(b.gestart_op).localeCompare(String(a.gestart_op))));
    }).catch(e => { if (!weg) { melding(e.message, 'fout'); setRuns([]); } });
    return () => { weg = true; };
  }, [o, melding]);
  async function koppel(r) {
    setBezig(true);
    try {
      await api.post(`/productie/runs/${r.id}/koppel`, { printopdracht_id: o.id });
      melding(`Run gekoppeld aan "${o.naam}"${r.printer_id !== o.printer_id ? `; de opdracht staat nu op ${r.printer}` : ''}.`);
      await onKlaar();
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  return (
    <Dialoog titel={`Run koppelen aan "${o.naam}"`} breed onSluit={onSluit} voet={<button type="button" className="btn" onClick={onSluit}>Sluiten</button>}>
      {runs === null ? <p className="sub">Runs laden…</p> : !runs.length ? (
        <p className="sub">Er zijn geen niet-gekoppelde runs van de laatste 7 dagen. Start de print op de printer: de run verschijnt binnen enkele seconden (Productie → Printers live).</p>
      ) : (
        <div className="tabelvak">
          <table className="mini">
            <thead><tr><th><span className="sr-only">Foto</span></th><th>Printer</th><th>Start</th><th>Duur</th><th>Bestand</th><th>Status</th><th /></tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td><RunFoto run={r} /></td>
                  <td>{r.printer}{r.printer_id !== o.printer_id && <div className="sub">andere printer</div>}</td>
                  <td className="num">{datumTijd(r.gestart_op)}</td>
                  <td className="num">{duur(r.duur_min)}</td>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>{r.bestand || '—'}{r.lijkt && <div><span className="badge b-pos">naam komt overeen</span></div>}</td>
                  <td><StatusBadge status={r.uitkomst} /></td>
                  <td className="r"><button type="button" className={`btn klein${r.lijkt ? ' primary' : ''}`} disabled={bezig} onClick={() => koppel(r)}>Koppelen</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">Een run van een andere printer koppelen verhuist de opdracht naar die printer (tijd en verbruik tellen dan van die printer).</p>
    </Dialoog>
  );
}
