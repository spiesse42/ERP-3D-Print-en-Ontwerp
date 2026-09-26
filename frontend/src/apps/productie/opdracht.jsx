import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { Link } from '../../schil/Schil.jsx';
import { aantal, naarInvoer, datumTijd, euro } from '../../lib/formaat.js';
import { RunVenster } from './RunDialoog.jsx';
import Icoon from '../../schil/Icoon.jsx';

// Printopdrachten en runs koppelen (stap 6b) — gedeelde stukken voor
// Productie → Printopdrachten, Productie → Runs, de printerkaarten en het
// Productie-tabblad van een dossier.
// Status komt AFGELEID uit de backend (productie/opdrachten.js).
export const OPDRACHT = {
  gepland: ['b-neutral', 'Gepland'], bezig: ['b-info', 'Bezig'], te_bevestigen: ['b-warn', 'Te bevestigen'],
  voltooid: ['b-pos', 'Voltooid'], mislukt: ['b-crit', 'Mislukt'], geannuleerd: ['b-neutral', 'Geannuleerd'],
};
export function OpdrachtBadge({ status }) { const [k, l] = OPDRACHT[status] || OPDRACHT.gepland; return <span className={`badge ${k}`}>{l}</span>; }
export const INTERN = { kalibratie: 'Kalibratie', test: 'Test', overig: 'Overig (intern)' };
export const SOORT_OPDRACHT = { klant: 'Klant', eigen: 'Eigen product', intern: 'Intern' };
export const duur = m => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} u ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);
const UITKOMST = { bezig: 'bezig', klaar: 'geslaagd', mislukt: 'mislukt', geannuleerd: 'geannuleerd' };

// Waar hoort een opdracht bij: dossier (link) of los.
export function Herkomst({ o }) {
  if (o.dossier_id) return <span><Link naar={`/dossiers/${o.dossier_id}?tab=productie`}><span className="mono">{o.dossier_nummer}</span></Link>{o.dossier_titel ? ` · ${o.dossier_titel}` : ''}</span>;
  return <span className="sub">{SOORT_OPDRACHT[o.soort]}</span>;
}

// ── Filament van een LOSSE printopdracht (26-09, optie A) ──────────────
// Een opdracht zonder dossier heeft zelf filament + gram (voor de hele
// opdracht, alle stuks samen). Zelfde keuze als op een printregel: een
// filament (merk · type · kleur) of enkel een prijsgroep (merk · type).
// Een opdracht MET dossier haalt het filament van de regel (daar aanpassen).
export const legeMat = (gram = '') => [{ keuze: '', gram }];
export function naarMatInvoer(materialen) {
  return materialen?.length
    ? materialen.map(m => ({ keuze: m.artikel_id ? `a:${m.artikel_id}` : `p:${m.filament_type_id}`, gram: naarInvoer(m.gram) }))
    : legeMat();
}
export function matVoorApi(rijen) {
  return rijen.filter(r => r.keuze).map(r => {
    const [soort, id] = r.keuze.split(':');
    const g = String(r.gram ?? '').trim();
    return { [soort === 'a' ? 'artikel_id' : 'filament_type_id']: Number(id), gram: g === '' ? 0 : g.replace(',', '.') };
  });
}
// Gewicht dat de printer zelf meldde (bv. Bambu "gewicht van print"), als voorstel.
export function gemeldGewicht(runs) {
  const g = (runs || []).filter(r => r.uitkomst === 'klaar' && r.gewicht_g > 0).reduce((t, r) => t + r.gewicht_g, 0);
  return g > 0 ? naarInvoer(Math.round(g * 10) / 10) : '';
}
export function FilamentInvoer({ rijen, onWijzig, uit = false, id = 'fil' }) {
  const { data: artikelen } = useData('/voorraad/artikelen?archief=alle');
  const { data: prijsgroepen } = useData('/filament/types');
  const gekozen = new Set(rijen.map(r => r.keuze));
  const filamenten = (artikelen || []).filter(a => a.type === 'filament' && (!a.gearchiveerd || gekozen.has(`a:${a.id}`)));
  const zet = (k, w) => onWijzig(rijen.map((r, j) => (j === k ? { ...r, ...w } : r)));
  return (
    <fieldset className="materialen" disabled={uit} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="lbl" style={{ padding: 0 }}>Filament <span className="sub" style={{ fontWeight: 400 }}>(gram voor de hele opdracht, alle stuks samen)</span></legend>
      {rijen.map((m, k) => (
        <div className="materiaal" key={k}>
          <select className="inp" id={k === 0 ? `${id}-0` : undefined} aria-label={`Filament ${k + 1}`} value={m.keuze} onChange={e => zet(k, { keuze: e.target.value })}>
            <option value="">Filament kiezen…</option>
            <optgroup label="Filament (merk · type · kleur)">{filamenten.map(f => <option key={`a${f.id}`} value={`a:${f.id}`}>{f.weergave}</option>)}</optgroup>
            <optgroup label="Enkel prijsgroep (merk · type)">{(prijsgroepen || []).map(g => <option key={`p${g.id}`} value={`p:${g.id}`}>{g.merk} {g.materiaal}</option>)}</optgroup>
          </select>
          <span className="unit"><input className="inp num" inputMode="decimal" aria-label={`Gewicht filament ${k + 1}`} placeholder="gram" value={m.gram} onChange={e => zet(k, { gram: e.target.value })} /><span>g</span></span>
          {rijen.length > 1 && !uit && <button type="button" className="btn ghost" aria-label="Kleur weghalen" onClick={() => onWijzig(rijen.filter((_, j) => j !== k))}><Icoon naam="kruis" maat={12} /></button>}
        </div>
      ))}
      {!uit && <button type="button" className="linkish" onClick={() => onWijzig([...rijen, { keuze: '', gram: '' }])}>+ kleur (multicolor)</button>}
    </fieldset>
  );
}

// ── Nieuwe printopdracht of bestaande bekijken/bewerken ─────────────────
// vast: { dossier_regel_id, naam, aantal, printer_id, label } bij een printregel van een dossier.
export function OpdrachtDialoog({ opdracht = null, vast = null, onSluit: sluit, onKlaar }) {
  const { melding, bevestig } = useOmgeving();
  const { data: printers } = useData('/printers');
  // 25-09: een run openen vanuit de opdracht; daarna terug met verse gegevens
  const [vers, setVers] = useState(null);
  const [runOpen, setRunOpen] = useState(null);
  const [gewijzigd, setGewijzigd] = useState(false);
  const o = vers || opdracht;
  const onSluit = () => (gewijzigd ? onKlaar() : sluit());
  async function naRun() {
    setRunOpen(null); setGewijzigd(true);
    try { setVers(await api.get(`/productie/opdrachten/${opdracht.id}`)); } catch (e) { melding(e.message, 'fout'); }
  }
  const afgesloten = o && (o.status === 'voltooid' || o.status === 'geannuleerd');
  // gestart dossier, nog niets geprint: de opdracht volgt de regel (25-09)
  const volgtRegel = !!o?.dossier_gestart_op && o.runs.length === 0 && !afgesloten;
  const [f, setF] = useState(() => ({
    printer_id: String(o?.printer_id ?? vast?.printer_id ?? ''), naam: o?.naam ?? vast?.naam ?? '', aantal: naarInvoer(o?.aantal ?? vast?.aantal ?? 1),
    soort: o?.soort ?? 'eigen', notities: o?.notities ?? '',
  }));
  const [bezig, setBezig] = useState(false);
  const [bevestigen, setBevestigen] = useState(false);
  // losse opdracht (geen dossierregel): eigen filament (26-09)
  const los = o ? !o.dossier_regel_id : !vast;
  // nog geen filament: het gewicht dat de printer meldde als voorstel
  const [mat, setMat] = useState(() => (o?.materialen?.length ? naarMatInvoer(o.materialen) : legeMat(gemeldGewicht(o?.runs))));
  const [matGewijzigd, setMatGewijzigd] = useState(false);
  const wijzigMat = r => { setMat(r); setMatGewijzigd(true); };
  const zet = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const actief = (printers || []).filter(p => p.actief || String(p.id) === f.printer_id);
  async function doe(fn, tekst) {
    setBezig(true);
    try { await fn(); if (tekst) melding(tekst); await onKlaar(); } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  const matBody = los ? { materialen: matVoorApi(mat) } : {};
  const opslaan = () => doe(() => (o
    ? api.put(`/productie/opdrachten/${o.id}`, { naam: f.naam, aantal: f.aantal, printer_id: Number(f.printer_id), notities: f.notities, ...matBody })
    : api.post('/productie/opdrachten', { printer_id: Number(f.printer_id), naam: f.naam, aantal: f.aantal, notities: f.notities,
      ...(vast ? { dossier_regel_id: vast.dossier_regel_id } : { soort: f.soort, ...matBody }) })), o ? 'Printopdracht bewaard.' : 'Printopdracht gepland.');
  // Na het bevestigen: filament aanvullen/corrigeren → kost meteen herberekend.
  async function filamentBewaren() {
    setBezig(true);
    try {
      const r = await api.put(`/productie/opdrachten/${o.id}/materialen`, { materialen: matVoorApi(mat) });
      setVers(r); setMat(naarMatInvoer(r.materialen)); setMatGewijzigd(false); setGewijzigd(true);
      melding(r.kost?.onvolledig ? `Filament bewaard. Productiekost nog onvolledig — ontbreekt: ${r.kost.ontbreekt.join(' · ')}` : 'Filament bewaard, productiekost herberekend.');
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function kostHerberekenen() {
    setBezig(true);
    try {
      const r = await api.post(`/productie/opdrachten/${o.id}/herbereken`);
      setVers(r); setGewijzigd(true);
      melding(r.kost?.onvolledig ? `Nog steeds onvolledig — ontbreekt: ${r.kost.ontbreekt.join(' · ')}` : 'Productiekost herberekend.');
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  const actie = (pad, tekst, vraag) => async () => { if (vraag && !await bevestig(vraag)) return; await doe(() => (pad === 'delete' ? api.delete(`/productie/opdrachten/${o.id}`) : api.post(`/productie/opdrachten/${o.id}/${pad}`)), tekst); };
  if (bevestigen) return <BevestigDialoog o={o} mat={los && matGewijzigd ? mat : null} onSluit={() => setBevestigen(false)} onKlaar={onKlaar} />;
  if (runOpen) return <RunVenster runId={runOpen} onSluit={() => setRunOpen(null)} onKlaar={naRun} />;
  const titel = o ? `Printopdracht · ${o.naam}` : vast ? `Printopdracht voor ${vast.label || vast.naam}` : 'Nieuwe printopdracht';
  return (
    <Dialoog titel={titel} onSluit={onSluit} breed
      voet={<>
        {o && o.runs.length === 0 && !volgtRegel && <button type="button" className="btn ghost" disabled={bezig} onClick={actie('delete', 'Printopdracht verwijderd.', { titel: 'Printopdracht verwijderen', tekst: `"${o.naam}" verwijderen?`, bevestigLabel: 'Verwijderen', gevaarlijk: true })}>Verwijderen</button>}
        {o && !afgesloten && o.status !== 'bezig' && o.runs.length > 0 && <button type="button" className="btn ghost" disabled={bezig} onClick={actie('annuleer', 'Printopdracht geannuleerd.', { titel: 'Printopdracht annuleren', tekst: `Enkel de printopdracht "${o.naam}" stopt (bv. een stuk dat niet meer nodig is); de gekoppelde runs blijven bewaard. Het dossier zelf loopt verder. Moet de klant niets betalen? Gebruik dan "Dossier annuleren" in het dossier.`, bevestigLabel: 'Printopdracht annuleren', annuleerLabel: 'Terug' })}>Printopdracht annuleren</button>}
        {o && afgesloten && <button type="button" className="btn" disabled={bezig} onClick={actie('heropen', 'Printopdracht heropend.')}>Heropenen</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onSluit}>Sluiten</button>
        {o && ['te_bevestigen', 'mislukt'].includes(o.status) && o.runs.some(r => r.uitkomst === 'klaar') && <button type="button" className="btn primary" onClick={() => setBevestigen(true)}>Bevestigen</button>}
        {!afgesloten && <button type="button" className={`btn ${o ? '' : 'primary'}`} disabled={bezig || !f.printer_id || !f.naam.trim()} onClick={opslaan}>{o ? 'Bewaren' : 'Plannen'}</button>}
      </>}>
      {o && (
        <p style={{ marginTop: 0 }}><OpdrachtBadge status={o.status} /> <Herkomst o={o} />
          {o.status === 'voltooid' && <> · <b>{aantal(o.aantal_goed)}</b> goede stuks</>}
          {o.eindproduct && <> · naar voorraad: {o.eindproduct}</>}</p>
      )}
      {volgtRegel && <p className="note" style={{ marginTop: 0 }}>Deze opdracht volgt de regel van dossier {o.dossier_nummer}: het totaal aantal komt van die regel. Verlaag je hier het aantal, dan komt de rest in een aparte opdracht (bv. om over twee printers te spreiden). Niet meer nodig? Pas de regel aan.</p>}
      <div className="fgrid">
        <div><label htmlFor="po-naam">Naam</label><input id="po-naam" className="inp" disabled={afgesloten} value={f.naam} onChange={zet('naam')} placeholder="bv. Sleutelhanger" /></div>
        <div><label htmlFor="po-aantal">Aantal stuks</label><input id="po-aantal" className="inp num" inputMode="decimal" disabled={afgesloten} value={f.aantal} onChange={zet('aantal')} /></div>
        <div><label htmlFor="po-printer">Printer</label>
          <select id="po-printer" className="inp" disabled={afgesloten || o?.status === 'bezig'} value={f.printer_id} onChange={zet('printer_id')}>
            <option value="">— kies —</option>
            {actief.map(p => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select></div>
        {!o && !vast && <div><label htmlFor="po-soort">Soort</label>
          <select id="po-soort" className="inp" value={f.soort} onChange={zet('soort')}>
            <option value="eigen">Eigen product</option><option value="intern">Intern</option>
          </select></div>}
      </div>
      <label className="lbl" htmlFor="po-not" style={{ marginTop: 12 }}>Notities</label>
      <textarea id="po-not" className="inp" rows={2} disabled={afgesloten} value={f.notities} onChange={zet('notities')} placeholder="bv. plaat 2 van 3, kleurwissel na laag 40" />
      {!o && !vast && <p className="note">Een printopdracht voor een klant maak je vanuit het dossier (tabblad Productie), zodat ze bij de juiste regel hoort.</p>}
      {o?.productiekost_stuk != null && (
        <p className="sub">Productiekost: <b>{euro(o.productiekost_stuk)}</b> per stuk{o.arbeid_stuk ? <> + arbeid {euro(o.arbeid_stuk)}</> : null}{o.kost_onvolledig ? ' (onvolledig: een prijs of meting ontbreekt)' : ''}</p>
      )}
      {los && (
        <div style={{ marginTop: 12 }}>
          <FilamentInvoer rijen={mat} onWijzig={wijzigMat} uit={o?.status === 'geannuleerd'} id="po-fil" />
          {o?.status === 'voltooid' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn primary" disabled={bezig || !matGewijzigd} onClick={filamentBewaren}>Filament bewaren</button>
              <span className="sub">De productiekost wordt meteen opnieuw berekend.</span>
            </div>
          )}
        </div>
      )}
      {!los && o?.materialen?.length > 0 && (
        <p className="sub">Filament (van de regel in het dossier): {o.materialen.map(m => `${m.naam || '?'} (${aantal(m.gram)} g${m.artikel_id ? `, voorraad ${aantal(m.voorraad)}` : ''})`).join(' · ')}</p>
      )}
      {o?.status === 'voltooid' && !!o.kost_onvolledig && (
        <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }} role="status">
          <b>Productiekost onvolledig.</b>{o.kost_ontbreekt ? <> Ontbreekt: {o.kost_ontbreekt.split('; ').map(t => (los ? t.replace('(open de printopdracht → Filament)', '(hierboven)') : t)).join(' · ')}.</> : null}
          <div style={{ marginTop: 6 }}><button type="button" className="btn klein" disabled={bezig} onClick={kostHerberekenen}>Kost herberekenen</button>
            <span className="sub" style={{ color: 'inherit', marginLeft: 8 }}>na het aanvullen van een prijs, tarief of kWh</span></div>
        </div>
      )}
      {o && (
        <div className="tabelvak" style={{ marginTop: 12 }}>
          <table className="mini">
            <thead><tr><th>Run</th><th>Uitkomst</th><th className="r">kWh</th></tr></thead>
            <tbody>
              {o.runs.length === 0 ? <tr><td colSpan={3} className="sub">Nog geen runs gekoppeld. Start de print; de run verschijnt dan op de printerkaart om te koppelen.</td></tr>
                : o.runs.map(r => (
                  <tr key={r.id} className="row" tabIndex={0} title="Run openen" onClick={() => setRunOpen(r.id)} onKeyDown={e => { if (e.key === 'Enter') setRunOpen(r.id); }}>
                    <td className="num">{datumTijd(r.gestart_op)}</td><td>{UITKOMST[r.uitkomst]}</td><td className="r num">{naarInvoer(r.kwh) || '—'}</td></tr>))}
            </tbody>
          </table>
        </div>
      )}
    </Dialoog>
  );
}

// ── Bevestigen: hoeveel stuks zijn goed? ─────────────────────────────────
// mat: filament dat in het opdrachtvenster al gewijzigd maar nog niet bewaard is.
export function BevestigDialoog({ o, mat: matVan = null, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const [n, setN] = useState(naarInvoer(o.aantal));
  const [bezig, setBezig] = useState(false);
  // 26-09: losse opdracht → filament meteen hier ingeven (voorstel: het
  // gewicht dat de printer meldde, als er nog niets ingevuld is)
  const los = !o.dossier_regel_id;
  const [mat, setMat] = useState(() => matVan || (o.materialen?.length ? naarMatInvoer(o.materialen) : legeMat(gemeldGewicht(o.runs))));
  const matJson = los ? JSON.stringify(matVoorApi(mat)) : null;
  // 25-09: vooraf zien of de productiekost volledig wordt, en wat ontbreekt
  const [kost, setKost] = useState(null);
  useEffect(() => {
    let weg = false;
    const t = setTimeout(() => api.get(`/productie/opdrachten/${o.id}/kost-voorbeeld?aantal_goed=${encodeURIComponent(n || '0')}${matJson ? `&materialen=${encodeURIComponent(matJson)}` : ''}`)
      .then(k => { if (!weg) setKost(k); }).catch(() => {}), 250);
    return () => { weg = true; clearTimeout(t); };
  }, [o.id, n, matJson]);
  async function ok() {
    setBezig(true);
    try { await api.post(`/productie/opdrachten/${o.id}/bevestig`, { aantal_goed: n, ...(los ? { materialen: JSON.parse(matJson) } : {}) }); melding('Printopdracht voltooid.'); await onKlaar(); }
    catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  const mislukt = o.runs.filter(r => r.uitkomst !== 'klaar' && r.uitkomst !== 'bezig').length;
  return (
    <Dialoog titel={`Bevestigen · ${o.naam}`} onSluit={onSluit} breed={los}
      voet={<><button type="button" className="btn" onClick={onSluit}>Terug</button><button type="button" className="btn primary" disabled={bezig} onClick={ok}>Bevestigen</button></>}>
      <label className="lbl" htmlFor="bv-n">Aantal goede stuks (gepland: {aantal(o.aantal)})</label>
      <input id="bv-n" className="inp num" inputMode="decimal" value={n} onChange={e => setN(e.target.value)} autoFocus />
      {o.eindproduct && <p className="sub">De goede stuks komen in voorraad als <b>{o.eindproduct}</b>, aan de productiekost per stuk.</p>}
      {los && <div style={{ marginTop: 12 }}><FilamentInvoer rijen={mat} onWijzig={setMat} id="bv-fil" /></div>}
      {kost?.onvolledig && (
        <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }} role="status">
          <b>Let op: de productiekost wordt onvolledig.</b> Ontbreekt: {kost.ontbreekt.map(t => (los ? t.replace('(open de printopdracht → Filament)', '(hierboven)') : t)).join(' · ')}.
          <div className="sub" style={{ color: 'inherit' }}>{los
            ? 'Je kunt toch bevestigen en het later aanvullen: open de printopdracht (filament bewaren, of "Kost herberekenen").'
            : 'Je kunt toch bevestigen en het later aanvullen; klik dan in het dossier (tabblad Productie) op "Kost herberekenen".'}</div>
        </div>
      )}
      {mislukt > 0 && <p className="sub">{mislukt} mislukte poging{mislukt > 1 ? 'en' : ''}: die tellen niet op de werkbon, wel als kost voor jou (marge-analyse).</p>}
      <p className="note" style={{ marginBottom: 0 }}>Minder goede stuks dan gepland? Plan dan een herprint voor de rest (in het dossier, tabblad Productie).</p>
    </Dialoog>
  );
}

// ── Run koppelen ─────────────────────────────────────────────────────────
// Koppelen gebeurt ALTIJD door jou; het voorstel is de eerste geplande
// opdracht van die printer. Een opdracht van een andere printer verhuist mee.
export function KoppelDialoog({ run, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const { data } = useData('/productie/opdrachten?open=1');
  const open = (data?.lijst || []).filter(o => !o.runs.some(r => r.uitkomst === 'bezig' && r.id !== run.id));
  const [gekozenKeuze, setKeuze] = useState(run.voorstel ? 'voorstel' : null);
  const keuze = gekozenKeuze ?? (open.length ? 'andere' : 'nieuw');
  const [andere, setAndere] = useState('');
  const [nieuw, setNieuw] = useState({ naam: run.bestand ? run.bestand.replace(/(\.gcode)?\.(gcode|3mf|bgcode)$/i, '') : '', aantal: '1', soort: 'eigen' });
  // 26-09: filament meteen meegeven (gewicht van de printer als voorstel)
  const gemeld = run.gewicht_g > 0 ? naarInvoer(Math.round(run.gewicht_g * 10) / 10) : '';
  const [nieuwMat, setNieuwMat] = useState(() => legeMat(gemeld));
  const [intern, setIntern] = useState('kalibratie');
  const [bezig, setBezig] = useState(false);
  const gekozen = open.find(o => String(o.id) === andere);
  async function ok() {
    const body = keuze === 'voorstel' ? { printopdracht_id: run.voorstel.id } : keuze === 'andere' ? { printopdracht_id: Number(andere) }
      : keuze === 'nieuw' ? { nieuw: { ...nieuw, materialen: matVoorApi(nieuwMat) } } : { intern };
    setBezig(true);
    try { await api.post(`/productie/runs/${run.id}/koppel`, body); melding(keuze === 'intern' ? 'Run gemarkeerd als intern.' : 'Run gekoppeld.'); await onKlaar(); }
    catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  const kan = keuze === 'voorstel' ? !!run.voorstel : keuze === 'andere' ? !!andere : keuze === 'nieuw' ? !!nieuw.naam.trim() : true;
  const perPrinter = [...new Set(open.map(o => o.printer))];
  return (
    <Dialoog titel="Run koppelen" onSluit={onSluit} breed
      voet={<><button type="button" className="btn" onClick={onSluit}>Terug</button><button type="button" className="btn primary" disabled={bezig || !kan} onClick={ok}>Koppelen</button></>}>
      <p style={{ marginTop: 0 }}><b>{run.printer || ''}</b>{run.bestand ? <> · <span className="mono">{run.bestand}</span></> : null} · {datumTijd(run.gestart_op)} · {duur(run.duur_min)}</p>
      <fieldset className="keuzes">
        <legend className="sr-only">Waar hoort deze run bij?</legend>
        {run.voorstel && (
          <label className="keuze"><input type="radio" name="kp" checked={keuze === 'voorstel'} onChange={() => setKeuze('voorstel')} />
            <span>Voorstel: <b>{run.voorstel.naam}</b> <span className="sub">({run.voorstel.uitleg || 'eerste in de wachtrij van deze printer'})</span></span></label>
        )}
        <label className="keuze"><input type="radio" name="kp" checked={keuze === 'andere'} onChange={() => setKeuze('andere')} disabled={!open.length} />
          <span>Een andere printopdracht{!open.length && <span className="sub"> (geen open opdrachten)</span>}</span></label>
        {keuze === 'andere' && (
          <div className="keuze-sub">
            <label className="sr-only" htmlFor="kp-andere">Printopdracht</label>
            <select id="kp-andere" className="inp" value={andere} onChange={e => setAndere(e.target.value)}>
              <option value="">— kies —</option>
              {perPrinter.map(p => (
                <optgroup key={p} label={p}>
                  {open.filter(o => o.printer === p).map(o => <option key={o.id} value={o.id}>{o.naam}{o.dossier_nummer ? ` · ${o.dossier_nummer}` : ''} ({aantal(o.aantal)} st.)</option>)}
                </optgroup>
              ))}
            </select>
            {gekozen?.materialen?.length > 0 && <p className="sub">Filament: {gekozen.materialen.map(m => `${m.naam || '?'} (${aantal(m.gram)} g${m.artikel_id ? `, voorraad ${aantal(m.voorraad)}` : ''})`).join(' · ')}</p>}
            {gekozen && run.printer_id && gekozen.printer_id !== run.printer_id && <p className="sub">Deze opdracht staat bij {gekozen.printer}; ze verhuist naar {run.printer || 'deze printer'}.</p>}
          </div>
        )}
        <label className="keuze"><input type="radio" name="kp" checked={keuze === 'nieuw'} onChange={() => setKeuze('nieuw')} />
          <span>Nieuwe printopdracht (eigen product of intern)</span></label>
        {keuze === 'nieuw' && (
          <div className="keuze-sub fgrid">
            <div><label htmlFor="kp-naam">Naam</label><input id="kp-naam" className="inp" value={nieuw.naam} onChange={e => setNieuw(x => ({ ...x, naam: e.target.value }))} /></div>
            <div><label htmlFor="kp-aantal">Aantal stuks</label><input id="kp-aantal" className="inp num" inputMode="decimal" value={nieuw.aantal} onChange={e => setNieuw(x => ({ ...x, aantal: e.target.value }))} /></div>
            <div><label htmlFor="kp-soort">Soort</label>
              <select id="kp-soort" className="inp" value={nieuw.soort} onChange={e => setNieuw(x => ({ ...x, soort: e.target.value }))}>
                <option value="eigen">Eigen product</option><option value="intern">Intern</option>
              </select></div>
            <div style={{ gridColumn: '1 / -1' }}>
              <FilamentInvoer rijen={nieuwMat} onWijzig={setNieuwMat} id="kp-fil" />
              {gemeld && <p className="sub" style={{ margin: '4px 0 0' }}>Gewicht zoals de printer het meldde ({gemeld} g); kies nog het filament.</p>}
            </div>
          </div>
        )}
        <label className="keuze"><input type="radio" name="kp" checked={keuze === 'intern'} onChange={() => setKeuze('intern')} />
          <span>Geen opdracht: intern (telt niet mee)</span></label>
        {keuze === 'intern' && (
          <div className="keuze-sub">
            <label className="sr-only" htmlFor="kp-intern">Soort intern</label>
            <select id="kp-intern" className="inp" value={intern} onChange={e => setIntern(e.target.value)}>
              {Object.entries(INTERN).map(([w, l]) => <option key={w} value={w}>{l}</option>)}
            </select>
          </div>
        )}
      </fieldset>
      <p className="note" style={{ marginBottom: 0 }}>Een klantopdracht zonder printopdracht? Plan ze eerst in het dossier (tabblad Productie) en koppel de run daarna.</p>
    </Dialoog>
  );
}
