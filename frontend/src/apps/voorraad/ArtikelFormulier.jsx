import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, FormKnoppen, SlimmeKnop, Veld, Tabs, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import Historiek from '../../schil/Historiek.jsx';
import Icoon from '../../schil/Icoon.jsx';
import KeuzeMetToevoegen from '../../components/KeuzeMetToevoegen.jsx';
import { euro, aantal, datum, naarInvoer } from '../../lib/formaat.js';
import { naarFormulier, naarBody, voorstelVerkoopprijs, LEGE_REGEL, TYPE_LABEL, eenheid } from './artikel.js';
import { StatusBadge, Kleurstaal } from './ArtikelenLijst.jsx';
import BoekingDialoog from './BoekingDialoog.jsx';

// Invoervelden op moduleniveau (niet genest), anders verliezen ze de focus.
function Invoer({ id, waarde, onWijzig, ...rest }) {
  return <input id={id} className="inp" value={waarde} onChange={e => onWijzig(e.target.value)} {...rest} />;
}
function Bedrag({ id, waarde, onWijzig, eenheid = '€', ...rest }) {
  return <div className="unit"><Invoer id={id} waarde={waarde} onWijzig={onWijzig} inputMode="decimal" className="inp num" {...rest} /><span>{eenheid}</span></div>;
}
function Vinkje({ id, aan, onWijzig, children, disabled }) {
  return (
    <label className="vinkje" htmlFor={id}>
      <input id={id} type="checkbox" checked={aan} disabled={disabled} onChange={e => onWijzig(e.target.checked)} /> {children}
    </label>
  );
}

// Kleur kiezen, of meteen een nieuwe kleur (naam + kleurcode) toevoegen.
function KleurKeuze({ id, waarde, kleuren, onKies, onNieuw }) {
  const [nieuw, setNieuw] = useState(null);
  const { melding } = useOmgeving();
  async function voegToe() {
    try { const k = await onNieuw(nieuw.naam.trim(), nieuw.hex); onKies(String(k.id)); setNieuw(null); }
    catch (e) { melding(e.message, 'fout'); }
  }
  if (nieuw) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input id={id} className="inp" style={{ flex: '1 1 120px' }} autoFocus placeholder="Nieuwe kleur" value={nieuw.naam}
          onChange={e => setNieuw(n => ({ ...n, naam: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && nieuw.naam.trim()) voegToe(); if (e.key === 'Escape') setNieuw(null); }} />
        <input type="color" aria-label="Kleurcode" value={nieuw.hex} onChange={e => setNieuw(n => ({ ...n, hex: e.target.value }))} className="kleurkiezer" />
        <button type="button" className="btn primary" disabled={!nieuw.naam.trim()} onClick={voegToe}>Toevoegen</button>
        <button type="button" className="btn" onClick={() => setNieuw(null)}>Annuleren</button>
      </div>
    );
  }
  const huidige = kleuren.find(k => String(k.id) === String(waarde));
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {huidige && <Kleurstaal hex={huidige.hex} />}
      <select id={id} className="inp" value={waarde} onChange={e => (e.target.value === '__nieuw__' ? setNieuw({ naam: '', hex: '#888888' }) : onKies(e.target.value))}>
        <option value="">Kies een kleur…</option>
        {kleuren.map(k => <option key={k.id} value={k.id}>{k.naam}</option>)}
        <option value="__nieuw__">+ Nieuwe kleur toevoegen</option>
      </select>
    </div>
  );
}

// Productiekost van een eigen product (stap 6c): gemeten bij het bevestigen
// van de printopdrachten (echte kost + arbeid apart), naast de vaste
// verkoopprijs, zodat je ziet of er genoeg winst op zit.
function Winst({ prijs, kost }) {
  if (prijs == null || kost == null) return null;
  const w = prijs - kost;
  return <span className={w < 0 ? 'regelfout' : 'sub'} style={{ display: 'inline' }}> · winst {euro(Math.round(w * 100) / 100)}{prijs > 0 ? ` (${Math.round(w / prijs * 100)} %)` : ''}</span>;
}
function Productiekost({ id, verkoopprijs }) {
  const { data } = useData(`/productie/productiekost/${id}`);
  if (!data) return null;
  const l = data.laatste, g = data.gemiddeld;
  return (
    <Veld label="Productiekost (gemeten)" hint={l ? 'Filament aan inkoopprijs, gemeten elektriciteit, machinetarief, BMCU en mislukte pogingen, per goed stuk. Arbeid = voorbereiding + nabewerking.' : null}>
      {!l ? <span className="sub">Nog niet gemeten: plan het via een dossier "Eigen product" (printregel → naar voorraad als dit artikel).</span> : (
        <div className="pk">
          <div>Laatste: <b className="num">{euro(l.productiekost_stuk)}</b><Winst prijs={verkoopprijs} kost={l.productiekost_stuk} />
            {l.kost_onvolledig ? <span className="badge b-warn" style={{ marginLeft: 6 }}>onvolledig</span> : null}
            <div className="sub">met arbeid {euro(Math.round((l.productiekost_stuk + (l.arbeid_stuk || 0)) * 10000) / 10000)}<Winst prijs={verkoopprijs} kost={l.productiekost_stuk + (l.arbeid_stuk || 0)} /> · <Link naar={`/dossiers/${l.dossier_id}?tab=productie`}><span className="mono">{l.dossier_nummer}</span></Link></div></div>
          {g && g.opdrachten > 1 && <div className="sub">Gemiddeld over {g.opdrachten} opdrachten ({aantal(g.stuks)} stuks): {euro(g.per_stuk)}, met arbeid {euro(Math.round((g.per_stuk + (g.arbeid_stuk || 0)) * 10000) / 10000)}</div>}
        </div>
      )}
    </Veld>
  );
}

export default function ArtikelFormulier() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nieuw = id === 'nieuw';
  const startType = ['filament', 'artikel', 'dienst'].includes(params.get('type')) ? params.get('type') : 'artikel';
  const { melding, bevestig, zetVuil, navigeer } = useOmgeving();
  const { data: art, fout, herlaad } = useData(nieuw ? null : `/voorraad/artikelen/${id}`);
  const { data: alle } = useData('/voorraad/artikelen');
  const { data: categorieen, herlaad: herlaadCat } = useData('/voorraad/categorieen');
  const { data: groepen } = useData('/filament/types');
  const { data: kleuren, herlaad: herlaadKleuren } = useData('/filament/kleuren');
  const { data: leveranciers, herlaad: herlaadLev } = useData('/leveranciers');
  const { data: partijen, herlaad: herlaadPartijen } = useData(nieuw ? null : `/voorraad/artikelen/${id}/partijen`);
  const [form, setForm] = useState(() => naarFormulier(null, startType));
  const [tab, setTab] = useState('voorraad');
  const [bezig, setBezig] = useState(false);
  const [versie, setVersie] = useState(0);
  const [boeking, setBoeking] = useState(null);   // 'in' | 'uit' | 'corrigeer'

  const origineel = useMemo(() => naarFormulier(nieuw ? null : art, startType), [art, nieuw, startType]);
  useEffect(() => { setForm(origineel); }, [origineel]);
  const vuil = JSON.stringify(form) !== JSON.stringify(origineel);
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);

  const zet = veld => w => setForm(f => ({ ...f, [veld]: w }));
  const t = form.type;
  const heeftVoorraad = t !== 'dienst';
  // Tabblad dat bij dit type niet (meer) bestaat → eerste geldige tonen.
  const tabs = [
    ...(heeftVoorraad && !nieuw ? [['voorraad', 'Voorraad']] : []),
    ...(form.wordt_gekocht ? [['inkoop', `Inkoop${form.leveranciers.length ? ` (${form.leveranciers.length})` : ''}`]] : []),
    ['notities', 'Notities'],
  ];
  const actieveTab = tabs.some(x => x[0] === tab) ? tab : tabs[0][0];

  const groep = (groepen || []).find(g => String(g.id) === String(form.filament_type_id));
  const actieve = alle || [];
  const pos = actieve.findIndex(a => String(a.id) === String(id));
  const voorstel = form.wordt_gekocht && form.wordt_verkocht ? voorstelVerkoopprijs(form.inkoopprijs, form.marge_pct) : null;

  function kiesType(nt) {
    setForm(f => ({
      ...f, type: nt,
      wordt_gekocht: nt === 'filament' ? true : nt === 'artikel' ? (f.wordt_gekocht || !f.zelf_geprint) : f.wordt_gekocht,
      wordt_verkocht: nt === 'filament' ? false : nt === 'dienst' ? (f.wordt_verkocht || !f.wordt_gekocht) : f.wordt_verkocht,
      zelf_geprint: nt === 'artikel' ? f.zelf_geprint : false,
      eenheid: nt === 'filament' ? 'rollen' : f.eenheid === 'rollen' ? 'stuks' : f.eenheid,
    }));
  }

  async function opslaan() {
    if (t === 'filament' && (!form.filament_type_id || !form.kleur_id)) { melding('Kies een prijsgroep en een kleur.', 'fout'); return; }
    if (t !== 'filament' && !form.naam.trim()) { melding('Naam is verplicht.', 'fout'); document.getElementById('a-naam')?.focus(); return; }
    setBezig(true);
    try {
      if (nieuw) {
        const { id: nieuwId } = await api.post('/voorraad/artikelen', naarBody(form));
        zetVuil(false);
        melding('Artikel aangemaakt.');
        navigeer(`/voorraad/artikelen/${nieuwId}`);
      } else {
        await api.put(`/voorraad/artikelen/${id}`, naarBody(form));
        await herlaad(); setVersie(v => v + 1);
        melding('Opgeslagen.');
      }
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }
  function verwerp() {
    if (nieuw) { zetVuil(false); navigeer('/voorraad/artikelen'); return; }
    setForm(origineel);
  }
  async function archiveer(aan) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    if (aan && !await bevestig({
      titel: 'Artikel archiveren',
      tekst: `${art.weergave} verdwijnt uit de lijsten en uit "te bestellen", maar blijft bewaard.${art.voorraad > 0 ? ` Er staat nog ${aantal(art.voorraad)} ${art.eenheid} op voorraad.` : ''} Herstellen kan via de filter "Gearchiveerd".`,
      bevestigLabel: 'Archiveren',
    })) return;
    try {
      await api.patch(`/voorraad/artikelen/${id}/archief`, { gearchiveerd: aan });
      await herlaad(); setVersie(v => v + 1);
      melding(aan ? 'Artikel gearchiveerd.' : 'Artikel hersteld.');
    } catch (e) { melding(e.message, 'fout'); }
  }
  async function verwijder() {
    if (!await bevestig({ titel: 'Artikel verwijderen', tekst: `${art.weergave} wordt definitief verwijderd. Dat kan enkel zolang er geen voorraadbewegingen of aankopen zijn. Archiveren is meestal beter.`, bevestigLabel: 'Definitief verwijderen', gevaarlijk: true })) return;
    try {
      await api.delete(`/voorraad/artikelen/${id}`);
      zetVuil(false); melding('Artikel verwijderd.'); navigeer('/voorraad/artikelen');
    } catch (e) { melding(e.message, 'fout'); }
  }
  function startBoeking(r) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    setBoeking(r);
  }
  async function naBoeking() {
    setBoeking(null);
    await Promise.all([herlaad(), herlaadPartijen()]);
    setVersie(v => v + 1);
  }

  async function nieuweCategorie(naam) { const c = await api.post('/voorraad/categorieen', { naam }); await herlaadCat(); return c; }
  async function nieuweKleur(naam, hex) { const k = await api.post('/filament/kleuren', { naam, hex }); await herlaadKleuren(); return k; }
  async function nieuweLeverancier(naam) { const l = await api.post('/leveranciers', { naam }); await herlaadLev(); return l; }

  const zetRegel = (i, veld) => w => setForm(f => ({
    ...f, leveranciers: f.leveranciers.map((r, j) => (j === i ? { ...r, [veld]: w } : veld === 'voorkeur' && w ? { ...r, voorkeur: false } : r)),
  }));

  if (!nieuw && fout) return <><ControlePaneel kruimels={[{ label: 'Artikelen', naar: '/voorraad/artikelen' }, { label: 'Niet gevonden' }]} /><Fout tekst={fout} /></>;
  // Ook net na 'nieuw → opgeslagen' (zelfde scherm, nieuw id): wachten op de gegevens.
  if (!nieuw && !art) return <Laden />;

  const titel = nieuw ? 'Nieuw' : art.weergave;
  const archief = !nieuw && art?.gearchiveerd;
  const typeVast = !nieuw && art?.in_gebruik;

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Artikelen', naar: '/voorraad/artikelen' }, { label: titel }]}
        rechts={!nieuw && pos >= 0 && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <span className="pager num">{pos + 1} / {actieve.length}</span>
            <button type="button" className="btn ghost" aria-label="Vorig artikel" disabled={pos <= 0} onClick={() => navigeer(`/voorraad/artikelen/${actieve[pos - 1].id}`)}>‹</button>
            <button type="button" className="btn ghost" aria-label="Volgend artikel" disabled={pos >= actieve.length - 1} onClick={() => navigeer(`/voorraad/artikelen/${actieve[pos + 1].id}`)}>›</button>
          </span>
        )}
      />
      <div className="sheet-wrap">
        <div className="sheet">
          <FormKnoppen vuil={vuil} nieuw={nieuw} bezig={bezig} onOpslaan={opslaan} onVerwerp={verwerp}
            gearchiveerd={archief} onArchiveer={nieuw ? null : archiveer} onVerwijder={nieuw ? null : verwijder}
            terug={{ label: 'Artikelen', naar: '/voorraad/artikelen' }}
            links={!nieuw && heeftVoorraad ? <StatusBadge status={art.status} /> : null} />
          <div className="sheet-head">
            <div className="kop">
              <div className="seg" role="group" aria-label="Type" style={{ marginBottom: 8 }} title={typeVast ? 'Het type ligt vast zodra er voorraadbewegingen of aankopen zijn.' : undefined}>
                {['artikel', 'filament', 'dienst'].map(x => (
                  <button key={x} type="button" aria-pressed={t === x} disabled={typeVast && t !== x} onClick={() => kiesType(x)}>{TYPE_LABEL[x]}</button>
                ))}
              </div>
              {t === 'filament' ? (
                <div className="filkop">
                  <div>
                    <label htmlFor="a-groep" className="lbl">Prijsgroep (merk + type)</label>
                    <select id="a-groep" className="inp titelkeuze" value={form.filament_type_id} onChange={e => zet('filament_type_id')(e.target.value)}>
                      <option value="">Kies een prijsgroep…</option>
                      {(groepen || []).map(g => <option key={g.id} value={g.id}>{g.merk} {g.materiaal}</option>)}
                    </select>
                    {groepen && groepen.length === 0 && <div className="hint">Nog geen prijsgroepen. Maak er eerst een in <Link naar="/instellingen/materiaal">Instellingen → Materiaalprijzen</Link>.</div>}
                  </div>
                  <div>
                    <label htmlFor="a-kleur" className="lbl">Kleur</label>
                    <KleurKeuze id="a-kleur" waarde={form.kleur_id} kleuren={kleuren || []} onKies={zet('kleur_id')} onNieuw={nieuweKleur} />
                  </div>
                </div>
              ) : (
                <>
                  <label className="sr-only" htmlFor="a-naam">Naam</label>
                  <Invoer id="a-naam" waarde={form.naam} onWijzig={zet('naam')} className="inp titelveld" placeholder={t === 'dienst' ? 'Naam van de dienst (verplicht)' : 'Naam van het artikel (verplicht)'} />
                  <div className="vinkjes">
                    <Vinkje id="a-gekocht" aan={form.wordt_gekocht} onWijzig={zet('wordt_gekocht')}>Wordt gekocht</Vinkje>
                    <Vinkje id="a-verkocht" aan={form.wordt_verkocht} onWijzig={zet('wordt_verkocht')}>Wordt verkocht</Vinkje>
                    {t === 'artikel' && <Vinkje id="a-zelf" aan={form.zelf_geprint} onWijzig={zet('zelf_geprint')}>Printen we zelf</Vinkje>}
                  </div>
                </>
              )}
            </div>
            {!nieuw && heeftVoorraad && (
              <div className="smart">
                <SlimmeKnop icoon="spoel" getal={`${aantal(art.voorraad)} ${eenheid(art.voorraad, art.eenheid)}`} label="Op voorraad" onClick={() => setTab('voorraad')} />
                <SlimmeKnop icoon="lijst" getal={art.mutaties} label="Mutaties" naar={`/voorraad/mutaties?artikel=${art.id}`} />
                {art.besteld > 0 && <SlimmeKnop icoon="kar" getal={aantal(art.besteld)} label="Besteld" naar={`/inkoop/aankopen?artikel=${art.id}`} />}
              </div>
            )}
          </div>

          <div className="fields">
            <div>
              <Veld label="Categorie" id="a-cat">
                <KeuzeMetToevoegen id="a-cat" ariaLabel="Categorie" waarde={form.categorie_id} leegLabel="Geen categorie"
                  opties={(categorieen || []).map(c => ({ id: c.id, naam: c.pad }))} onKies={zet('categorie_id')} onNieuw={nieuweCategorie} watLabel="categorie" />
              </Veld>
              {t !== 'filament' && (
                <Veld label="Eenheid" id="a-eenheid"><Invoer id="a-eenheid" waarde={form.eenheid} onWijzig={zet('eenheid')} placeholder="stuks, m, g, …" list="eenheden" /></Veld>
              )}
              {heeftVoorraad && <>
                <Veld label="Minimum" id="a-min" hint={t === 'filament' && groep ? `Leeg = prijsgroep (${groep.min_rollen ?? 'geen'} per kleur)` : 'Leeg = geen opvolging in "te bestellen"'}>
                  <Bedrag id="a-min" waarde={form.min_voorraad} onWijzig={zet('min_voorraad')} eenheid={form.eenheid} placeholder={t === 'filament' && groep?.min_rollen != null ? String(groep.min_rollen) : ''} />
                </Veld>
                <Veld label="Maximum" id="a-max" hint={t === 'filament' && groep ? `Leeg = prijsgroep (${groep.max_rollen ?? 'geen'})` : 'Te bestellen vult aan tot hier'}>
                  <Bedrag id="a-max" waarde={form.max_voorraad} onWijzig={zet('max_voorraad')} eenheid={form.eenheid} placeholder={t === 'filament' && groep?.max_rollen != null ? String(groep.max_rollen) : ''} />
                </Veld>
                <Veld label="Locatie" id="a-loc"><Invoer id="a-loc" waarde={form.locatie} onWijzig={zet('locatie')} placeholder="bv. kast 2, lade B" /></Veld>
              </>}
            </div>
            <div>
              {t === 'filament' ? <>
                <Veld label="Verkoopprijs"><span className="num">{groep ? `${euro(groep.verkoopprijs_per_kg)}/kg` : '—'}</span> <span className="sub">uit de prijsgroep</span></Veld>
                <Veld label="Rolgewicht"><span className="num">{groep ? `${aantal(groep.rolgewicht_g)} g` : '—'}</span> <span className="sub">uit de prijsgroep</span></Veld>
                {!nieuw && <Veld label="Kostprijs"><span className="num">{art.kost_per_kg != null ? `${euro(art.kost_per_kg)}/kg` : '—'}</span> <span className="sub">{art.kost_per_kg != null ? `gemiddeld over de rollen op voorraad (${euro(art.gem_prijs)}/rol)` : 'nog geen rollen met een prijs'}</span></Veld>}
                <p className="note">Prijsgroepen beheer je in <Link naar="/instellingen/materiaal">Instellingen → Materiaalprijzen</Link>.</p>
              </> : <>
                {form.wordt_gekocht && (
                  <Veld label="Inkoopprijs" id="a-inkoop" hint="Incl. btw. Wordt bij elke ontvangst bijgewerkt met de laatste prijs.">
                    <Bedrag id="a-inkoop" waarde={form.inkoopprijs} onWijzig={zet('inkoopprijs')} eenheid={`€/${form.eenheid || 'eenheid'}`} />
                  </Veld>
                )}
                {form.wordt_gekocht && form.wordt_verkocht && (
                  <Veld label="Marge" id="a-marge"><Bedrag id="a-marge" waarde={form.marge_pct} onWijzig={zet('marge_pct')} eenheid="%" /></Veld>
                )}
                {form.wordt_verkocht && (
                  <Veld label="Verkoopprijs" id="a-verkoop"
                    hint={voorstel != null && naarInvoer(voorstel) !== form.verkoopprijs
                      ? <>Voorstel uit inkoop + marge: <button type="button" className="linkish" onClick={() => zet('verkoopprijs')(naarInvoer(voorstel))}>{euro(voorstel)}</button></>
                      : null}>
                    <Bedrag id="a-verkoop" waarde={form.verkoopprijs} onWijzig={zet('verkoopprijs')} eenheid={`€/${form.eenheid || 'eenheid'}`} placeholder="verplicht" />
                  </Veld>
                )}
                {form.wordt_verkocht && (
                  <Veld label="Vaste prijs">
                    <Vinkje id="a-vast" aan={form.vaste_prijs} onWijzig={zet('vaste_prijs')}>Geen marge, niet in de btw-grondslag (bv. verzending)</Vinkje>
                  </Veld>
                )}
                {form.zelf_geprint && (
                  <Veld label="Productieprijs" id="a-prod" hint="Informatief: wat het ons kost om te maken.">
                    <Bedrag id="a-prod" waarde={form.productieprijs} onWijzig={zet('productieprijs')} eenheid={`€/${form.eenheid || 'eenheid'}`} />
                  </Veld>
                )}
                {!nieuw && form.zelf_geprint && <Productiekost id={id} verkoopprijs={art?.verkoopprijs} />}
                {!nieuw && heeftVoorraad && art.gem_prijs != null && (
                  <Veld label="Kostprijs voorraad"><span className="num">{euro(art.gem_prijs)}</span> <span className="sub">gemiddeld · waarde {euro(art.waarde)}</span></Veld>
                )}
              </>}
            </div>
          </div>
          <datalist id="eenheden"><option value="stuks" /><option value="m" /><option value="g" /><option value="ml" /><option value="set" /></datalist>

          <Tabs tabs={tabs} actief={actieveTab} onKies={setTab} />
          <div className="tabpanel">
            {actieveTab === 'voorraad' && (
              <>
                <div className="tabacties">
                  <button type="button" className="btn" onClick={() => startBoeking('in')}><Icoon naam="plus" maat={16} /> {form.zelf_geprint && !form.wordt_gekocht ? 'Geproduceerd' : 'Ontvangen'}</button>
                  <button type="button" className="btn" disabled={!art.voorraad} onClick={() => startBoeking('uit')}>{t === 'filament' ? 'Rol eraf / leeg' : 'Eraf boeken'}</button>
                  <button type="button" className="btn ghost" onClick={() => startBoeking('corrigeer')}>Aantal aanpassen</button>
                </div>
                {!partijen ? <Laden /> : partijen.length === 0 ? <p className="note">Nog geen partijen. Voorraad komt binnen via een aankoop (stap 3b) of met de knop hierboven.</p> : (
                  <div className="tabelvak">
                    <table className="mini">
                      <thead><tr><th>Ontvangen</th><th>Herkomst</th><th className="r">Ontvangen</th><th className="r">Resterend</th><th className="r">Prijs/{t === 'filament' ? 'rol' : 'eenheid'}</th><th>Locatie</th></tr></thead>
                      <tbody>
                        {partijen.map(p => (
                          <tr key={p.id} className={p.aantal_resterend > 0 ? '' : 'op'}>
                            <td className="num">{datum(p.ontvangen_op)}</td>
                            <td>{p.aankoop_nummer ? <Link naar={`/inkoop/aankopen/${p.aankoop_id}`} className="mono linkish">{p.aankoop_nummer}</Link>
                              : p.productie_dossier_nummer ? <span className="sub">geprint · <Link naar={`/dossiers/${p.productie_dossier_id}?tab=productie`} className="mono linkish">{p.productie_dossier_nummer}</Link></span>
                              : <span className="sub">manueel</span>}</td>
                            <td className="r num">{aantal(p.aantal_ontvangen)}</td>
                            <td className="r num"><b>{aantal(p.aantal_resterend)}</b></td>
                            <td className="r num">{euro(p.prijs_per_eenheid)}</td>
                            <td>{p.locatie || <span className="sub">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {actieveTab === 'inkoop' && (
              <>
                <p className="note" style={{ marginTop: 0 }}>Wat elke leverancier over dit artikel weet. De productcode (of omschrijving) van de leverancier gebruikt de factuurherkenning om een regel automatisch aan dit artikel te koppelen. De voorkeursleverancier verschijnt bij "te bestellen".</p>
                {form.leveranciers.length > 0 && (
                  <div className="tabelvak">
                    <table className="mini levtabel">
                      <thead><tr><th>Leverancier</th><th>Productcode</th><th>Omschrijving bij leverancier</th><th className="r">Prijs</th><th className="r">Levertijd</th><th>Voorkeur</th><th><span className="sr-only">Weg</span></th></tr></thead>
                      <tbody>
                        {form.leveranciers.map((r, i) => (
                          <tr key={i}>
                            <td style={{ minWidth: 170 }}><KeuzeMetToevoegen id={`l-${i}-lev`} ariaLabel="Leverancier" waarde={r.leverancier_id} opties={leveranciers || []} onKies={zetRegel(i, 'leverancier_id')} onNieuw={nieuweLeverancier} watLabel="leverancier" /></td>
                            <td><Invoer id={`l-${i}-code`} waarde={r.productcode} onWijzig={zetRegel(i, 'productcode')} aria-label="Productcode" className="inp mono" /></td>
                            <td><Invoer id={`l-${i}-oms`} waarde={r.omschrijving} onWijzig={zetRegel(i, 'omschrijving')} aria-label="Omschrijving bij leverancier" /></td>
                            <td className="r"><Invoer id={`l-${i}-prijs`} waarde={r.laatste_prijs} onWijzig={zetRegel(i, 'laatste_prijs')} aria-label="Laatste prijs" className="inp num" inputMode="decimal" style={{ width: 80 }} /></td>
                            <td className="r"><Invoer id={`l-${i}-dagen`} waarde={r.levertijd_dagen} onWijzig={zetRegel(i, 'levertijd_dagen')} aria-label="Levertijd in dagen" className="inp num" inputMode="numeric" style={{ width: 56 }} placeholder="d" /></td>
                            <td><input type="radio" name="voorkeur" aria-label="Voorkeursleverancier" checked={r.voorkeur} onChange={() => zetRegel(i, 'voorkeur')(true)} /></td>
                            <td><button type="button" className="btn ghost" aria-label="Regel weghalen" onClick={() => setForm(f => ({ ...f, leveranciers: f.leveranciers.filter((_, j) => j !== i) }))}><Icoon naam="kruis" maat={14} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setForm(f => ({ ...f, leveranciers: [...f.leveranciers, { ...LEGE_REGEL, voorkeur: f.leveranciers.length === 0 }] }))}>
                  <Icoon naam="plus" maat={16} /> Leverancier toevoegen
                </button>
              </>
            )}
            {actieveTab === 'notities' && (
              <>
                <label className="sr-only" htmlFor="a-notities">Notities</label>
                <textarea id="a-notities" className="inp" rows={4} value={form.notities} onChange={e => zet('notities')(e.target.value)} placeholder="Afmetingen, gebruik, opmerkingen…" />
              </>
            )}
          </div>
        </div>
        {!nieuw && <Historiek entiteit="artikel" id={id} versie={versie} />}
      </div>
      {boeking && <BoekingDialoog richting={boeking} artikel={art} onSluit={() => setBoeking(null)} onKlaar={naBoeking} />}
    </>
  );
}
