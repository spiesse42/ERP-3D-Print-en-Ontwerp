import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, FormKnoppen, Statusbalk, Veld, Tabs, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import Historiek from '../../schil/Historiek.jsx';
import Bijlagen from '../../schil/Bijlagen.jsx';
import Icoon from '../../schil/Icoon.jsx';
import KeuzeMetToevoegen from '../../components/KeuzeMetToevoegen.jsx';
import RegelEditor, { Totalen, TYPES, nieuweRegel, naarApi, vanApi, useBerekening } from '../../components/RegelEditor.jsx';
import { euro, datum } from '../../lib/formaat.js';
import { klantNaam } from '../klanten/klant.js';
import { FASE, SOORT, FaseBadge, VOOR_AFREKENING } from './dossier.jsx';
import { AfrekenDialoog, BetaaldDialoog, Overnamefiche } from './AfrekenDialogen.jsx';
import { OffertesTab, WerkbonTab } from './DocumentTabs.jsx';
import LeveringenTab from './LeveringenTab.jsx';
import ProductieTab from './ProductieTab.jsx';

const LEEG = { soort: 'klant', klant_id: '', titel: '', notities: '' };
function naarFormulier(d, klantUitUrl) {
  if (!d) return { kop: { ...LEEG, klant_id: klantUitUrl || '' }, regels: [] };
  return { kop: { soort: d.soort, klant_id: d.klant_id ? String(d.klant_id) : '', titel: d.titel, notities: d.notities || '' }, regels: d.regels.map(vanApi) };
}
const vergelijk = f => JSON.stringify({ kop: f.kop, regels: f.regels.map(naarApi) });

export default function DossierFormulier() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nieuw = id === 'nieuw';
  const { melding, bevestig, zetVuil, navigeer } = useOmgeving();
  const { data: d, fout, herlaad } = useData(nieuw ? null : `/dossiers/${id}`);
  const { data: klanten, herlaad: herlaadKlanten } = useData('/klanten?archief=alle');
  const { data: printersAlle } = useData('/printers');
  const { data: artikelenAlle, herlaad: herlaadArtikelen } = useData('/voorraad/artikelen?archief=alle');
  const { data: prijsgroepen } = useData('/filament/types');
  const { data: tarievenLijst } = useData('/tarieven');
  const { data: instellingen } = useData('/instellingen');
  const bedrijfNaam = (instellingen || []).find(i => i.sleutel === 'bedrijf_naam')?.waarde || '';
  const [form, setForm] = useState(() => naarFormulier(null, params.get('klant')));
  const [tab, setTab] = useState(() => params.get('tab') || 'regels');
  const [bezig, setBezig] = useState(false);
  const [versie, setVersie] = useState(0);
  const [dialoog, setDialoog] = useState(null);   // 'afrekenen' | 'betaald' | 'overname'

  const origineel = useMemo(() => naarFormulier(nieuw ? null : d, params.get('klant')), [d, nieuw, params]);
  useEffect(() => { setForm(origineel); }, [origineel]);
  const vuil = vergelijk(form) !== vergelijk(origineel);
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);
  const { uitkomst: live } = useBerekening(form.regels);
  // Tot de live-berekening binnen is: de berekening die de backend meestuurde.
  const uitkomst = live || (!nieuw && d && !vuil ? d.berekening : null);
  const tarieven = useMemo(() => Object.fromEntries((tarievenLijst || []).map(t => [t.sleutel, t.waarde])), [tarievenLijst]);

  // Keuzelijsten: actieve printers/artikelen + wat dit dossier al gebruikt
  // (een gedeactiveerde printer of gearchiveerd artikel blijft zichtbaar).
  const gebruikt = veld => new Set(form.regels.map(r => String(r[veld] || '')));
  const printers = (printersAlle || []).filter(p => p.actief || gebruikt('printer_id').has(String(p.id)));
  const artikelenZicht = (artikelenAlle || []).filter(a => !a.gearchiveerd || gebruikt('artikel_id').has(String(a.id))
    || form.regels.some(r => r.materialen?.some(m => m.keuze === `a:${a.id}`)));
  const klantOpties = (klanten || []).filter(k => !k.gearchiveerd || String(k.id) === form.kop.klant_id)
    .map(k => ({ id: k.id, naam: klantNaam(k) })).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));

  const zetKop = k => w => setForm(f => ({ ...f, kop: { ...f.kop, [k]: w } }));
  const body = () => ({ ...form.kop, klant_id: form.kop.soort === 'klant' || form.kop.klant_id ? form.kop.klant_id || null : null, regels: form.regels.map(naarApi) });

  async function opslaan() {
    setBezig(true);
    try {
      if (nieuw) {
        const n = await api.post('/dossiers', body());
        zetVuil(false); melding(`Dossier ${n.nummer} aangemaakt.`); navigeer(`/dossiers/${n.id}`);
      } else {
        await api.put(`/dossiers/${id}`, body());
        await herlaad(); setVersie(v => v + 1); melding('Opgeslagen.');
      }
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }
  function verwerp() {
    if (nieuw) { zetVuil(false); navigeer('/dossiers'); return; }
    setForm(origineel);
  }
  async function verwijder() {
    if (!await bevestig({ titel: 'Dossier verwijderen', tekst: `${d.nummer} wordt definitief verwijderd, met regels, bijlagen en historiek.`, bevestigLabel: 'Definitief verwijderen', gevaarlijk: true })) return;
    try { await api.delete(`/dossiers/${id}`); zetVuil(false); melding('Dossier verwijderd.'); navigeer('/dossiers'); }
    catch (e) { melding(e.message, 'fout'); }
  }
  async function archiveer(aan) {
    try { await api.patch(`/dossiers/${id}/archief`, { gearchiveerd: aan }); await herlaad(); setVersie(v => v + 1); melding(aan ? 'Dossier gearchiveerd.' : 'Dossier hersteld.'); }
    catch (e) { melding(e.message, 'fout'); }
  }
  async function actie(pad, tekst, { vraag, body: b } = {}) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return false; }
    if (vraag && !await bevestig(vraag)) return false;
    try { const r = await api.post(`/dossiers/${id}/${pad}`, b); await herlaad(); setVersie(v => v + 1); melding(typeof tekst === 'function' ? tekst(r) : tekst); return true; }
    catch (e) { melding(e.message, 'fout'); return false; }
  }
  function open(wat) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    setDialoog(wat);
  }
  async function nieuweKlant(naam) { const k = await api.post('/klanten', { type: 'particulier', naam }); await herlaadKlanten(); return k; }

  if (!nieuw && fout) return <><ControlePaneel kruimels={[{ label: 'Dossiers', naar: '/dossiers' }, { label: 'Niet gevonden' }]} /><Fout tekst={fout} /></>;
  if (!nieuw && !d) return <Laden />;

  const fase = nieuw ? 'nieuw' : d.fase;
  const acties = nieuw ? { bewerken: true } : d.acties;
  const kopVast = !acties.bewerken;
  const klantOpdracht = form.kop.soort === 'klant';
  // Afrekenen: bij een klantopdracht in fase "nieuw" altijd zichtbaar; kan het
  // (nog) niet, dan grijs met de reden erbij (wens 25-09).
  const voorAfrekening = VOOR_AFREKENING.includes(fase);
  const afrekenReden = nieuw || d.soort !== 'klant' || !voorAfrekening ? null
    : vuil ? 'Sla eerst je wijzigingen op.'
    : d.regels.length === 0 ? 'Voeg eerst regels toe.'
    : !(d.werkbon || d.zonder_werkbon)?.volledig ? 'Eerst moeten alle regels berekend kunnen worden.'
    : null;
  const toonAfrekenen = !nieuw && d.soort === 'klant' && voorAfrekening;
  const afrekenKnop = toonAfrekenen && (
    <button type="button" className={`btn${acties.starten ? '' : ' primary'}`} disabled={!!afrekenReden} title={afrekenReden || 'Factuur of bonnetje uit Accountable koppelen'}
      onClick={() => open('afrekenen')}>Afrekenen</button>
  );
  // Starten (25-09): werkbon (klantopdracht) + printopdracht per printregel met printer
  const heeftPrint = !nieuw && d.regels.some(r => r.type === 'printen');
  const startTekst = d?.soort === 'klant' ? (heeftPrint ? 'Gestart: werkbon en printopdrachten aangemaakt.' : 'Gestart: werkbon aangemaakt.') : 'Gestart: printopdrachten aangemaakt.';
  const startUitleg = d?.soort === 'klant' ? `Maakt de werkbon${heeftPrint ? ' en een printopdracht per printregel' : ''}. Met een offerte gebeurt dit vanzelf zodra de klant akkoord gaat.` : 'Maakt een printopdracht per printregel.';
  const workflow = nieuw ? null : <>
    {acties.starten && <button type="button" className="btn primary" disabled={vuil} title={vuil ? 'Sla eerst je wijzigingen op.' : startUitleg} onClick={() => actie('starten', r => {
      const run = r?.productie?.te_koppelen_runs?.[0];
      return run ? `${startTekst} Op ${run.printer} staat een run die nog niet gekoppeld is: koppel hem in de tab Productie.` : startTekst;
    })}><Icoon naam="start" maat={14} /> Starten</button>}
    {afrekenKnop}
    {acties.betaald && <button type="button" className="btn primary" onClick={() => open('betaald')}>Betaald</button>}
    {d.soort === 'klant' && d.regels.length > 0 && fase !== 'geannuleerd' && <button type="button" className="btn" onClick={() => open('overname')}>Overnamefiche</button>}
    {acties.betaling_ongedaan && <button type="button" className="btn ghost" onClick={() => actie('betaling-ongedaan', 'Betaling ongedaan gemaakt.', { vraag: { titel: 'Betaling ongedaan maken', tekst: 'Het dossier gaat terug naar afgerekend.', bevestigLabel: 'Ongedaan maken', annuleerLabel: 'Terug' } })}>Betaling ongedaan</button>}
    {acties.afrekening_ongedaan && <button type="button" className="btn ghost" onClick={() => actie('afrekening-ongedaan', 'Afrekening ongedaan gemaakt.', { vraag: { titel: 'Afrekening ongedaan maken', tekst: `De verwijzing naar ${d.afgerekend_soort} ${d.afgerekend_nummer} wordt gewist en het dossier kan weer gewijzigd worden. Pas dit ook aan in Accountable (bv. een creditnota).`, bevestigLabel: 'Ongedaan maken', annuleerLabel: 'Terug', gevaarlijk: true } })}>Afrekening ongedaan</button>}
    {acties.annuleren && <button type="button" className="btn ghost" onClick={() => actie('annuleren', 'Dossier geannuleerd.', { vraag: { titel: 'Dossier annuleren', tekst: `${d.nummer} annuleren? Je kunt het later heropenen.`, bevestigLabel: 'Annuleren', annuleerLabel: 'Terug' } })}>Annuleren</button>}
    {acties.heropenen && <button type="button" className="btn" onClick={() => actie('heropenen', 'Dossier heropend.')}>Heropenen</button>}
  </>;
  const stappen = nieuw ? ['nieuw'] : d.stappen;

  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Dossiers', naar: '/dossiers' }, { label: nieuw ? 'Nieuw' : d.nummer, mono: true }]} />
      <div className="sheet-wrap">
        <div className="sheet">
          <FormKnoppen vuil={vuil} nieuw={nieuw} bezig={bezig} onOpslaan={opslaan} onVerwerp={verwerp}
            gearchiveerd={d?.gearchiveerd} onArchiveer={nieuw ? null : archiveer}
            onVerwijder={!nieuw && acties.verwijderen ? verwijder : null}
            terug={{ label: 'Dossiers', naar: '/dossiers' }}
            links={fase === 'geannuleerd' ? <span className="lint">Geannuleerd</span> : null} />
          {!nieuw && (
            <div className="sheet-status">
              <div className="btns">{workflow}</div>
              {fase !== 'geannuleerd' && stappen.length > 1 && <Statusbalk stappen={stappen.map(s => FASE[s][1])} huidig={stappen.indexOf(fase)} />}
            </div>
          )}
          {toonAfrekenen && (
            <div className="waarschuwing info-lint" role="status">
              <span><Icoon naam="let" maat={16} /> Nog af te rekenen in Accountable (factuur of bonnetje).</span>
              {afrekenReden && <span className="sub" style={{ color: 'inherit' }}>{afrekenReden}</span>}
              <span style={{ marginLeft: 'auto' }}>{afrekenKnop}</span>
            </div>
          )}
          <div className="sheet-head">
            <div className="kop">
              <div className="nr">Dossier{!nieuw && ` · ${SOORT[d.soort]}`}</div>
              <h2 className="mono-titel">{nieuw ? 'Nieuw' : d.nummer}</h2>
            </div>
          </div>
          <div className="fields">
            <div>
              <Veld label="Titel" id="d-titel">
                <input id="d-titel" className="inp" disabled={kopVast} value={form.kop.titel} onChange={e => zetKop('titel')(e.target.value)} placeholder="bv. Naamplaatje fiets" autoFocus={nieuw} />
              </Veld>
              <Veld label="Soort" id="d-soort">
                <select id="d-soort" className="inp" disabled={kopVast} value={form.kop.soort} onChange={e => zetKop('soort')(e.target.value)}>
                  {Object.entries(SOORT).map(([w, l]) => <option key={w} value={w}>{l}</option>)}
                </select>
              </Veld>
              <Veld label="Klant" id="d-klant" hint={klantOpdracht ? null : 'Optioneel bij een eigen product of intern dossier.'}>
                {kopVast ? (d.klant_id ? <Link naar={`/klanten/${d.klant_id}`}>{d.klant}</Link> : <span className="sub">—</span>) : (
                  <KeuzeMetToevoegen id="d-klant" ariaLabel="Klant" waarde={form.kop.klant_id} leegLabel="Geen klant"
                    opties={klantOpties} onKies={zetKop('klant_id')} onNieuw={nieuweKlant} watLabel="klant" />
                )}
              </Veld>
            </div>
            <div>
              <Veld label="Fase"><FaseBadge fase={fase} /></Veld>
              <Veld label="Totaal">{uitkomst ? (uitkomst.volledig ? <b className="num">{euro(uitkomst.totaal)}</b> : <span className="badge b-warn">onvolledig</span>) : <span className="sub">—</span>}</Veld>
              {!nieuw && d.afgerekend_op && (
                <Veld label="Afgerekend">
                  <span><span className="mono">{d.afgerekend_soort} {d.afgerekend_nummer}</span> · {datum(d.afgerekend_op)} · <span className="num">{euro(d.afgerekend_bedrag)}</span></span>
                </Veld>
              )}
              {!nieuw && d.betaald_op && <Veld label="Betaald op"><span className="num">{datum(d.betaald_op)}</span></Veld>}
            </div>
          </div>

          <Tabs tabs={[['regels', `Regels (${form.regels.length})`], ...(nieuw ? [] : [...(d.soort === 'klant' ? [['offertes', `Offertes (${d.offertes.length})`]] : []), ...(d.productie?.regels.length ? [['productie', <>Productie ({d.productie.aantal_opdrachten}){d.productie.te_koppelen_runs?.length > 0 && <span className="tab-stip" title="Run(s) te koppelen" aria-label="runs te koppelen" />}</>]] : []), ['werkbon', 'Werkbon'], ...(d.soort === 'klant' ? [['leveringen', `Leveringen (${d.leveringen.length})`]] : []), ['bijlagen', 'Bijlagen']]), ['notities', 'Notities']]} actief={tab} onKies={setTab} />
          <div className="tabpanel">
            {tab === 'regels' && (
              <>
                <RegelEditor regels={form.regels} onWijzig={regels => setForm(f => ({ ...f, regels: typeof regels === 'function' ? regels(f.regels) : regels }))}
                  uitkomst={uitkomst} tarieven={tarieven} printers={printers} alleenLezen={kopVast}
                  filamenten={artikelenZicht.filter(a => a.type === 'filament')} prijsgroepen={prijsgroepen}
                  artikelen={artikelenZicht.filter(a => a.type !== 'filament' && a.wordt_verkocht)}
                  herkomst="dossier" onArtikelGemaakt={herlaadArtikelen}
                  eindproducten={form.kop.soort === 'eigen' ? artikelenZicht.filter(a => a.type === 'artikel' && a.zelf_geprint) : null} />
                {!kopVast && (
                  <div className="toevoegen">
                    {TYPES.map(([w, l]) => <button key={w} type="button" className="btn" onClick={() => setForm(f => ({ ...f, regels: [...f.regels, nieuweRegel(w)] }))}><Icoon naam="plus" maat={14} /> {l}</button>)}
                  </div>
                )}
                <Totalen uitkomst={form.regels.length ? uitkomst : null} />
                {kopVast && fase !== 'geannuleerd' && <p className="note">Dit dossier is afgerekend en ligt vast. Wil je nog iets wijzigen, maak dan eerst de afrekening ongedaan.</p>}
              </>
            )}
            {tab === 'offertes' && !nieuw && <OffertesTab d={d} vuil={vuil} herlaad={async () => { await herlaad(); setVersie(v => v + 1); }} bedrijf={bedrijfNaam} />}
            {tab === 'productie' && !nieuw && <ProductieTab d={d} vuil={vuil} herlaad={async () => { await herlaad(); setVersie(v => v + 1); }} />}
            {tab === 'werkbon' && !nieuw && <WerkbonTab d={d} vuil={vuil} herlaad={async () => { await herlaad(); setVersie(v => v + 1); }} bedrijf={bedrijfNaam} />}
            {tab === 'leveringen' && !nieuw && <LeveringenTab d={d} vuil={vuil} herlaad={async () => { await herlaad(); setVersie(v => v + 1); }} bedrijf={bedrijfNaam} />}
            {tab === 'bijlagen' && !nieuw && <Bijlagen entiteit="dossier" id={id} onGewijzigd={() => setVersie(v => v + 1)} />}
            {tab === 'notities' && (
              <>
                <label className="sr-only" htmlFor="d-notities">Notities</label>
                <textarea id="d-notities" className="inp" rows={4} disabled={fase === 'geannuleerd'} value={form.kop.notities} onChange={e => zetKop('notities')(e.target.value)} placeholder="Afspraken met de klant, kleurwensen, leverdatum…" />
              </>
            )}
          </div>
        </div>
        {!nieuw && <Historiek entiteit="dossier" id={id} versie={versie} />}
      </div>
      {dialoog === 'afrekenen' && <AfrekenDialoog dossier={d} onSluit={() => setDialoog(null)}
        onBevestig={async f => { if (await actie('afrekenen', f.soort === 'bonnetje' ? 'Afgerekend en betaald.' : 'Afgerekend.', { body: f })) setDialoog(null); }} />}
      {dialoog === 'betaald' && <BetaaldDialoog onSluit={() => setDialoog(null)}
        onBevestig={async datum => { if (await actie('betaald', 'Betaald.', { body: { datum } })) setDialoog(null); }} />}
      {dialoog === 'overname' && <Overnamefiche dossier={d} onSluit={() => setDialoog(null)} />}
    </>
  );
}
