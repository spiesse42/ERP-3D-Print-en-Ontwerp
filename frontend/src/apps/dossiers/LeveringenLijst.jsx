import { useMemo, useState } from 'react';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { datum, aantal } from '../../lib/formaat.js';

// Overzicht van alle leveringen (stap 5c). Een levering opent in haar dossier.
export default function LeveringenLijst() {
  const { navigeer } = useOmgeving();
  const { data, fout, laden } = useData('/leveringen');
  const [zoek, setZoek] = useState('');
  const [sortering, setSortering] = useState({ kolom: 1, op: false });
  const kolommen = [
    { kop: 'Pakbon', cel: l => <span className="mono">{l.nummer}</span>, sorteer: l => l.nummer },
    { kop: 'Datum', cel: l => <span className="num">{datum(l.datum)}</span>, sorteer: l => `${l.datum}-${String(l.id).padStart(6, '0')}` },
    { kop: 'Dossier', cel: l => <><b>{l.titel}</b><div className="sub mono">{l.dossier_nummer}</div></>, sorteer: l => l.titel.toLowerCase() },
    { kop: 'Klant', cel: l => l.klant || '—', sorteer: l => (l.klant || '').toLowerCase() },
    { kop: 'Stuks', klasse: 'r', cel: l => <span className="num">{aantal(l.aantal_stuks)}</span>, sorteer: l => l.aantal_stuks },
  ];
  const rijen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    let r = data.filter(l => !q || [l.nummer, l.titel, l.klant, l.dossier_nummer].some(v => String(v || '').toLowerCase().includes(q)));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) r = [...r].sort((a, b) => { const x = s(a), y = s(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortering.op ? 1 : -1); });
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, sortering]);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Leveringen' }]} zoek={zoek} onZoek={setZoek} teller={data ? `${rijen.length} / ${data.length}` : null} />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={l => l.id} onOpen={l => navigeer(`/dossiers/${l.dossier_id}?tab=leveringen`)}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={l => ({ titel: `${l.nummer} · ${l.titel}`, rechts: <span className="num">{datum(l.datum)}</span>, regel: l.klant, onder: `${aantal(l.aantal_stuks)} stuks` })}
          leeg={data && data.length === 0 ? <><b>Nog geen leveringen.</b>Lever vanuit een dossier (tabblad Leveringen).</> : <><b>Geen leveringen gevonden.</b>Pas je zoekopdracht aan.</>} />
      )}
    </>
  );
}
