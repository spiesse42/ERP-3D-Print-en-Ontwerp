import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { euro, aantal } from '../../lib/formaat.js';

// Onderdelen per stuk (06-10): wat er bij elk verkocht stuk mee de deur uit
// gaat (sleutelring, zakje, label…). Afgeboekt bij de verkoop.
export default function Onderdelen({ id }) {
  const { melding } = useOmgeving();
  const { data, herlaad } = useData(`/producten/${id}/onderdelen`);
  const { data: artikelen } = useData('/voorraad/artikelen');
  const [rijen, setRijen] = useState([]);
  const [bezig, setBezig] = useState(false);
  const vanData = d => d.map(o => ({ onderdeel_id: String(o.onderdeel_id), aantal: String(o.aantal).replace('.', ',') }));
  useEffect(() => { if (data) setRijen(vanData(data)); }, [data]);
  const vuil = data && JSON.stringify(rijen) !== JSON.stringify(vanData(data));
  const keuzes = (artikelen || []).filter(a => a.type === 'artikel' && String(a.id) !== String(id));
  const zet = (i, w) => setRijen(l => l.map((r, j) => (j === i ? { ...r, ...w } : r)));
  async function bewaar() {
    setBezig(true);
    try { await api.put(`/producten/${id}/onderdelen`, { onderdelen: rijen.filter(r => r.onderdeel_id) }); await herlaad(); melding('Onderdelen bewaard.'); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  if (!data) return null;
  const totaal = data.reduce((s, o) => s + (o.prijs ?? 0) * o.aantal, 0);
  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>Wat er <b>per verkocht stuk</b> bij hoort, bv. een sleutelring of een zakje. Bij een verkoop worden die mee uit voorraad geboekt (en bij "ongedaan maken" teruggezet); ze tellen mee in de kost per stuk. Is er te weinig, dan krijg je een melding — de verkoop gaat wel door.</p>
      {rijen.map((r, i) => {
        const o = data.find(x => String(x.onderdeel_id) === r.onderdeel_id);
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <select className="inp" aria-label={`Onderdeel ${i + 1}`} value={r.onderdeel_id} onChange={e => zet(i, { onderdeel_id: e.target.value })}>
              <option value="">Kies een artikel…</option>
              {keuzes.map(a => <option key={a.id} value={a.id}>{a.weergave}</option>)}
            </select>
            <span className="unit" style={{ maxWidth: 120 }}><input className="inp num" inputMode="decimal" aria-label={`Aantal per stuk, onderdeel ${i + 1}`} value={r.aantal} onChange={e => zet(i, { aantal: e.target.value })} /><span>/stuk</span></span>
            {o && <span className="sub" style={{ whiteSpace: 'nowrap' }}>voorraad {aantal(o.voorraad)}{o.prijs != null ? ` · ${euro(o.prijs)}` : ' · geen prijs'}</span>}
            <button type="button" className="btn ghost" aria-label={`Onderdeel ${i + 1} weghalen`} onClick={() => setRijen(l => l.filter((_, j) => j !== i))}><Icoon naam="kruis" maat={12} /></button>
          </div>
        );
      })}
      <button type="button" className="linkish" onClick={() => setRijen(l => [...l, { onderdeel_id: '', aantal: '1' }])}>+ onderdeel</button>
      {data.length > 0 && <p className="sub">Onderdelen samen: {euro(Math.round(totaal * 10000) / 10000)} per stuk.</p>}
      <div className="tabacties" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={bezig || !vuil} onClick={bewaar}>Onderdelen bewaren</button>
      </div>
    </>
  );
}
