import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import { euro, aantal } from '../../lib/formaat.js';
import { PrintopdrachtDialoog } from '../voorraad/TeBestellen.jsx';

// Webshopbestellingen (07-10): betaalde bestellingen uit de webshop
// (Supabase). Bij het openen worden nieuwe opgehaald. Per regel: gekoppeld
// artikel + voorraad (Bijprinten bij tekort). "Verkoop maken" vult een
// nieuwe verkoop in; die zet de bestelling op afgehandeld.
// 25-10: klant + klantdossier met de printregels. Standaard aangevinkt:
// gepersonaliseerd, niet gekoppeld of te weinig op voorraad (zoals de backend).
const persVan = i => [i.tekst ? `Naam: "${i.tekst}"` : null, i.lettertype ? `Lettertype: ${i.lettertype}` : null, i.symbool ? `Symbool: ${i.symbool}` : null].filter(Boolean).join(' · ');
const moetPrinten = i => !!persVan(i) || !i.artikel || i.artikel.voorraad < i.aantal;
function DossierDialoog({ b, onSluit, onKlaar }) {
  const { melding, navigeer } = useOmgeving();
  const [kies, setKies] = useState(() => b.items.map(moetPrinten));
  const [bezig, setBezig] = useState(false);
  async function ok() {
    setBezig(true);
    try {
      const r = await api.post(`/webshopbestellingen/${encodeURIComponent(b.id)}/dossier`, { items: kies.map((x, i) => (x ? i : null)).filter(i => i !== null) });
      melding(`Dossier ${r.nummer} aangemaakt${r.klant_nieuw ? ' met een nieuwe klantfiche' : ' bij de bestaande klant'}.${r.waarschuwingen.length ? ` Let op: ${r.waarschuwingen.join(' ')}` : ''}`, r.waarschuwingen.length ? 'fout' : undefined);
      onKlaar?.();
      navigeer(`/dossiers/${r.dossier_id}`);
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  return (
    <Dialoog titel="Klant + dossier maken" onSluit={onSluit} voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button>
      <button type="button" className="btn primary" disabled={bezig || !kies.some(Boolean)} onClick={ok}>{bezig ? 'Bezig…' : 'Dossier maken'}</button></>}>
      <p className="sub" style={{ marginTop: 0 }}>{b.klant_id ? 'De bestaande klantfiche (zelfde e-mailadres) wordt gebruikt.' : `Er komt een nieuwe klantfiche voor ${b.klant_naam || b.email}.`} Vink aan wat je moet printen: elke lijn wordt een printregel uit het printprofiel van het product (met het slicerbestand en het filament van de gekozen kleur), aan de prijs uit de webshop.</p>
      {b.items.map((i, k) => (
        <label key={k} className="vinkje" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
          <input type="checkbox" checked={kies[k]} onChange={e => setKies(x => x.map((v, j) => (j === k ? e.target.checked : v)))} />
          <span>{aantal(i.aantal)}× {i.naam}{i.kleuren.length > 0 && <b> — {i.kleuren.join(' / ')}</b>}
            <span className="sub" style={{ display: 'block' }}>{!i.artikel ? 'niet gekoppeld aan een artikel' : persVan(i) ? 'gepersonaliseerd' : `voorraad ${aantal(i.artikel.voorraad)}`}</span></span>
        </label>
      ))}
      <p className="note" style={{ marginBottom: 0 }}>Wat je niet aanvinkt, verkoop je gewoon uit voorraad. Verzending blijft op de verkoop. Bij "Verkoop maken" komt het dossier dan als één regel op het bonnetje of de factuur.</p>
    </Dialoog>
  );
}

const dt = s => new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function WebshopBestellingen() {
  const { melding, navigeer } = useOmgeving();
  const [alles, setAlles] = useState(false);
  const { data, fout, laden, herlaad } = useData(`/webshopbestellingen${alles ? '?alles=1' : ''}`);
  const [bezig, setBezig] = useState(false);
  const [printen, setPrinten] = useState(null);
  const [dossierVoor, setDossierVoor] = useState(null);
  async function ophalen(stil = false) {
    setBezig(true);
    try { const r = await api.post('/webshopbestellingen/ophalen'); await herlaad(); if (!stil || r.nieuw) melding(r.nieuw ? `${r.nieuw} nieuwe bestelling${r.nieuw === 1 ? '' : 'en'} uit de webshop.` : 'Geen nieuwe bestellingen.'); }
    catch (e) { if (!stil) melding(e.message, 'fout'); }
    setBezig(false);
  }
  useEffect(() => { if (data?.ingesteld) ophalen(true); }, [data?.ingesteld]); // eslint-disable-line react-hooks/exhaustive-deps
  async function afgehandeld(b, aan) {
    try { await api.post(`/webshopbestellingen/${b.id}/afgehandeld`, { aan }); await herlaad(); } catch (e) { melding(e.message, 'fout'); }
  }
  const lijst = (data?.bestellingen || []);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Webshop' }]}
        acties={<button type="button" className="btn primary" disabled={bezig || !data?.ingesteld} onClick={() => ophalen()}>{bezig ? 'Bezig…' : 'Ophalen'}</button>}
        filters={<Chip aan={alles} onClick={() => setAlles(a => !a)}>Ook oudere afgehandelde</Chip>}
        teller={data ? `${lijst.filter(b => !b.afgehandeld).length} open` : null} />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : !data.ingesteld ? (
        <div className="leeg"><b>De webshop is nog niet gekoppeld.</b>Vul in Home Assistant bij de add-on-configuratie <code>supabase_url</code> en <code>supabase_key</code> in (Supabase → Project Settings → API) en herstart de add-on.</div>
      ) : !lijst.length ? <div className="leeg"><b>Nog geen bestellingen.</b>Betaalde bestellingen uit de webshop verschijnen hier.</div> : (
        <div style={{ padding: '0 16px 16px', display: 'grid', gap: 12 }}>
          {lijst.map(b => (
            <div key={b.id} className="sheet" style={{ padding: 16, opacity: b.afgehandeld ? 0.7 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <b>{b.klant_naam || 'Onbekend'}</b> <span className="sub">· {dt(b.besteld_op)}</span>
                  <div className="sub">{[b.email, b.telefoon].filter(Boolean).join(' · ')}</div>
                  <div className="sub">{b.verzending ? `${b.verzending}: ` : ''}{b.adres}</div>
                  {b.opmerking && <div className="sub">Opmerking: {b.opmerking}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b className="num">{euro(b.totaal)}</b>
                  <div>{b.afgehandeld ? <span className="badge b-pos">afgehandeld</span> : <span className="badge b-warn">te doen</span>}</div>
                  {b.verkoop_id && <Link naar={`/verkoop/${b.verkoop_id}`} className="mono linkish">{b.verkoop_nummer}</Link>}
                  {b.dossier_id && <div><Link naar={`/dossiers/${b.dossier_id}`} className="mono linkish">{b.dossier_nummer}</Link></div>}
                  {b.klant_id && <div><Link naar={`/klanten/${b.klant_id}`} className="linkish">klantfiche</Link></div>}
                </div>
              </div>
              <table className="mini" style={{ marginTop: 10, width: '100%' }}>
                <tbody>
                  {b.items.map((i, k) => {
                    // 18-10: gepersonaliseerd (naam/lettertype) = altijd apart printen
                    const pers = persVan(i);
                    const tekort = i.artikel && !i.in_dossier && (pers || i.artikel.voorraad < i.aantal);
                    return (
                      <tr key={k}>
                        <td className="num" style={{ width: 40 }}>{aantal(i.aantal)}×</td>
                        <td>{i.naam}{i.kleuren.length > 0 && <b> — {i.kleuren.join(' / ')}</b>}
                          {pers && <div><span className="badge b-info">{pers}</span></div>}
                          {(i.kleur_info || []).filter(k => k.filament).map(k => <div key={k.label} className="sub"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: k.hex || 'transparent', border: '1px solid var(--line)', marginRight: 4 }} />{k.label}: <b>{k.filament}</b></div>)}</td>
                        <td className="sub">{i.in_dossier ? <Link naar={`/dossiers/${b.dossier_id}`}>in dossier {b.dossier_nummer}</Link> : i.artikel ? <Link naar={`/voorraad/artikelen/${i.artikel.id}`}>voorraad {aantal(i.artikel.voorraad)}</Link> : 'niet gekoppeld (Producten → Webshop ophalen)'}</td>
                        <td className="r">{tekort && !b.afgehandeld && <button type="button" className="btn klein" onClick={() => setPrinten({ id: i.artikel.id, weergave: i.artikel.naam, voorraad: i.artikel.voorraad, in_productie: 0, voorstel: pers ? i.aantal : i.aantal - i.artikel.voorraad, personalisatie: pers || null })}>{pers ? 'Printen' : 'Bijprinten'}</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="tabacties" style={{ marginTop: 10 }}>
                {!b.afgehandeld && !b.dossier_id && !b.verkoop_id && <button type="button" className="btn" onClick={() => setDossierVoor(b)}>Klant + dossier maken</button>}
                {!b.afgehandeld && <button type="button" className="btn primary" onClick={() => navigeer(`/verkoop/nieuw?webshop=${encodeURIComponent(b.id)}`)}>Verkoop maken</button>}
                {b.tracking_url && <a className="btn ghost" href={b.tracking_url} target="_blank" rel="noopener noreferrer">Track & trace</a>}
                <button type="button" className="btn ghost" onClick={() => afgehandeld(b, !b.afgehandeld)}>{b.afgehandeld ? 'Terug naar te doen' : 'Afgehandeld zonder verkoop'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {printen && <PrintopdrachtDialoog a={printen} onSluit={() => setPrinten(null)} />}
      {dossierVoor && <DossierDialoog b={dossierVoor} onSluit={() => setDossierVoor(null)} onKlaar={herlaad} />}
    </>
  );
}
