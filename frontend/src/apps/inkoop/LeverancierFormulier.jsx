import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, FormKnoppen, SlimmeKnop, Veld, Tabs, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import Historiek from '../../schil/Historiek.jsx';
import { euro, datum } from '../../lib/formaat.js';

const VELDEN = ['naam', 'email', 'telefoon', 'website', 'btw_nummer', 'klantnummer', 'notities'];
const naarFormulier = l => Object.fromEntries(VELDEN.map(v => [v, l?.[v] ?? '']));

function Invoer({ id, waarde, onWijzig, ...rest }) {
  return <input id={id} className="inp" value={waarde} onChange={e => onWijzig(e.target.value)} {...rest} />;
}

export default function LeverancierFormulier() {
  const { id } = useParams();
  const nieuw = id === 'nieuw';
  const { melding, bevestig, zetVuil, navigeer } = useOmgeving();
  const { data: lev, fout, herlaad } = useData(nieuw ? null : `/leveranciers/${id}`);
  const [form, setForm] = useState(naarFormulier(null));
  const [tab, setTab] = useState('artikelen');
  const [bezig, setBezig] = useState(false);
  const [versie, setVersie] = useState(0);

  const origineel = useMemo(() => naarFormulier(nieuw ? null : lev), [lev, nieuw]);
  useEffect(() => { setForm(origineel); }, [origineel]);
  const vuil = JSON.stringify(form) !== JSON.stringify(origineel);
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);
  const zet = k => w => setForm(f => ({ ...f, [k]: w }));

  async function opslaan() {
    if (!form.naam.trim()) { melding('Naam is verplicht.', 'fout'); document.getElementById('l-naam')?.focus(); return; }
    setBezig(true);
    try {
      if (nieuw) {
        const { id: nieuwId } = await api.post('/leveranciers', form);
        zetVuil(false); melding('Leverancier aangemaakt.'); navigeer(`/inkoop/leveranciers/${nieuwId}`);
      } else {
        await api.put(`/leveranciers/${id}`, form); await herlaad(); setVersie(v => v + 1); melding('Opgeslagen.');
      }
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }
  function verwerp() { if (nieuw) { zetVuil(false); navigeer('/inkoop/leveranciers'); } else setForm(origineel); }
  async function archiveer(aan) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    if (aan && !await bevestig({ titel: 'Leverancier archiveren', tekst: `${lev.naam} verdwijnt uit de keuzelijsten, maar blijft bewaard bij bestaande aankopen.`, bevestigLabel: 'Archiveren' })) return;
    try { await api.patch(`/leveranciers/${id}/archief`, { gearchiveerd: aan }); await herlaad(); setVersie(v => v + 1); melding(aan ? 'Leverancier gearchiveerd.' : 'Leverancier hersteld.'); }
    catch (e) { melding(e.message, 'fout'); }
  }
  async function verwijder() {
    if (!await bevestig({ titel: 'Leverancier verwijderen', tekst: `${lev.naam} wordt definitief verwijderd. Dat kan enkel zolang er geen aankopen of gekoppelde artikelen zijn.`, bevestigLabel: 'Definitief verwijderen', gevaarlijk: true })) return;
    try { await api.delete(`/leveranciers/${id}`); zetVuil(false); melding('Leverancier verwijderd.'); navigeer('/inkoop/leveranciers'); }
    catch (e) { melding(e.message, 'fout'); }
  }

  if (!nieuw && fout) return <><ControlePaneel kruimels={[{ label: 'Leveranciers', naar: '/inkoop/leveranciers' }, { label: 'Niet gevonden' }]} /><Fout tekst={fout} /></>;
  if (!nieuw && !lev) return <Laden />;

  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Leveranciers', naar: '/inkoop/leveranciers' }, { label: nieuw ? 'Nieuw' : lev.naam }]} />
      <div className="sheet-wrap">
        <div className="sheet">
          <FormKnoppen vuil={vuil} nieuw={nieuw} bezig={bezig} onOpslaan={opslaan} onVerwerp={verwerp}
            gearchiveerd={!nieuw && lev.gearchiveerd} onArchiveer={nieuw ? null : archiveer} onVerwijder={nieuw ? null : verwijder}
            terug={{ label: 'Leveranciers', naar: '/inkoop/leveranciers' }} />
          <div className="sheet-head">
            <div className="kop">
              <label className="sr-only" htmlFor="l-naam">Naam</label>
              <Invoer id="l-naam" waarde={form.naam} onWijzig={zet('naam')} className="inp titelveld" placeholder="Naam van de leverancier (verplicht)" />
            </div>
            {!nieuw && (
              <div className="smart">
                <SlimmeKnop icoon="kar" getal={lev.aankopen} label="Aankopen" naar={`/inkoop/aankopen?leverancier=${lev.id}`} />
                <SlimmeKnop icoon="spoel" getal={lev.artikelen} label="Artikelen" onClick={() => setTab('artikelen')} />
              </div>
            )}
          </div>
          <div className="fields">
            <div>
              <Veld label="E-mail" id="l-email"><Invoer id="l-email" type="email" waarde={form.email} onWijzig={zet('email')} /></Veld>
              <Veld label="Telefoon" id="l-tel"><Invoer id="l-tel" type="tel" waarde={form.telefoon} onWijzig={zet('telefoon')} /></Veld>
              <Veld label="Website" id="l-web"><Invoer id="l-web" waarde={form.website} onWijzig={zet('website')} placeholder="bv. eu.store.bambulab.com" /></Veld>
            </div>
            <div>
              <Veld label="Btw-nummer" id="l-btw"><Invoer id="l-btw" waarde={form.btw_nummer} onWijzig={zet('btw_nummer')} /></Veld>
              <Veld label="Ons klantnummer" id="l-knr" hint="Ons nummer bij deze leverancier (handig bij bestellen)."><Invoer id="l-knr" waarde={form.klantnummer} onWijzig={zet('klantnummer')} /></Veld>
            </div>
          </div>
          <Tabs tabs={[...(nieuw ? [] : [['artikelen', `Artikelen (${lev.artikelen})`]]), ['notities', 'Notities']]} actief={nieuw ? 'notities' : tab} onKies={setTab} />
          <div className="tabpanel">
            {!nieuw && tab === 'artikelen' && (lev.artikellijst.length === 0
              ? <p className="note">Nog geen artikelen gekoppeld. Dat gebeurt vanzelf bij de eerste ontvangst, of in het artikel (tabblad Inkoop).</p>
              : (
                <div className="tabelvak">
                  <table className="mini">
                    <thead><tr><th>Artikel</th><th>Productcode</th><th className="r">Laatste prijs</th><th>Bijgewerkt</th></tr></thead>
                    <tbody>
                      {lev.artikellijst.map(a => (
                        <tr key={a.id}>
                          <td><Link naar={`/voorraad/artikelen/${a.artikel_id}`} className="linkish">{a.weergave}</Link>{a.voorkeur ? <span className="badge b-accent" style={{ marginLeft: 6 }}>voorkeur</span> : null}</td>
                          <td className="mono">{a.productcode || <span className="sub">—</span>}</td>
                          <td className="r num">{euro(a.laatste_prijs)}</td>
                          <td className="num">{datum(a.bijgewerkt_op)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            {(nieuw || tab === 'notities') && (
              <>
                <label className="sr-only" htmlFor="l-notities">Notities</label>
                <textarea id="l-notities" className="inp" rows={4} value={form.notities} onChange={e => zet('notities')(e.target.value)} placeholder="Levertermijnen, verzendkosten, kortingscodes…" />
              </>
            )}
          </div>
        </div>
        {!nieuw && <Historiek entiteit="leverancier" id={id} versie={versie} />}
      </div>
    </>
  );
}
