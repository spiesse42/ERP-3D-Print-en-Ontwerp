import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, aantal } from '../../lib/formaat.js';
import { PrintopdrachtDialoog } from './TeBestellen.jsx';

// Producten (06-10): de vaste producten (zelf geprint, verkocht) met kost per
// stuk (gemeten, anders geschat uit printprofiel + onderdelen), marge,
// voorraad en verkoop. Plus "Webshop ophalen": producten uit de webshop
// (Sanity) overnemen of bijwerken.
const STATUS = { nieuw: ['Nieuw', 'b-accent'], zelfde_naam: ['Zelfde naam: koppelen', 'b-info'], gewijzigd: ['Gewijzigd', 'b-warn'], gekoppeld: ['In orde', 'b-pos'] };

function WebshopDialoog({ onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const { data, fout } = useData('/producten/webshop');
  const [gekozen, setGekozen] = useState(null);
  const [bezig, setBezig] = useState(false);
  // standaard aangevinkt: alles wat nieuw/gewijzigd/te koppelen is, behalve maatwerk
  const keuze = gekozen ?? new Set((data?.producten || []).filter(p => p.status !== 'gekoppeld' && !p.maatwerk).map(p => p.sleutel));
  const wissel = k => setGekozen(() => { const n = new Set(keuze); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  async function ok() {
    setBezig(true);
    try {
      const uit = await api.post('/producten/webshop/overnemen', { sleutels: [...keuze] });
      const tel = a => uit.filter(u => u.actie === a).length;
      melding(`Webshop: ${tel('aangemaakt')} nieuw, ${tel('gekoppeld')} gekoppeld, ${tel('bijgewerkt')} bijgewerkt${tel('overgeslagen') ? `, ${tel('overgeslagen')} overgeslagen` : ''}.`);
      onKlaar();
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  return (
    <Dialoog titel="Producten uit de webshop" breed onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !keuze.size} onClick={ok}>{bezig ? 'Bezig…' : `Overnemen (${keuze.size})`}</button></>}>
      {fout && <div className="waarschuwing" role="alert" style={{ display: 'block', marginBottom: 10 }}>{fout}</div>}
      {!data && !fout && <Laden />}
      {data && <>
        <p className="note" style={{ marginTop: 0 }}>De webshop blijft de bron voor naam, prijs en foto; het ERP voor printprofiel, onderdelen, voorraad en kost. Nieuw = een artikel "Printen we zelf" (categorie onder "Webshop"); bestaand = naam en prijs bijwerken. Maatwerkproducten (offerte, configurator) staan standaard uit.</p>
        <div className="tabelvak"><table className="mini">
          <thead><tr><th><span className="sr-only">Kiezen</span></th><th>Webshop</th><th>Categorie</th><th className="r">Prijs</th><th>In het ERP</th></tr></thead>
          <tbody>
            {data.producten.map(p => (
              <tr key={p.sleutel}>
                <td><input type="checkbox" aria-label={`${p.naam} overnemen`} checked={keuze.has(p.sleutel)} disabled={p.status === 'gekoppeld'} onChange={() => wissel(p.sleutel)} /></td>
                <td>{p.foto && <img src={`${p.foto}?w=64&h=64&fit=crop`} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, verticalAlign: 'middle', marginRight: 8 }} />}<b>{p.naam}</b>
                  {p.maatwerk && <span className="sub"> · maatwerk</span>}{p.verborgen && <span className="sub"> · verborgen</span>}{p.binnenkort && <span className="sub"> · binnenkort</span>}</td>
                <td className="sub">{p.categorie || '—'}</td>
                <td className="r num">{p.prijs != null ? `${p.vanaf ? 'vanaf ' : ''}${euro(p.prijs)}` : '—'}</td>
                <td><span className={`badge ${STATUS[p.status][1]}`}>{STATUS[p.status][0]}</span>{p.verschil.length > 0 && <div className="sub">{p.verschil.join(' · ')}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.weg.length > 0 && <p className="note">Niet meer in de webshop: {data.weg.map(a => a.naam).join(', ')}. Archiveer ze in het ERP of koppel ze los (artikel → Webshop).</p>}
      </>}
    </Dialoog>
  );
}

export default function Producten() {
  const { navigeer } = useOmgeving();
  const { data, fout, laden, herlaad } = useData('/producten');
  const [zoek, setZoek] = useState('');
  const [filter, setFilter] = useState(null);   // 'webshop' | 'zonder_profiel' | 'onder_min'
  const [webshop, setWebshop] = useState(false);
  const [printen, setPrinten] = useState(null);
  const rijen = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    return (data || []).filter(p => (!q || [p.weergave, p.categorie].some(v => String(v || '').toLowerCase().includes(q)))
      && (filter !== 'webshop' || p.webshop) && (filter !== 'zonder_profiel' || !p.profiel)
      && (filter !== 'onder_min' || (p.min != null && p.voorraad + p.in_productie < p.min)));
  }, [data, zoek, filter]);
  const kost = p => (p.kost == null ? <span className="sub">{p.profiel ? 'onvolledig' : 'geen profiel'}</span>
    : <>{euro(p.kost)}<div className="sub">{p.gemeten ? `gemeten (${aantal(p.gemeten.stuks)} st.)` : 'geschat'}{p.schatting.onvolledig && !p.gemeten ? ' · onvolledig' : ''}</div></>);
  const kolommen = [
    { kop: 'Product', cel: p => <>{p.webshop?.foto && <img src={`${p.webshop.foto}?w=64&h=64&fit=crop`} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, verticalAlign: 'middle', marginRight: 8 }} />}<b>{p.weergave}</b>{p.webshop && <span className="badge b-info" style={{ marginLeft: 6 }}>webshop</span>}</> },
    { kop: 'Categorie', cel: p => <span className="sub">{p.categorie || '—'}</span> },
    { kop: 'Prijs', klasse: 'r num', cel: p => euro(p.verkoopprijs) },
    { kop: 'Kost / stuk', klasse: 'r num', cel: kost },
    { kop: 'Marge', klasse: 'r num', cel: p => (p.marge == null ? <span className="sub">—</span> : <><b className={p.marge < 0 ? 'neg' : ''}>{euro(p.marge)}</b><div className="sub">{p.marge_pct} %</div></>) },
    { kop: 'Voorraad', klasse: 'r num', cel: p => <>{aantal(p.voorraad)}{p.in_productie > 0 && <div className="sub">+ {aantal(p.in_productie)} in productie</div>}{p.min != null && <div className="sub">min {aantal(p.min)}</div>}</> },
    { kop: 'Verkocht 30 d.', klasse: 'r num', cel: p => aantal(p.verkocht_30d) },
    { kop: '', klasse: 'r', cel: p => <button type="button" className="btn klein" onClick={e => { e.stopPropagation(); setPrinten(p); }}>Bijprinten</button> },
  ];
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Producten' }]} zoek={zoek} onZoek={setZoek}
        acties={<button type="button" className="btn primary" onClick={() => setWebshop(true)}>Webshop ophalen</button>}
        filters={<>
          <Chip aan={filter === 'webshop'} onClick={() => setFilter(f => (f === 'webshop' ? null : 'webshop'))}>In de webshop</Chip>
          <Chip aan={filter === 'zonder_profiel'} onClick={() => setFilter(f => (f === 'zonder_profiel' ? null : 'zonder_profiel'))}>Zonder printprofiel</Chip>
          <Chip aan={filter === 'onder_min'} onClick={() => setFilter(f => (f === 'onder_min' ? null : 'onder_min'))}>Onder minimum</Chip>
        </>}
        teller={data ? `${rijen.length} / ${data.length}` : null} />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <>
          <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={p => p.id} onOpen={p => navigeer(`/voorraad/artikelen/${p.id}`)}
            kaart={p => ({ titel: p.weergave, rechts: euro(p.verkoopprijs), regel: `Kost ${p.kost == null ? '?' : euro(p.kost)} · marge ${p.marge == null ? '?' : `${euro(p.marge)} (${p.marge_pct} %)`}`, onder: `Voorraad ${aantal(p.voorraad)} · verkocht 30 d. ${aantal(p.verkocht_30d)}`, badge: p.webshop ? <span className="badge b-info">webshop</span> : null })}
            leeg={<><b>Nog geen vaste producten.</b>Haal ze op uit de webshop, of vink bij een artikel "Printen we zelf" aan.</>} />
          <p className="note" style={{ padding: '0 16px' }}>Kost per stuk = filament (inkoopprijs), elektriciteit, machine en BMCU + onderdelen, zonder arbeid. Gemeten zodra er printopdrachten van dit product bevestigd zijn, anders geschat uit het printprofiel. Marge = verkoopprijs − kost (btw 0 %).</p>
        </>
      )}
      {webshop && <WebshopDialoog onSluit={() => setWebshop(false)} onKlaar={() => { setWebshop(false); herlaad(); }} />}
      {printen && <PrintopdrachtDialoog a={{ id: printen.id, weergave: printen.weergave, voorraad: printen.voorraad, in_productie: printen.in_productie, voorstel: Math.max(1, (printen.min ?? 0) - printen.voorraad - printen.in_productie) }} onSluit={() => setPrinten(null)} />}
    </>
  );
}
