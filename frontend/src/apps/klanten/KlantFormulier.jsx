import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, FormKnoppen, SlimmeKnop, Veld, Tabs, Laden, Fout } from '../../schil/Weergaven.jsx';
import Historiek from '../../schil/Historiek.jsx';
import { klantNaam, peppolVoorstel, naarFormulier, LEGE_KLANT, LANDEN } from './klant.js';

// Invoerveld op moduleniveau (niet genest), anders verliest het de focus
// bij elke toetsaanslag.
function Invoer({ id, waarde, onWijzig, ...rest }) {
  return <input id={id} className="inp" value={waarde} onChange={e => onWijzig(e.target.value)} {...rest} />;
}

export default function KlantFormulier() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nieuw = id === 'nieuw';
  const { melding, bevestig, zetVuil, navigeer } = useOmgeving();
  const { data: klant, fout, herlaad } = useData(nieuw ? null : `/klanten/${id}`);
  const { data: alle } = useData('/klanten?archief=alle');
  const [form, setForm] = useState(LEGE_KLANT);
  const [tab, setTab] = useState('notities');
  const [bezig, setBezig] = useState(false);
  const [versie, setVersie] = useState(0);

  // nieuwe klant vanuit een mail (30-09): naam en e-mailadres voorinvullen
  const uitUrl = useMemo(() => {
    if (!nieuw) return null;
    const naam = (params.get('naam') || '').trim(), email = (params.get('email') || '').trim();
    if (!naam && !email) return null;
    const [voornaam, ...rest] = naam.split(/\s+/);
    return { ...LEGE_KLANT, email, ...(rest.length ? { voornaam, naam: rest.join(' ') } : { naam }) };
  }, [nieuw, params]);
  useEffect(() => { setForm(uitUrl || naarFormulier(nieuw ? null : klant)); }, [klant, nieuw, uitUrl]);

  const origineel = useMemo(() => naarFormulier(nieuw ? null : klant), [klant, nieuw]);
  const vuil = JSON.stringify(form) !== JSON.stringify(origineel);
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);

  const zet = (veld) => (w) => setForm(f => ({ ...f, [veld]: w }));
  const zakelijk = form.type === 'zakelijk';
  const [gevonden, setGevonden] = useState(null);   // resultaat van "Opzoeken" (btw-nummer)
  const [zoekt, setZoekt] = useState(false);
  const voorstel = zakelijk && !form.peppol_id && !gevonden ? peppolVoorstel(form.btw_nummer, form.land) : null;

  // Opzoeken op btw-nummer (29-09): naam + adres (VIES) en Peppol-ID.
  async function zoekOp() {
    if (!form.btw_nummer.trim()) { melding('Vul eerst het btw-nummer in (bv. BE0123456789 of NL123456789B01).', 'fout'); return; }
    setZoekt(true);
    try { setGevonden(await api.get(`/klanten/opzoeken?btw=${encodeURIComponent(form.btw_nummer)}&land=${encodeURIComponent(form.land || 'BE')}`)); }
    catch (e) { melding(e.message, 'fout'); }
    finally { setZoekt(false); }
  }
  function neemOver() {
    const v = gevonden?.vies || {};
    setForm(f => ({ ...f, type: 'zakelijk', btw_nummer: gevonden.btw, land: gevonden.land === 'BE' ? '' : gevonden.land,
      ...(v.naam ? { bedrijfsnaam: v.naam } : {}),
      ...(v.straat ? { straat: v.straat, huisnummer: v.huisnummer || '' } : {}),
      ...(v.postcode ? { postcode: v.postcode, gemeente: v.gemeente || '' } : {}),
      ...(gevonden.peppol ? { peppol_id: gevonden.peppol.id } : {}) }));
  }

  // Vorige/volgende in de (actieve) klantenlijst, zoals de pijltjes in Odoo.
  const actieve = (alle || []).filter(k => !k.gearchiveerd).sort((a, b) => klantNaam(a).localeCompare(klantNaam(b), 'nl'));
  const pos = actieve.findIndex(k => String(k.id) === String(id));

  async function opslaan() {
    if (!zakelijk && !form.naam.trim()) { melding('Naam is verplicht.', 'fout'); document.getElementById('k-naam')?.focus(); return; }
    if (zakelijk && !form.bedrijfsnaam.trim() && !form.naam.trim()) { melding('Bedrijfsnaam is verplicht.', 'fout'); document.getElementById('k-bedrijf')?.focus(); return; }
    setBezig(true);
    try {
      if (nieuw) {
        const { id: nieuwId } = await api.post('/klanten', form);
        zetVuil(false);
        melding('Klant aangemaakt.');
        navigeer(`/klanten/${nieuwId}`);
      } else {
        await api.put(`/klanten/${id}`, form);
        await herlaad();
        setVersie(v => v + 1);
        melding('Opgeslagen.');
      }
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  function verwerp() {
    if (nieuw) { zetVuil(false); navigeer('/klanten'); return; }
    setForm(origineel);
  }

  async function archiveer(aan) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    if (aan && !await bevestig({ titel: 'Klant archiveren', tekst: `${klantNaam(klant)} verdwijnt uit de lijsten, maar blijft bewaard. Je kunt de klant later herstellen via de filter "Gearchiveerd".`, bevestigLabel: 'Archiveren' })) return;
    try {
      await api.patch(`/klanten/${id}/archief`, { gearchiveerd: aan });
      await herlaad(); setVersie(v => v + 1);
      melding(aan ? 'Klant gearchiveerd.' : 'Klant hersteld.');
    } catch (e) { melding(e.message, 'fout'); }
  }

  async function verwijder() {
    if (!await bevestig({ titel: 'Klant verwijderen', tekst: `${klantNaam(klant)} wordt definitief verwijderd, samen met de historiek. Dit kan niet ongedaan gemaakt worden. Archiveren is meestal beter.`, bevestigLabel: 'Definitief verwijderen', gevaarlijk: true })) return;
    try {
      await api.delete(`/klanten/${id}`);
      zetVuil(false);
      melding('Klant verwijderd.');
      navigeer('/klanten');
    } catch (e) { melding(e.message, 'fout'); }
  }

  if (!nieuw && fout) return <><ControlePaneel kruimels={[{ label: 'Klanten', naar: '/klanten' }, { label: 'Niet gevonden' }]} /><Fout tekst={fout} /></>;
  if (!nieuw && !klant) return <Laden />;

  const titel = nieuw ? 'Nieuw' : klantNaam(klant);
  const archief = !nieuw && klant?.gearchiveerd;

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Klanten', naar: '/klanten' }, { label: titel }]}
        rechts={!nieuw && pos >= 0 && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <span className="pager num">{pos + 1} / {actieve.length}</span>
            <button type="button" className="btn ghost" aria-label="Vorige klant" disabled={pos <= 0} onClick={() => navigeer(`/klanten/${actieve[pos - 1].id}`)}>‹</button>
            <button type="button" className="btn ghost" aria-label="Volgende klant" disabled={pos >= actieve.length - 1} onClick={() => navigeer(`/klanten/${actieve[pos + 1].id}`)}>›</button>
          </span>
        )}
      />
      <div className="sheet-wrap">
        <div className="sheet">
          <FormKnoppen vuil={vuil} nieuw={nieuw} bezig={bezig} onOpslaan={opslaan} onVerwerp={verwerp}
            gearchiveerd={archief} onArchiveer={nieuw ? null : archiveer} onVerwijder={nieuw ? null : verwijder}
            terug={{ label: 'Klanten', naar: '/klanten' }} />
          <div className="sheet-head">
            <div className="kop">
              <div className="seg" role="group" aria-label="Type klant" style={{ marginBottom: 8 }}>
                <button type="button" aria-pressed={!zakelijk} onClick={() => zet('type')('particulier')}>Particulier</button>
                <button type="button" aria-pressed={zakelijk} onClick={() => zet('type')('zakelijk')}>Zakelijk</button>
              </div>
              {zakelijk ? (
                <>
                  <label className="sr-only" htmlFor="k-bedrijf">Bedrijfsnaam</label>
                  <Invoer id="k-bedrijf" waarde={form.bedrijfsnaam || ''} onWijzig={zet('bedrijfsnaam')} className="inp titelveld" placeholder="Bedrijfsnaam (verplicht)" />
                </>
              ) : (
                <div className="samen" style={{ display: 'flex', gap: 10 }}>
                  <label className="sr-only" htmlFor="k-voornaam">Voornaam</label>
                  <Invoer id="k-voornaam" waarde={form.voornaam || ''} onWijzig={zet('voornaam')} className="inp titelveld" placeholder="Voornaam" />
                  <label className="sr-only" htmlFor="k-naam">Naam</label>
                  <Invoer id="k-naam" waarde={form.naam || ''} onWijzig={zet('naam')} className="inp titelveld" placeholder="Naam (verplicht)" />
                </div>
              )}
            </div>
            {!nieuw && (
              <div className="smart">
                <SlimmeKnop icoon="map" getal={klant.aantal_dossiers ?? 0} label="Dossiers" naar={`/dossiers?klant=${klant.id}`} />
              </div>
            )}
          </div>
          <div className="fields">
            <div>
              {zakelijk && (
                <Veld label="Contactpersoon" id="k-naam">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Invoer id="k-voornaam" waarde={form.voornaam || ''} onWijzig={zet('voornaam')} placeholder="Voornaam" aria-label="Voornaam contactpersoon" />
                    <Invoer id="k-naam" waarde={form.naam || ''} onWijzig={zet('naam')} placeholder="Naam" />
                  </div>
                </Veld>
              )}
              <Veld label="Adres" id="k-straat">
                <div style={{ display: 'flex', gap: 8 }}>
                  <Invoer id="k-straat" waarde={form.straat || ''} onWijzig={zet('straat')} placeholder="Straat" />
                  <Invoer id="k-nr" waarde={form.huisnummer || ''} onWijzig={zet('huisnummer')} placeholder="Nr." style={{ maxWidth: 70 }} aria-label="Huisnummer" />
                </div>
              </Veld>
              <Veld label="Postcode, gemeente" id="k-postcode">
                <div style={{ display: 'flex', gap: 8 }}>
                  <Invoer id="k-postcode" waarde={form.postcode || ''} onWijzig={zet('postcode')} placeholder="2440" style={{ maxWidth: 90 }} inputMode="numeric" />
                  <Invoer id="k-gemeente" waarde={form.gemeente || ''} onWijzig={zet('gemeente')} placeholder="Gemeente" aria-label="Gemeente" />
                </div>
              </Veld>
              <Veld label="Land" id="k-land">
                <select id="k-land" className="inp" value={form.land || ''} onChange={e => zet('land')(e.target.value)}>
                  {LANDEN.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  {form.land && !LANDEN.some(([c]) => c === form.land) && <option value={form.land}>{form.land}</option>}
                </select>
              </Veld>
              <Veld label="Btw-nummer" id="k-btw" hint={zakelijk ? 'Met landcode (BE0123456789, NL123456789B01). "Opzoeken" haalt naam, adres en Peppol-ID op.' : 'Enkel als een particulier toch een nummer heeft.'}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Invoer id="k-btw" waarde={form.btw_nummer || ''} onWijzig={w => { zet('btw_nummer')(w); setGevonden(null); }} placeholder="BE0123456789" />
                  <button type="button" className="btn" disabled={zoekt} onClick={zoekOp}>{zoekt ? 'Zoeken…' : 'Opzoeken'}</button>
                </div>
              </Veld>
              {gevonden && (
                <div className="opzoek" role="status" aria-label="Gevonden gegevens">
                  {gevonden.vies ? (gevonden.vies.geldig
                    ? <div><b>✓ Geldig btw-nummer {gevonden.btw}</b>{gevonden.vies.naam ? <> · {gevonden.vies.naam}</> : null}{gevonden.vies.adres ? <div className="sub">{gevonden.vies.adres}</div> : <div className="sub">Dit land geeft naam en adres niet vrij via VIES: vul ze zelf in.</div>}</div>
                    : <div className="waarschuwing" style={{ display: 'block' }}>{gevonden.btw} is volgens VIES (Europese Commissie) <b>geen geldig btw-nummer</b>.</div>) : null}
                  <div style={{ marginTop: 6 }}>{gevonden.peppol
                    ? <><b>✓ Op Peppol:</b> <span className="mono">{gevonden.peppol.id}</span></>
                    : <>Niet op Peppol gevonden met het btw-nummer{gevonden.gecontroleerd?.length ? <span className="sub"> (gecontroleerd: {gevonden.gecontroleerd.join(', ')})</span> : null}.</>}</div>
                  {gevonden.suggesties.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <span className="sub">Mogelijk (Peppol Directory, controleer de naam):</span>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {gevonden.suggesties.map(x => <li key={x.id}><button type="button" className="linkish mono" onClick={() => zet('peppol_id')(x.id)}>{x.id}</button> {x.naam}{x.land ? ` (${x.land})` : ''}</li>)}
                      </ul>
                    </div>
                  )}
                  {gevonden.fouten.map(f => <div key={f} className="sub">{f}</div>)}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    {(gevonden.vies?.geldig || gevonden.peppol) && <button type="button" className="btn primary klein" onClick={neemOver}>Overnemen</button>}
                    <button type="button" className="btn ghost klein" onClick={() => setGevonden(null)}>Sluiten</button>
                  </div>
                </div>
              )}
              {zakelijk && (
                <Veld label="Peppol-ID" id="k-peppol"
                  hint={voorstel ? <>Voorstel op basis van het ondernemingsnummer: <button type="button" className="linkish" onClick={() => zet('peppol_id')(voorstel)}>{voorstel}</button> (controleer of de klant op Peppol staat)</> : null}>
                  <Invoer id="k-peppol" waarde={form.peppol_id || ''} onWijzig={zet('peppol_id')} placeholder="0208:0123456789" className="inp mono" />
                </Veld>
              )}
            </div>
            <div>
              <Veld label="E-mail" id="k-email"><Invoer id="k-email" type="email" waarde={form.email || ''} onWijzig={zet('email')} /></Veld>
              <Veld label="Gsm" id="k-gsm"><Invoer id="k-gsm" type="tel" waarde={form.gsm || ''} onWijzig={zet('gsm')} /></Veld>
              <Veld label="Telefoon" id="k-tel"><Invoer id="k-tel" type="tel" waarde={form.telefoon || ''} onWijzig={zet('telefoon')} /></Veld>
              <Veld label="Afrekening">
                <span className="sub">{zakelijk ? `Factuur (het ERP maakt ze en mailt ze naar Accountable)${form.peppol_id && (form.land || 'BE') === 'BE' ? '; via Peppol te versturen vanuit Accountable' : ''}` : 'Bonnetje (zelf in Accountable ingeven) of factuur (het ERP mailt ze naar Accountable)'}</span>
              </Veld>
              <Veld label="Familie / vriend" id="k-familie" hint="Nieuwe dossiers van deze klant rekenen het filament aan inkoopprijs i.p.v. verkoopprijs (per dossier aan te passen).">
                <label className="keuze" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
                  <input id="k-familie" type="checkbox" checked={!!form.familie} onChange={e => zet('familie')(e.target.checked)} /> Filament aan inkoopprijs
                </label>
              </Veld>
            </div>
          </div>
          <Tabs tabs={[['notities', 'Notities'], ...(!nieuw && klant?.email ? [['mails', 'Mails']] : [])]} actief={tab} onKies={setTab} />
          <div className="tabpanel">
            {tab === 'mails' && !nieuw && klant?.email ? <KlantMails adres={klant.email} /> : <>
              <label className="sr-only" htmlFor="k-notities">Notities</label>
              <textarea id="k-notities" className="inp" rows={4} value={form.notities || ''} onChange={e => zet('notities')(e.target.value)} placeholder="Vaste afspraken, voorkeuren, …" />
            </>}
          </div>
        </div>
        {!nieuw && <Historiek entiteit="klant" id={id} versie={versie} />}
      </div>
    </>
  );
}

// Mails van en aan de klant (30-09): inbox en verzonden, uit de mailbox.
function KlantMails({ adres }) {
  const { navigeer } = useOmgeving();
  const { data, fout, laden } = useData(`/mail/adres?adres=${encodeURIComponent(adres)}`);
  if (fout) return <p className="sub">{/nog niet ingesteld/.test(fout) ? 'De mailbox is nog niet ingesteld (tegel Mail).' : fout}</p>;
  if (!data && laden) return <Laden />;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button type="button" className="btn klein" onClick={() => navigeer(`/mail?nieuw=1&aan=${encodeURIComponent(adres)}`)}>Mail sturen</button>
      </div>
      {!data?.length ? <p className="sub">Geen mails van of aan {adres} in je inbox of verzonden.</p> : (
        <table className="mini">
          <tbody>
            {data.map(m => (
              <tr key={`${m.map}-${m.uid}`} className="row" onClick={() => navigeer(`/mail?map=${encodeURIComponent(m.map)}&uid=${m.uid}`)}>
                <td style={{ whiteSpace: 'nowrap' }} className="sub">{m.map === 'INBOX' ? 'Ontvangen' : 'Verzonden'}</td>
                <td>{m.gelezen ? m.onderwerp : <b>{m.onderwerp}</b>}{m.bijlagen ? ' 📎' : ''}</td>
                <td className="r num" style={{ whiteSpace: 'nowrap' }}>{m.datum ? new Date(m.datum).toLocaleDateString('nl-BE') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
