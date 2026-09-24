import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, aantal, naarInvoer } from '../../lib/formaat.js';
import { Dialoog } from '../../schil/Omgeving.jsx';
import { Link } from '../../schil/Schil.jsx';
import { ArtikelNaam } from './ArtikelenLijst.jsx';
import { eenheid } from './artikel.js';

// "Te bestellen / te produceren": één berekening in de backend
// (domein/voorraad.js). Hier tonen, groeperen, en (stap 3b) de gekozen
// regels omzetten naar conceptaankopen: één per voorkeursleverancier.
// Zelf printen → printopdracht (stap 6c): maakt een dossier "Eigen product"
// met een printregel (de vorige keer als sjabloon) en plant de opdracht.
function PrintopdrachtDialoog({ a, onSluit }) {
  const { navigeer, melding } = useOmgeving();
  const { data: printers } = useData('/printers');
  const [f, setF] = useState({ aantal: naarInvoer(a.voorstel), printer_id: '' });
  const [bezig, setBezig] = useState(false);
  async function ok() {
    setBezig(true);
    try {
      const u = await api.post('/productie/eigen-product', { artikel_id: a.id, aantal: f.aantal, printer_id: Number(f.printer_id) });
      melding(u.sjabloon ? `Dossier ${u.nummer} en printopdracht gemaakt (printregel van de vorige keer).` : `Dossier ${u.nummer} en printopdracht gemaakt. Vul printtijd en filament nog aan.`);
      navigeer(`/dossiers/${u.dossier_id}?tab=${u.sjabloon ? 'productie' : 'regels'}`);
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  return (
    <Dialoog titel={`Printopdracht · ${a.weergave}`} onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" disabled={bezig || !f.printer_id} onClick={ok}>Plannen</button></>}>
      <div className="fgrid">
        <div><label htmlFor="tp-aantal">Aantal stuks</label><input id="tp-aantal" className="inp num" inputMode="decimal" value={f.aantal} onChange={e => setF(x => ({ ...x, aantal: e.target.value }))} /></div>
        <div><label htmlFor="tp-printer">Printer</label>
          <select id="tp-printer" className="inp" value={f.printer_id} onChange={e => setF(x => ({ ...x, printer_id: e.target.value }))}>
            <option value="">— kies —</option>
            {(printers || []).filter(p => p.actief).map(p => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select></div>
      </div>
      <p className="sub"><Link naar={`/voorraad/artikelen/${a.id}`}>Artikel openen</Link> · voorraad {aantal(a.voorraad)}{a.in_productie ? ` · ${aantal(a.in_productie)} in productie` : ''}</p>
      <p className="note" style={{ marginBottom: 0 }}>Er komt een dossier "Eigen product" met een printregel voor dit artikel; printtijd en filament worden overgenomen van de vorige keer (herschaald naar het aantal). Bij het bevestigen gaan de goede stuks in voorraad.</p>
    </Dialoog>
  );
}

export default function TeBestellen() {
  const { navigeer, melding } = useOmgeving();
  const { data, fout, laden } = useData('/voorraad/te-bestellen');
  const [printen, setPrinten] = useState(null);   // artikel om te laten printen
  const [zoek, setZoek] = useState('');
  const [actie, setActie] = useState(null);   // 'bestellen' | 'produceren' | null
  const [gekozen, setGekozen] = useState(() => new Set());
  const [bezig, setBezig] = useState(false);

  const groepen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    const rijen = data.filter(a => (!actie || a.actie === actie) && (!q || [a.weergave, a.leverancier, a.categorie].some(v => String(v || '').toLowerCase().includes(q))));
    const m = new Map();
    rijen.forEach(a => {
      const g = a.actie === 'produceren' ? 'Zelf printen' : a.leverancier ? `Bestellen bij ${a.leverancier}` : 'Bestellen · geen leverancier gekend';
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(a);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'nl')).map(([titel, rijen]) => ({ titel, rijen }));
  }, [data, zoek, actie]);

  const bestelbaar = groepen.flatMap(g => g.rijen).filter(a => a.actie === 'bestellen');
  const alles = bestelbaar.length > 0 && bestelbaar.every(a => gekozen.has(a.id));
  const wissel = id => setGekozen(g => { const n = new Set(g); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const wisselAlles = () => setGekozen(alles ? new Set() : new Set(bestelbaar.map(a => a.id)));
  const keuze = (data || []).filter(a => gekozen.has(a.id) && a.actie === 'bestellen');

  async function bestellingMaken() {
    setBezig(true);
    try {
      const uit = await api.post('/inkoop/bestelling-maken', { regels: keuze.map(a => ({ artikel_id: a.id, aantal: a.voorstel })) });
      melding(uit.length === 1 ? `Conceptaankoop ${uit[0].nummer} gemaakt.` : `${uit.length} conceptaankopen gemaakt (één per leverancier).`);
      navigeer(uit.length === 1 ? `/inkoop/aankopen/${uit[0].id}` : '/inkoop/aankopen?status=concept');
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  const kolommen = [
    { kop: <input type="checkbox" aria-label="Alle te bestellen artikelen kiezen" checked={alles} onChange={wisselAlles} disabled={!bestelbaar.length} />,
      klasse: 'kies', cel: a => (a.actie === 'bestellen'
        ? <input type="checkbox" aria-label={`${a.weergave} kiezen`} checked={gekozen.has(a.id)} onChange={() => wissel(a.id)} onClick={e => e.stopPropagation()} />
        : null) },
    { kop: 'Artikel', cel: a => <><ArtikelNaam a={a} />{a.leverancier_code && <div className="sub mono">{a.leverancier_code}</div>}</> },
    { kop: 'Voorraad', klasse: 'r num', cel: a => aantal(a.voorraad) },
    { kop: 'Besteld', klasse: 'r num', cel: a => (a.besteld || a.in_productie ? <>{a.besteld ? aantal(a.besteld) : ''}{a.in_productie ? <div className="sub">{aantal(a.in_productie)} in productie</div> : null}</> : <span className="sub">—</span>) },
    { kop: 'Min – max', klasse: 'r num', cel: a => `${aantal(a.min_eff)} – ${a.max_eff == null ? '…' : aantal(a.max_eff)}` },
    { kop: 'Voorstel', klasse: 'r num', cel: a => <b>{aantal(a.voorstel)} {eenheid(a.voorstel, a.eenheid)}</b> },
    { kop: 'Prijs', klasse: 'r num', cel: a => {
      if (a.actie === 'produceren') return <button type="button" className="btn klein" onClick={e => { e.stopPropagation(); setPrinten(a); }}>Printopdracht maken</button>; const p = a.leverancier_prijs ?? a.gem_prijs ?? a.inkoopprijs; return p == null ? <span className="sub">—</span> : <>{euro(p)}<div className="sub">± {euro(p * a.voorstel)}</div></>; } },
  ];
  const facetten = actie ? [{ label: actie === 'bestellen' ? 'Bestellen' : 'Zelf printen', onWeg: () => setActie(null) }] : [];
  const leeg = data && data.length === 0
    ? <><b>Niets te bestellen.</b>Alle artikelen met een minimum zitten op peil (voorraad + wat al besteld is).</>
    : <><b>Niets gevonden.</b>Pas je zoekopdracht of filter aan.</>;

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Te bestellen' }]}
        zoek={zoek} onZoek={setZoek} facetten={facetten}
        acties={<button type="button" className="btn primary" disabled={!keuze.length || bezig} onClick={bestellingMaken}
          title={keuze.length ? undefined : 'Vink eerst de artikelen aan die je wilt bestellen'}>Bestelling maken{keuze.length ? ` (${keuze.length})` : ''}</button>}
        filters={<>
          <Chip aan={alles} onClick={wisselAlles}>Alles kiezen</Chip>
          <Chip aan={actie === 'bestellen'} onClick={() => setActie(x => (x === 'bestellen' ? null : 'bestellen'))}>Bestellen</Chip>
          <Chip aan={actie === 'produceren'} onClick={() => setActie(x => (x === 'produceren' ? null : 'produceren'))}>Zelf printen</Chip>
        </>}
        teller={data ? `${groepen.reduce((s, g) => s + g.rijen.length, 0)} / ${data.length}` : null}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <>
          <Lijst kolommen={kolommen} groepen={groepen} sleutel={a => a.id} onOpen={a => (a.actie === 'produceren' ? setPrinten(a) : navigeer(`/voorraad/artikelen/${a.id}`))}
            kaart={a => ({
              titel: <ArtikelNaam a={a} />, rechts: <b className="num">{aantal(a.voorstel)} {eenheid(a.voorstel, a.eenheid)}</b>,
              regel: `Voorraad ${aantal(a.voorraad)}${a.besteld ? ` + ${aantal(a.besteld)} besteld` : ''} · min ${aantal(a.min_eff)}${a.max_eff != null ? ` · max ${aantal(a.max_eff)}` : ''}`,
              onder: a.leverancier || (a.actie === 'produceren' ? 'Zelf printen · tik om te plannen' : 'Geen leverancier'),
              badge: gekozen.has(a.id) ? <span className="badge b-accent">gekozen</span> : null,
            })}
            leeg={leeg} />
          {printen && <PrintopdrachtDialoog a={printen} onSluit={() => setPrinten(null)} />}
          <p className="note" style={{ padding: '0 16px' }}>Voorstel = aanvullen tot het maximum (of tot het minimum als er geen maximum is), min wat al besteld of in productie is. "Bestelling maken" zet de gekozen artikelen in een conceptaankoop per voorkeursleverancier; aantallen en prijzen pas je daar nog aan.</p>
        </>
      )}
    </>
  );
}
