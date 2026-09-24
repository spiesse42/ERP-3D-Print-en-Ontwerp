import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, FormKnoppen, SlimmeKnop, Veld, Tabs, Laden, Fout } from '../../schil/Weergaven.jsx';
import Historiek from '../../schil/Historiek.jsx';
import { klantNaam, peppolVoorstel, naarFormulier, LEGE_KLANT } from './klant.js';

// Invoerveld op moduleniveau (niet genest), anders verliest het de focus
// bij elke toetsaanslag.
function Invoer({ id, waarde, onWijzig, ...rest }) {
  return <input id={id} className="inp" value={waarde} onChange={e => onWijzig(e.target.value)} {...rest} />;
}

export default function KlantFormulier() {
  const { id } = useParams();
  const nieuw = id === 'nieuw';
  const { melding, bevestig, zetVuil, navigeer } = useOmgeving();
  const { data: klant, fout, herlaad } = useData(nieuw ? null : `/klanten/${id}`);
  const { data: alle } = useData('/klanten?archief=alle');
  const [form, setForm] = useState(LEGE_KLANT);
  const [tab, setTab] = useState('notities');
  const [bezig, setBezig] = useState(false);
  const [versie, setVersie] = useState(0);

  useEffect(() => { setForm(naarFormulier(nieuw ? null : klant)); }, [klant, nieuw]);

  const origineel = useMemo(() => naarFormulier(nieuw ? null : klant), [klant, nieuw]);
  const vuil = JSON.stringify(form) !== JSON.stringify(origineel);
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);

  const zet = (veld) => (w) => setForm(f => ({ ...f, [veld]: w }));
  const zakelijk = form.type === 'zakelijk';
  const voorstel = zakelijk && !form.peppol_id ? peppolVoorstel(form.btw_nummer) : null;

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
              <Veld label="Ondernemingsnr." id="k-btw" hint={zakelijk ? null : 'Enkel als een particulier toch een nummer heeft.'}>
                <Invoer id="k-btw" waarde={form.btw_nummer || ''} onWijzig={zet('btw_nummer')} placeholder="BE0123.456.789" />
              </Veld>
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
                <span className="sub">{zakelijk ? `Factuur${form.peppol_id ? ' via Peppol' : ''} (in Accountable)` : 'Bonnetje of factuur (in Accountable)'}</span>
              </Veld>
            </div>
          </div>
          <Tabs tabs={[['notities', 'Notities']]} actief={tab} onKies={setTab} />
          <div className="tabpanel">
            <label className="sr-only" htmlFor="k-notities">Notities</label>
            <textarea id="k-notities" className="inp" rows={4} value={form.notities || ''} onChange={e => zet('notities')(e.target.value)} placeholder="Vaste afspraken, voorkeuren, …" />
          </div>
        </div>
        {!nieuw && <Historiek entiteit="klant" id={id} versie={versie} />}
      </div>
    </>
  );
}
