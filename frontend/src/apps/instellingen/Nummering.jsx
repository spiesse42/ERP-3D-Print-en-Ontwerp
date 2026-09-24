import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { Laden, Fout } from '../../schil/Weergaven.jsx';

// Nummering (stap 5a): per reeks het volgende nummer van dit jaar. Handig bij
// de overschakeling: verder tellen waar het oude pakket stopte. Nooit lager
// dan een nummer dat al bestaat. Facturen en bonnetjes nummert Accountable.
export default function Nummering() {
  const { data, fout, laden, setData } = useData('/nummering');
  const { melding } = useOmgeving();
  const [invoer, setInvoer] = useState({});
  if (fout) return <Fout tekst={fout} />;
  if (!data && laden) return <Laden />;

  async function bewaar(r) {
    try {
      const n = await api.put(`/nummering/${r.reeks}`, { volgend: Number(String(invoer[r.reeks]).trim()) });
      setData(n); setInvoer(i => ({ ...i, [r.reeks]: undefined }));
      melding(`${r.naam}: volgende nummer ${n.find(x => x.reeks === r.reeks).voorbeeld}.`);
    } catch (e) { melding(e.message, 'fout'); }
  }
  return (
    <div className="panel">
      <h3>Nummering</h3>
      <div className="pbody">
        <div className="tabelvak">
          <table className="mini">
            <thead><tr><th>Reeks</th><th>Volgende nummer ({data[0]?.jaar})</th><th>Wordt</th><th><span className="sr-only">Bewaren</span></th></tr></thead>
            <tbody>
              {data.map(r => {
                const w = invoer[r.reeks] ?? String(r.volgend);
                const gewijzigd = invoer[r.reeks] !== undefined && w !== String(r.volgend);
                return (
                  <tr key={r.reeks}>
                    <td><b>{r.naam}</b> <span className="sub mono">{r.reeks}</span></td>
                    <td><input className="inp num" style={{ maxWidth: 110 }} inputMode="numeric" aria-label={`Volgende nummer ${r.naam}`} value={w}
                      onChange={e => setInvoer(i => ({ ...i, [r.reeks]: e.target.value }))} />
                      {r.minimum > 1 && <div className="sub">minstens {r.minimum}</div>}</td>
                    <td className="mono">{r.voorbeeld}</td>
                    <td>{gewijzigd && <button type="button" className="btn primary" onClick={() => bewaar(r)}>Bewaren</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>Elk jaar begint elke reeks opnieuw bij 1. Bij de overschakeling vul je hier in waar het oude pakket gebleven is (bv. offerte 43 → volgende nummer 44). Facturen en bonnetjes nummert Accountable, niet het ERP.</p>
      </div>
    </div>
  );
}
