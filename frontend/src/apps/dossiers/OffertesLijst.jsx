import { useMemo, useState } from 'react';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, datum } from '../../lib/formaat.js';
import { OFFERTE_STATUS, OfferteBadge } from './dossier.jsx';

// Overzicht van alle offertes (stap 5b). Een offerte opent in haar dossier.
export default function OffertesLijst() {
  const { navigeer } = useOmgeving();
  const { data, fout, laden } = useData('/offertes');
  const [zoek, setZoek] = useState('');
  const [status, setStatus] = useState(null);
  const [sortering, setSortering] = useState({ kolom: 0, op: false });
  const kolommen = [
    { kop: 'Offerte', cel: o => <span className="mono">{o.weergave}</span>, sorteer: o => `${o.nummer}-${String(o.versie).padStart(3, '0')}` },
    { kop: 'Dossier', cel: o => <><b>{o.titel}</b><div className="sub mono">{o.dossier_nummer}</div></>, sorteer: o => o.titel.toLowerCase() },
    { kop: 'Klant', cel: o => o.klant || '—', sorteer: o => (o.klant || '').toLowerCase() },
    { kop: 'Verstuurd', cel: o => <span className="num">{o.verstuurd_op ? datum(o.verstuurd_op) : '—'}</span>, sorteer: o => o.verstuurd_op || '' },
    { kop: 'Geldig tot', cel: o => <span className="num">{datum(o.geldig_tot)}</span>, sorteer: o => o.geldig_tot || '' },
    { kop: 'Status', cel: o => <OfferteBadge status={o.status} />, sorteer: o => o.status },
    { kop: 'Totaal', klasse: 'r', cel: o => <span className="num">{euro(o.totaal)}</span>, sorteer: o => o.totaal ?? -1 },
  ];
  const rijen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    let l = data.filter(o => (!status || o.status === status) && (!q || [o.weergave, o.titel, o.klant, o.dossier_nummer].some(v => String(v || '').toLowerCase().includes(q))));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) l = [...l].sort((a, b) => { const x = s(a), y = s(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortering.op ? 1 : -1); });
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, status, sortering]);
  const facetten = status ? [{ label: OFFERTE_STATUS[status][1], onWeg: () => setStatus(null) }] : [];
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Offertes' }]} zoek={zoek} onZoek={setZoek} facetten={facetten}
        filters={['concept', 'verstuurd', 'verlopen', 'aanvaard'].map(s => <Chip key={s} aan={status === s} onClick={() => setStatus(x => (x === s ? null : s))}>{OFFERTE_STATUS[s][1]}</Chip>)}
        teller={data ? `${rijen.length} / ${data.length}` : null} />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={o => o.id} onOpen={o => navigeer(`/dossiers/${o.dossier_id}?tab=offertes`)}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={o => ({ titel: `${o.weergave} · ${o.titel}`, rechts: <OfferteBadge status={o.status} />, regel: o.klant, onder: euro(o.totaal) })}
          leeg={data && data.length === 0 ? <><b>Nog geen offertes.</b>Maak een offerte vanuit een dossier (tabblad Offertes).</> : <><b>Geen offertes gevonden.</b>Pas je zoekopdracht of filters aan.</>} />
      )}
    </>
  );
}
