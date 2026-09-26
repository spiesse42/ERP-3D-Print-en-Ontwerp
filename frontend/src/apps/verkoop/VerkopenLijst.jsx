import { useMemo, useState } from 'react';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, datum } from '../../lib/formaat.js';

// Tegel Verkoop (26-09): ALLE afrekeningen op één plaats — bonnetjes van
// losse verkopen én van dossiers (door het ERP of met de hand uit
// Accountable), en facturen van dossiers. Een losse verkoop opent hier, een
// dossier-afrekening in haar dossier.
const BRON = { verkoop: 'Losse verkoop', dossier: 'Dossier' };
export function StatusBadge({ x }) {
  if (x.geannuleerd_op) return <span className="badge b-neutral">Ongedaan</span>;
  if (!x.erp) return <span className="badge b-neutral" title="Gemaakt in Accountable, nummer met de hand ingevuld">Uit Accountable</span>;
  return x.gemaild_op ? <span className="badge b-pos">Bij Accountable</span> : <span className="badge b-crit">Nog niet gemaild</span>;
}

export default function VerkopenLijst() {
  const { navigeer } = useOmgeving();
  const { data, fout, laden } = useData('/verkopen');
  const [zoek, setZoek] = useState('');
  const [soort, setSoort] = useState(null);   // null | 'bonnetje' | 'factuur'
  const [sortering, setSortering] = useState({ kolom: 1, op: false });
  const kolommen = [
    { kop: 'Nummer', cel: x => <span className="mono">{x.nummer}</span>, sorteer: x => String(x.nummer) },
    { kop: 'Datum', cel: x => <span className="num">{datum(x.datum)}</span>, sorteer: x => `${x.datum}-${String(x.nummer)}` },
    { kop: 'Wat', cel: x => <><b>{x.titel || (x.bron === 'verkoop' ? 'Losse verkoop' : '—')}</b><div className="sub">{x.bron === 'dossier' ? <span className="mono">{x.dossier_nummer}</span> : BRON.verkoop}</div></>, sorteer: x => String(x.titel || '').toLowerCase() },
    { kop: 'Klant', cel: x => x.klant || <span className="sub">—</span>, sorteer: x => (x.klant || '').toLowerCase() },
    { kop: 'Bedrag', klasse: 'r', cel: x => <span className={`num${x.geannuleerd_op ? ' sub' : ''}`}>{euro(x.bedrag)}</span>, sorteer: x => x.bedrag },
    { kop: 'Status', cel: x => <StatusBadge x={x} />, sorteer: x => (x.geannuleerd_op ? 3 : !x.erp ? 2 : x.gemaild_op ? 1 : 0) },
  ];
  const rijen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    let r = data.filter(x => (!soort || x.soort === soort) && (!q || [x.nummer, x.titel, x.klant, x.dossier_nummer].some(v => String(v || '').toLowerCase().includes(q))));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) r = [...r].sort((a, b) => { const x = s(a), y = s(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortering.op ? 1 : -1); });
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, soort, sortering]);
  const nietGemaild = (data || []).filter(x => x.erp && !x.gemaild_op && !x.geannuleerd_op).length;
  const open = x => navigeer(x.bron === 'verkoop' ? `/verkoop/${x.id}` : `/dossiers/${x.id}`);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Verkoop' }]} zoek={zoek} onZoek={setZoek} teller={data ? `${rijen.length} / ${data.length}` : null}
        acties={<button type="button" className="btn primary" onClick={() => navigeer('/verkoop/nieuw')}>Nieuwe verkoop</button>}
        filters={<>
          <Chip aan={soort === null} onClick={() => setSoort(null)}>Alles</Chip>
          <Chip aan={soort === 'bonnetje'} onClick={() => setSoort('bonnetje')}>Bonnetjes</Chip>
          <Chip aan={soort === 'factuur'} onClick={() => setSoort('factuur')}>Facturen</Chip>
        </>} />
      {nietGemaild > 0 && <div className="waarschuwing" style={{ margin: '12px 22px 0', display: 'block' }} role="status">{nietGemaild} bonnetje{nietGemaild > 1 ? 's zijn' : ' is'} nog niet naar Accountable gemaild: open {nietGemaild > 1 ? 'ze' : 'het'} en kies "Bonnetje mailen".</div>}
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={x => x.sleutel} onOpen={open}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={x => ({ titel: `${x.nummer}`, rechts: <b className="num">{euro(x.bedrag)}</b>, regel: [x.titel, x.klant].filter(Boolean).join(' · ') || BRON[x.bron], onder: <>{datum(x.datum)} <StatusBadge x={x} /></> })}
          leeg={data && data.length === 0
            ? <><b>Nog geen verkopen of afrekeningen.</b>Verkoop iets uit voorraad met "Nieuwe verkoop", of maak een bonnetje vanuit een dossier.</>
            : <><b>Niets gevonden.</b>Pas je zoekopdracht of filter aan.</>} />
      )}
    </>
  );
}
