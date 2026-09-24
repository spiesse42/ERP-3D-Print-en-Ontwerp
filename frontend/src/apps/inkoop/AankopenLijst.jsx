import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, datum } from '../../lib/formaat.js';
import { STATUS, AankoopStatus } from './aankoop.jsx';

const GROEPERING = { geen: null, status: 'Status', leverancier: 'Leverancier' };

export default function AankopenLijst() {
  const { navigeer } = useOmgeving();
  const [params, setParams] = useSearchParams();
  const artikelId = params.get('artikel');
  const leverancierId = params.get('leverancier');
  const [zoek, setZoek] = useState('');
  // standaard: alles behalve geannuleerd, zoals een Odoo-filter "Open"
  const [status, setStatus] = useState(params.get('status'));
  const [groep, setGroep] = useState('geen');
  const [sortering, setSortering] = useState({ kolom: 1, op: false });
  const q = new URLSearchParams();
  if (artikelId) q.set('artikel_id', artikelId);
  if (leverancierId) q.set('leverancier_id', leverancierId);
  const { data, fout, laden } = useData(`/inkoop/aankopen${q.toString() ? `?${q}` : ''}`);

  const kolommen = [
    { kop: 'Nummer', cel: a => <span className="mono"><b>{a.nummer}</b></span>, sorteer: a => a.nummer },
    { kop: 'Datum', cel: a => <span className="num">{datum(a.datum)}</span>, sorteer: a => a.datum },
    { kop: 'Leverancier', cel: a => a.leverancier || <span className="sub">nog niet gekozen</span>, sorteer: a => (a.leverancier || '').toLowerCase() },
    { kop: 'Inhoud', cel: a => <span className="sub">{a.samenvatting || 'geen regels'}</span> },
    { kop: 'Factuurnr. leverancier', cel: a => a.extern_factuurnummer || <span className="sub">—</span> },
    { kop: 'Status', cel: a => <AankoopStatus status={a.status} />, sorteer: a => Object.keys(STATUS).indexOf(a.status) },
    { kop: 'Totaal', klasse: 'r num', cel: a => euro(a.totaal), sorteer: a => a.totaal },
  ];

  const groepen = useMemo(() => {
    if (!data) return [];
    const z = zoek.trim().toLowerCase();
    let rijen = data.filter(a => (status ? a.status === status : a.status !== 'geannuleerd')
      && (!z || [a.nummer, a.leverancier, a.extern_factuurnummer, a.samenvatting, a.notities].some(v => String(v || '').toLowerCase().includes(z))));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) rijen = [...rijen].sort((x, y) => { const p = s(x), r = s(y); return (p < r ? -1 : p > r ? 1 : 0) * (sortering.op ? 1 : -1); });
    if (groep === 'geen') return [{ titel: null, rijen }];
    const sleutel = groep === 'status' ? (a => STATUS[a.status][1]) : (a => a.leverancier || 'Geen leverancier');
    const m = new Map();
    rijen.forEach(a => { const g = sleutel(a); if (!m.has(g)) m.set(g, []); m.get(g).push(a); });
    return [...m.entries()].map(([titel, rijen]) => ({ titel, rijen }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, status, groep, sortering]);

  const facetten = [];
  if (artikelId) facetten.push({ label: 'Met één artikel', onWeg: () => setParams({}) });
  if (leverancierId) facetten.push({ label: data?.[0]?.leverancier || 'Eén leverancier', onWeg: () => setParams({}) });
  if (status) facetten.push({ label: STATUS[status][1], onWeg: () => setStatus(null) });
  if (groep !== 'geen') facetten.push({ label: GROEPERING[groep], icoon: 'lagen', onWeg: () => setGroep('geen') });
  const aantal = groepen.reduce((s, g) => s + g.rijen.length, 0);

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Aankopen' }]}
        zoek={zoek} onZoek={setZoek} facetten={facetten}
        acties={<>
          <button type="button" className="btn" onClick={() => navigeer('/inkoop/inlezen')}>Factuur inlezen</button>
          <button type="button" className="btn primary" onClick={() => navigeer('/inkoop/aankopen/nieuw')}>Nieuw</button>
        </>}
        filters={<>
          {Object.entries(STATUS).map(([s, [, l]]) => <Chip key={s} aan={status === s} onClick={() => setStatus(x => (x === s ? null : s))}>{l}</Chip>)}
          <Chip aan={groep === 'leverancier'} onClick={() => setGroep(g => (g === 'leverancier' ? 'geen' : 'leverancier'))}>Groeperen op leverancier</Chip>
          <Chip aan={groep === 'status'} onClick={() => setGroep(g => (g === 'status' ? 'geen' : 'status'))}>Groeperen op status</Chip>
        </>}
        teller={data ? `${aantal} / ${data.length}` : null}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <Lijst kolommen={kolommen} groepen={groepen} sleutel={a => a.id} onOpen={a => navigeer(`/inkoop/aankopen/${a.id}`)}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={a => ({ titel: <span className="mono">{a.nummer}</span>, rechts: <b className="num">{euro(a.totaal)}</b>,
            regel: [a.leverancier, a.samenvatting].filter(Boolean).join(' · '), onder: datum(a.datum), badge: <AankoopStatus status={a.status} /> })}
          leeg={data.length === 0
            ? <><b>Nog geen aankopen.</b>Lees een factuur in, maak een aankoop met Nieuw, of via Voorraad → Te bestellen → Bestelling maken.</>
            : <><b>Geen aankopen gevonden.</b>Geannuleerde aankopen zie je via de filter "Geannuleerd".</>} />
      )}
    </>
  );
}
