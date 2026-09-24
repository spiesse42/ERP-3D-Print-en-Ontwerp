import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData, onthoud, bewaar } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { aantal } from '../../lib/formaat.js';
import { OpdrachtBadge, OpdrachtDialoog, BevestigDialoog, Herkomst } from './opdracht.jsx';

// Productie → Printopdrachten (stap 6b): de wachtrij per printer. Volgorde
// met ↑/↓; de eerste open opdracht is het voorstel als de printer start.
// Bevestigen (aantal goede stuks) na een geslaagde run.
export default function Printopdrachten() {
  const [toon, setToon] = useState(() => onthoud('po-toon', 'open'));   // open | alle
  const { data, fout, laden, herlaad } = useData(`/productie/opdrachten${toon === 'open' ? '?open=1' : ''}`);
  const { melding } = useOmgeving();
  const [zoek, setZoek] = useState('');
  const [dialoog, setDialoog] = useState(null);   // { soort: 'nieuw' | 'open' | 'bevestig', o }
  const lijst = data?.lijst || [];
  // open opdrachten eerst (wachtrij), daarna de afgesloten (recentste eerst)
  const dicht = o => o.status === 'voltooid' || o.status === 'geannuleerd';
  const rijen = useMemo(() => lijst.filter(o => !zoek.trim()
    || `${o.naam} ${o.dossier_nummer || ''} ${o.dossier_titel || ''}`.toLowerCase().includes(zoek.trim().toLowerCase()))
    .sort((a, b) => (dicht(a) - dicht(b)) || (dicht(a) ? String(b.voltooid_op || b.geannuleerd_op).localeCompare(String(a.voltooid_op || a.geannuleerd_op)) : 0)), [lijst, zoek]);
  const printers = [...new Map(rijen.map(o => [o.printer_id, o.printer])).entries()];
  // positie binnen de open wachtrij van dezelfde printer (voor ↑/↓)
  const openPer = new Map();
  for (const o of lijst) if (!['voltooid', 'geannuleerd'].includes(o.status)) openPer.set(o.printer_id, [...(openPer.get(o.printer_id) || []), o.id]);
  async function schuif(e, o, richting) {
    e.stopPropagation();
    try { await api.post(`/productie/opdrachten/${o.id}/${richting}`); await herlaad(); } catch (x) { melding(x.message, 'fout'); }
  }
  const sluit = () => setDialoog(null);
  const klaar = async () => { setDialoog(null); await herlaad(); };
  const kolommen = [
    { kop: '#', klasse: 'num', cel: o => { const i = (openPer.get(o.printer_id) || []).indexOf(o.id); return i >= 0 ? i + 1 : ''; } },
    { kop: 'Opdracht', cel: o => <b>{o.naam}</b> },
    { kop: 'Voor', cel: o => <Herkomst o={o} /> },
    { kop: 'Stuks', klasse: 'r', cel: o => <span className="num">{o.status === 'voltooid' ? `${aantal(o.aantal_goed)} / ${aantal(o.aantal)}` : aantal(o.aantal)}</span> },
    { kop: 'Runs', klasse: 'r', cel: o => <span className="num">{o.runs.length || ''}</span> },
    { kop: 'Status', cel: o => <OpdrachtBadge status={o.status} /> },
    { kop: '', klasse: 'r', cel: o => {
      const rij = openPer.get(o.printer_id) || []; const i = rij.indexOf(o.id);
      return (
        <span className="rij-knoppen">
          {o.status === 'te_bevestigen' && <button type="button" className="btn klein primary" onClick={e => { e.stopPropagation(); setDialoog({ soort: 'bevestig', o }); }}>Bevestigen</button>}
          {i >= 0 && <>
            <button type="button" className="btn ghost klein" aria-label={`${o.naam} hoger`} disabled={i === 0} onClick={e => schuif(e, o, 'op')}><Icoon naam="pijlOp" maat={12} /></button>
            <button type="button" className="btn ghost klein" aria-label={`${o.naam} lager`} disabled={i === rij.length - 1} onClick={e => schuif(e, o, 'neer')}><Icoon naam="pijlNeer" maat={12} /></button>
          </>}
        </span>
      );
    } },
  ];
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Printopdrachten' }]} zoek={zoek} onZoek={setZoek}
        acties={<button type="button" className="btn primary" onClick={() => setDialoog({ soort: 'nieuw' })}><Icoon naam="plus" maat={14} /> Printopdracht</button>}
        filters={<>
          <Chip aan={toon === 'open'} onClick={() => { setToon('open'); bewaar('po-toon', 'open'); }}>Open</Chip>
          <Chip aan={toon === 'alle'} onClick={() => { setToon('alle'); bewaar('po-toon', 'alle'); }}>Ook afgesloten</Chip>
        </>}
        teller={data ? `${rijen.length}` : null} />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <Lijst kolommen={kolommen} sleutel={o => o.id} onOpen={o => setDialoog({ soort: 'open', o })}
          groepen={printers.map(([id, naam]) => ({ titel: naam, rijen: rijen.filter(o => o.printer_id === id) }))}
          kaart={o => ({ titel: o.naam, rechts: <OpdrachtBadge status={o.status} />, regel: `${o.printer}${o.dossier_nummer ? ` · ${o.dossier_nummer}` : ''}`, onder: `${aantal(o.aantal)} stuks` })}
          leeg={<><b>Geen {toon === 'open' ? 'open ' : ''}printopdrachten.</b>Plan een printopdracht vanuit een dossier (tabblad Productie) of maak een losse opdracht voor een eigen product.</>} />
      )}
      <p className="note" style={{ margin: '8px 16px' }}>Start je een print, dan stelt het ERP de eerste open opdracht van die printer voor. Koppelen doe je zelf op de printerkaart of onder Runs.</p>
      {dialoog?.soort === 'nieuw' && <OpdrachtDialoog onSluit={sluit} onKlaar={klaar} />}
      {dialoog?.soort === 'open' && <OpdrachtDialoog opdracht={dialoog.o} onSluit={sluit} onKlaar={klaar} />}
      {dialoog?.soort === 'bevestig' && <BevestigDialoog o={dialoog.o} onSluit={sluit} onKlaar={klaar} />}
    </>
  );
}
