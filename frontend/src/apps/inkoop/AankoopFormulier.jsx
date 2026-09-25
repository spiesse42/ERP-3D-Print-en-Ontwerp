import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, FormKnoppen, Statusbalk, Veld, Tabs, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import Historiek from '../../schil/Historiek.jsx';
import Bijlagen from '../../schil/Bijlagen.jsx';
import Icoon from '../../schil/Icoon.jsx';
import KeuzeMetToevoegen from '../../components/KeuzeMetToevoegen.jsx';
import { euro, aantal, datum, naarInvoer, uitInvoer, vandaag } from '../../lib/formaat.js';
import { STAPPEN, STAP_INDEX, AankoopStatus } from './aankoop.jsx';
import OntvangDialoog from './OntvangDialoog.jsx';

let volgnr = 0;
const nieuweSleutel = () => `n${++volgnr}`;
const s = v => (v == null ? '' : String(v));

function naarFormulier(a) {
  if (!a) return { kop: { leverancier_id: '', datum: vandaag(), extern_bestelnummer: '', extern_factuurnummer: '', notities: '' }, regels: [] };
  return {
    kop: { leverancier_id: s(a.leverancier_id), datum: a.datum, extern_bestelnummer: a.extern_bestelnummer || '', extern_factuurnummer: a.extern_factuurnummer || '', notities: a.notities || '' },
    regels: a.regels.map(r => ({
      sleutel: `r${r.id}`, id: r.id, soort: r.soort, artikel_id: s(r.artikel_id),
      plaatshouder_materiaal_id: s(r.plaatshouder_materiaal_id), plaatshouder_kleur_id: s(r.plaatshouder_kleur_id),
      omschrijving: r.omschrijving || '', aantal: naarInvoer(r.aantal), prijs_per_eenheid: naarInvoer(r.prijs_per_eenheid),
    })),
  };
}
const SOORT_LABEL = { artikel: 'Artikel', plaatshouder: 'Filament (merk later)', kost: 'Kost' };
const LEGE_REGEL = { soort: 'artikel', artikel_id: '', plaatshouder_materiaal_id: '', plaatshouder_kleur_id: '', omschrijving: '', aantal: '1', prijs_per_eenheid: '' };

export default function AankoopFormulier() {
  const { id } = useParams();
  const nieuw = id === 'nieuw';
  const { melding, bevestig, zetVuil, navigeer } = useOmgeving();
  const { data: ak, fout, herlaad } = useData(nieuw ? null : `/inkoop/aankopen/${id}`);
  const { data: leveranciers, herlaad: herlaadLev } = useData('/leveranciers');
  const { data: artikelen } = useData('/voorraad/artikelen');
  const { data: materialen } = useData('/filament/materialen');
  const { data: kleuren } = useData('/filament/kleuren');
  const [form, setForm] = useState(() => naarFormulier(null));
  const [tab, setTab] = useState('regels');
  const [bezig, setBezig] = useState(false);
  const [versie, setVersie] = useState(0);
  const [ontvangen, setOntvangen] = useState(false);
  const { data: prijzen } = useData(form.kop.leverancier_id ? `/inkoop/prijzen?leverancier_id=${form.kop.leverancier_id}` : '/inkoop/prijzen');

  const origineel = useMemo(() => naarFormulier(nieuw ? null : ak), [ak, nieuw]);
  useEffect(() => { setForm(origineel); }, [origineel]);
  const vergelijk = f => JSON.stringify({ kop: f.kop, regels: f.regels.map(({ sleutel, ...r }) => r) });
  const vuil = vergelijk(form) !== vergelijk(origineel);
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);

  const status = nieuw ? 'concept' : ak?.status;
  const alleenLezen = status === 'geannuleerd';
  const oudPerId = new Map((ak?.regels || []).map(r => [r.id, r]));
  const zetKop = k => w => setForm(f => ({ ...f, kop: { ...f.kop, [k]: w } }));
  const zetRegel = (i, k) => w => setForm(f => ({ ...f, regels: f.regels.map((r, j) => {
    if (j !== i) return r;
    const n = { ...r, [k]: w };
    // artikel gekozen en nog geen prijs → laatste prijs bij deze leverancier
    if (k === 'artikel_id' && w && !r.prijs_per_eenheid && prijzen?.[w]?.prijs != null) n.prijs_per_eenheid = naarInvoer(prijzen[w].prijs);
    if (k === 'soort') Object.assign(n, { artikel_id: '', plaatshouder_materiaal_id: '', plaatshouder_kleur_id: '' });
    return n;
  }) }));
  const totaal = form.regels.reduce((t, r) => { const a = uitInvoer(r.aantal), p = uitInvoer(r.prijs_per_eenheid); return t + (a > 0 && p >= 0 ? a * p : 0); }, 0);

  const body = () => ({
    ...form.kop,
    regels: form.regels.map(r => ({ ...r, aantal: uitInvoer(r.aantal), prijs_per_eenheid: uitInvoer(r.prijs_per_eenheid) })),
  });

  async function opslaan() {
    setBezig(true);
    try {
      if (nieuw) {
        const { id: nieuwId } = await api.post('/inkoop/aankopen', body());
        zetVuil(false); melding('Aankoop aangemaakt.'); navigeer(`/inkoop/aankopen/${nieuwId}`);
      } else {
        await api.put(`/inkoop/aankopen/${id}`, body());
        await herlaad(); setVersie(v => v + 1); melding('Opgeslagen.');
      }
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }
  function verwerp() {
    if (nieuw) { zetVuil(false); navigeer('/inkoop/aankopen'); return; }
    setForm(origineel);
  }
  async function verwijder() {
    if (!await bevestig({ titel: 'Aankoop verwijderen', tekst: `${ak.nummer} wordt definitief verwijderd, met regels en bijlagen.`, bevestigLabel: 'Definitief verwijderen', gevaarlijk: true })) return;
    try { await api.delete(`/inkoop/aankopen/${id}`); zetVuil(false); melding('Aankoop verwijderd.'); navigeer('/inkoop/aankopen'); }
    catch (e) { melding(e.message, 'fout'); }
  }
  async function actie(pad, tekst, vraag) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    if (vraag && !await bevestig(vraag)) return;
    try { await api.post(`/inkoop/aankopen/${id}/${pad}`); await herlaad(); setVersie(v => v + 1); melding(tekst); }
    catch (e) { melding(e.message, 'fout'); }
  }
  function startOntvangen() {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    if (!ak.leverancier_id) { melding('Kies eerst een leverancier en sla op.', 'fout'); return; }
    setOntvangen(true);
  }
  async function nieuweLeverancier(naam) { const l = await api.post('/leveranciers', { naam }); await herlaadLev(); return l; }

  if (!nieuw && fout) return <><ControlePaneel kruimels={[{ label: 'Aankopen', naar: '/inkoop/aankopen' }, { label: 'Niet gevonden' }]} /><Fout tekst={fout} /></>;
  if (!nieuw && !ak) return <Laden />;

  const heeftOpen = !nieuw && ak.regels.some(r => r.openstaand > 0);
  const workflow = nieuw ? null : ({
    concept: <>
      <button type="button" className="btn primary" onClick={() => actie('bestellen', 'Besteld.')}>Bestellen</button>
      {heeftOpen && <button type="button" className="btn" onClick={startOntvangen}>Direct ontvangen</button>}
      <button type="button" className="btn ghost" onClick={() => actie('annuleren', 'Aankoop geannuleerd.', { titel: 'Aankoop annuleren', tekst: `${ak.nummer} annuleren?`, bevestigLabel: 'Annuleren', annuleerLabel: 'Terug' })}>Annuleren</button>
    </>,
    besteld: <>
      <button type="button" className="btn primary" onClick={startOntvangen}>Ontvangen</button>
      <button type="button" className="btn ghost" onClick={() => actie('heropenen', 'Terug naar concept.')}>Terug naar concept</button>
      <button type="button" className="btn ghost" onClick={() => actie('annuleren', 'Aankoop geannuleerd.', { titel: 'Bestelling annuleren', tekst: `${ak.nummer} annuleren? Niets is al ontvangen.`, bevestigLabel: 'Annuleren', annuleerLabel: 'Terug' })}>Annuleren</button>
    </>,
    deels: <button type="button" className="btn primary" onClick={startOntvangen}>Rest ontvangen</button>,
    ontvangen: null,
    geannuleerd: <button type="button" className="btn" onClick={() => actie('heropenen', 'Aankoop heropend.')}>Heropenen</button>,
  })[status];

  const artOpties = (artikelen || []);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Aankopen', naar: '/inkoop/aankopen' }, { label: nieuw ? 'Nieuw' : ak.nummer, mono: true }]} />
      <div className="sheet-wrap">
        <div className="sheet">
          <FormKnoppen vuil={vuil} nieuw={nieuw} bezig={bezig} onOpslaan={opslaan} onVerwerp={verwerp}
            onVerwijder={!nieuw && status === 'concept' ? verwijder : null}
            terug={{ label: 'Aankopen', naar: '/inkoop/aankopen' }}
            links={status === 'geannuleerd' ? <span className="lint">Geannuleerd</span> : null} />
          {!nieuw && (
            <div className="sheet-status">
              <div className="btns">{workflow}</div>
              {status !== 'geannuleerd' && <Statusbalk stappen={STAPPEN} huidig={STAP_INDEX[status]} />}
            </div>
          )}
          <div className="sheet-head">
            <div className="kop">
              <div className="nr">Aankoop</div>
              <h2 className="mono-titel">{nieuw ? 'Nieuw' : ak.nummer}</h2>
            </div>
          </div>
          <div className="fields">
            <div>
              <Veld label="Leverancier" id="ak-lev">
                {alleenLezen ? <span>{ak.leverancier || '—'}</span> : (
                  <KeuzeMetToevoegen id="ak-lev" ariaLabel="Leverancier" waarde={form.kop.leverancier_id} leegLabel="Kies een leverancier…"
                    opties={leveranciers || []} onKies={zetKop('leverancier_id')} onNieuw={nieuweLeverancier} watLabel="leverancier" />
                )}
              </Veld>
              <Veld label="Datum" id="ak-datum" hint="Datum van de bestelling of van de factuur/het bonnetje.">
                <input id="ak-datum" type="date" className="inp" disabled={alleenLezen} value={form.kop.datum} onChange={e => zetKop('datum')(e.target.value)} />
              </Veld>
              <Veld label="Bestelnr. webshop" id="ak-bnr" hint="Van de bestelbon. Een factuur met dit nummer wordt aan deze aankoop gekoppeld.">
                <input id="ak-bnr" className="inp" disabled={alleenLezen} value={form.kop.extern_bestelnummer} onChange={e => zetKop('extern_bestelnummer')(e.target.value)} />
              </Veld>
              <Veld label="Factuurnr. leverancier" id="ak-fnr" hint="Enkel intern, komt nooit op een klantdocument.">
                <input id="ak-fnr" className="inp" disabled={alleenLezen} value={form.kop.extern_factuurnummer} onChange={e => zetKop('extern_factuurnummer')(e.target.value)} />
              </Veld>
            </div>
            <div>
              <Veld label="Status">{nieuw ? <span className="sub">Concept</span> : <AankoopStatus status={status} />}</Veld>
              {!nieuw && <Veld label="Besteld op"><span className="num">{ak.besteld_op ? datum(ak.besteld_op) : '—'}</span></Veld>}
              <Veld label="Totaal"><b className="num">{euro(totaal)}</b> <span className="sub">incl. btw</span></Veld>
            </div>
          </div>

          <Tabs tabs={[['regels', `Regels (${form.regels.length})`], ...(nieuw ? [] : [['bijlagen', 'Bijlagen']]), ['notities', 'Notities']]} actief={tab} onKies={setTab} />
          <div className="tabpanel">
            {tab === 'regels' && (
              <>
                {form.regels.length > 0 && (
                  <div className="tabelvak">
                    <table className="mini regeltabel">
                      <thead><tr>
                        <th>Soort</th><th>Wat</th><th className="r">Aantal</th><th className="r">Prijs/eenheid</th><th className="r">Subtotaal</th>
                        {!nieuw && <th className="r">Ontvangen</th>}<th><span className="sr-only">Weg</span></th>
                      </tr></thead>
                      <tbody>
                        {form.regels.map((r, i) => {
                          const oud = r.id ? oudPerId.get(r.id) : null;
                          const vast = alleenLezen || (oud?.ontvangen > 0);
                          const a = uitInvoer(r.aantal), p = uitInvoer(r.prijs_per_eenheid);
                          const art = artOpties.find(x => String(x.id) === r.artikel_id);
                          return (
                            <tr key={r.sleutel}>
                              <td style={{ width: 170 }}>
                                {vast ? <span className="sub">{SOORT_LABEL[r.soort]}</span> : (
                                  <select className="inp" aria-label="Soort regel" value={r.soort} onChange={e => zetRegel(i, 'soort')(e.target.value)}>
                                    {Object.entries(SOORT_LABEL).map(([w, l]) => <option key={w} value={w}>{l}</option>)}
                                  </select>
                                )}
                              </td>
                              <td style={{ minWidth: 240 }}>
                                {r.soort === 'artikel' && (vast ? <span>{oud?.weergave}</span> : (
                                  <>
                                    <select className="inp" aria-label="Artikel" value={r.artikel_id} onChange={e => zetRegel(i, 'artikel_id')(e.target.value)}>
                                      <option value="">Kies een artikel…</option>
                                      {artOpties.map(x => <option key={x.id} value={x.id}>{x.weergave}{x.type === 'dienst' ? ' (dienst)' : ''}</option>)}
                                    </select>
                                    {prijzen?.[r.artikel_id]?.productcode && <div className="sub mono">{prijzen[r.artikel_id].productcode}</div>}
                                  </>
                                ))}
                                {r.soort === 'plaatshouder' && (vast ? <span>{oud?.weergave}</span> : (
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <select className="inp" aria-label="Type filament" value={r.plaatshouder_materiaal_id} onChange={e => zetRegel(i, 'plaatshouder_materiaal_id')(e.target.value)}>
                                      <option value="">Type…</option>
                                      {(materialen || []).map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                                    </select>
                                    <select className="inp" aria-label="Kleur" value={r.plaatshouder_kleur_id} onChange={e => zetRegel(i, 'plaatshouder_kleur_id')(e.target.value)}>
                                      <option value="">Kleur…</option>
                                      {(kleuren || []).map(k => <option key={k.id} value={k.id}>{k.naam}</option>)}
                                    </select>
                                  </div>
                                ))}
                                {r.soort === 'kost' && (
                                  <input className="inp" aria-label="Omschrijving" disabled={alleenLezen} placeholder="bv. Verzending" value={r.omschrijving} onChange={e => zetRegel(i, 'omschrijving')(e.target.value)} />
                                )}
                              </td>
                              <td className="r"><input className="inp num" aria-label="Aantal" inputMode="decimal" style={{ width: 70 }} disabled={alleenLezen} value={r.aantal} onChange={e => zetRegel(i, 'aantal')(e.target.value)} />{art && <div className="sub">{art.eenheid}</div>}</td>
                              <td className="r"><input className="inp num" aria-label="Prijs per eenheid" inputMode="decimal" style={{ width: 80 }} disabled={vast} value={r.prijs_per_eenheid} onChange={e => zetRegel(i, 'prijs_per_eenheid')(e.target.value)} /></td>
                              <td className="r num">{a > 0 && p >= 0 && p !== null ? euro(a * p) : <span className="sub">—</span>}</td>
                              {!nieuw && <td className="r num">{oud?.ontvangbaar ? `${aantal(oud.ontvangen)} / ${aantal(oud.aantal)}` : <span className="sub">—</span>}</td>}
                              <td>{!vast && <button type="button" className="btn ghost" aria-label="Regel weghalen" onClick={() => setForm(f => ({ ...f, regels: f.regels.filter((_, j) => j !== i) }))}><Icoon naam="kruis" maat={14} /></button>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {!alleenLezen && (
                  <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setForm(f => ({ ...f, regels: [...f.regels, { ...LEGE_REGEL, sleutel: nieuweSleutel() }] }))}>
                    <Icoon naam="plus" maat={16} /> Regel toevoegen
                  </button>
                )}
                <p className="note">Prijzen incl. btw. Verzendkosten als aparte kostregel; die tellen niet mee in de kostprijs van de artikelen. Een nieuw artikel maak je eerst aan in <Link naar="/voorraad/artikelen/nieuw">Voorraad → Artikelen</Link>.</p>
              </>
            )}
            {tab === 'bijlagen' && !nieuw && <Bijlagen entiteit="aankoop" id={id} onGewijzigd={() => setVersie(v => v + 1)} />}
            {tab === 'notities' && (
              <>
                <label className="sr-only" htmlFor="ak-notities">Notities</label>
                <textarea id="ak-notities" className="inp" rows={4} disabled={alleenLezen} value={form.kop.notities} onChange={e => zetKop('notities')(e.target.value)} placeholder="Bv. bestelnummer op de website, afspraken over levering…" />
              </>
            )}
          </div>
        </div>
        {!nieuw && <Historiek entiteit="aankoop" id={id} versie={versie} />}
      </div>
      {ontvangen && <OntvangDialoog aankoop={ak} onSluit={() => setOntvangen(false)} onKlaar={async () => { setOntvangen(false); await herlaad(); setVersie(v => v + 1); }} />}
    </>
  );
}
