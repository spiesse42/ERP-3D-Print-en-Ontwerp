import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import { euro, aantal } from '../../lib/formaat.js';
import { PrintopdrachtDialoog } from '../voorraad/TeBestellen.jsx';

// Webshopbestellingen (07-10): betaalde bestellingen uit de webshop
// (Supabase). Bij het openen worden nieuwe opgehaald. Per regel: gekoppeld
// artikel + voorraad (Bijprinten bij tekort). "Verkoop maken" vult een
// nieuwe verkoop in; die zet de bestelling op afgehandeld.
const dt = s => new Date(s).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function WebshopBestellingen() {
  const { melding, navigeer } = useOmgeving();
  const [alles, setAlles] = useState(false);
  const { data, fout, laden, herlaad } = useData(`/webshopbestellingen${alles ? '?alles=1' : ''}`);
  const [bezig, setBezig] = useState(false);
  const [printen, setPrinten] = useState(null);
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
                </div>
              </div>
              <table className="mini" style={{ marginTop: 10, width: '100%' }}>
                <tbody>
                  {b.items.map((i, k) => {
                    const tekort = i.artikel && i.artikel.voorraad < i.aantal;
                    return (
                      <tr key={k}>
                        <td className="num" style={{ width: 40 }}>{aantal(i.aantal)}×</td>
                        <td>{i.naam}{i.kleuren.length > 0 && <b> — {i.kleuren.join(' / ')}</b>}</td>
                        <td className="sub">{i.artikel ? <Link naar={`/voorraad/artikelen/${i.artikel.id}`}>voorraad {aantal(i.artikel.voorraad)}</Link> : 'niet gekoppeld (Producten → Webshop ophalen)'}</td>
                        <td className="r">{tekort && !b.afgehandeld && <button type="button" className="btn klein" onClick={() => setPrinten({ id: i.artikel.id, weergave: i.artikel.naam, voorraad: i.artikel.voorraad, in_productie: 0, voorstel: i.aantal - i.artikel.voorraad })}>Bijprinten</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="tabacties" style={{ marginTop: 10 }}>
                {!b.afgehandeld && <button type="button" className="btn primary" onClick={() => navigeer(`/verkoop/nieuw?webshop=${encodeURIComponent(b.id)}`)}>Verkoop maken</button>}
                {b.tracking_url && <a className="btn ghost" href={b.tracking_url} target="_blank" rel="noopener noreferrer">Track & trace</a>}
                <button type="button" className="btn ghost" onClick={() => afgehandeld(b, !b.afgehandeld)}>{b.afgehandeld ? 'Terug naar te doen' : 'Afgehandeld zonder verkoop'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {printen && <PrintopdrachtDialoog a={printen} onSluit={() => setPrinten(null)} />}
    </>
  );
}
