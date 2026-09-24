import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { aantal, datumTijd } from '../../lib/formaat.js';

// Rol leegmelden bij een printer (stap 6c): −1 rol van dat filament, van de
// oudste partij (FIFO). Voorstel = het filament van de print die nu loopt
// (of de laatste). Een vergissing maak je hier meteen ongedaan.
export default function RolLeegDialoog({ printer, onSluit }) {
  const { melding } = useOmgeving();
  const { data, herlaad } = useData(`/productie/printers/${printer.id}/filament`);
  const [keuze, setKeuze] = useState('');
  const [bezig, setBezig] = useState(false);
  const gekozen = keuze || (data?.voorstel.length === 1 ? String(data.voorstel[0].id) : '');
  async function leeg() {
    setBezig(true);
    try {
      const u = await api.post(`/productie/printers/${printer.id}/rol-leeg`, { artikel_id: Number(gekozen) });
      melding(`Rol ${u.filament} leeggemeld; nog ${aantal(u.voorraad)} in voorraad.`);
      setKeuze(''); await herlaad();
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function ongedaan(id) {
    try { await api.post(`/productie/rol-leeg/${id}/ongedaan`); melding('Leegmelding ongedaan gemaakt.'); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
  }
  const optie = f => <option key={f.id} value={f.id}>{f.naam} · {aantal(f.voorraad)} in voorraad</option>;
  return (
    <Dialoog titel={`Rol leeg · ${printer.naam}`} onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Sluiten</button>
        <button type="button" className="btn primary" disabled={bezig || !gekozen} onClick={leeg}>Rol leegmelden</button></>}>
      <label className="lbl" htmlFor="rl-fil">Welk filament is op?</label>
      <select id="rl-fil" className="inp" value={gekozen} onChange={e => setKeuze(e.target.value)}>
        <option value="">— kies —</option>
        {data?.voorstel.length > 0 && <optgroup label="Van de huidige/laatste print">{data.voorstel.map(optie)}</optgroup>}
        {data?.filament.length > 0 && <optgroup label="Ander filament in voorraad">{data.filament.map(optie)}</optgroup>}
      </select>
      <p className="note">Er gaat 1 rol af van de oudste partij (FIFO). Staat het filament er niet bij, dan is er geen rol van in voorraad.</p>
      {data?.recent.length > 0 && (
        <div className="tabelvak">
          <table className="mini">
            <thead><tr><th>Laatst leeggemeld</th><th /><th /></tr></thead>
            <tbody>
              {data.recent.map(r => (
                <tr key={r.id}>
                  <td>{r.filament}</td>
                  <td className="num sub">{datumTijd(r.tijdstip.includes('T') ? r.tijdstip : `${r.tijdstip.replace(' ', 'T')}Z`)}</td>
                  <td className="r">{r.ongedaan ? <span className="sub">ongedaan</span>
                    : <button type="button" className="btn ghost klein" onClick={() => ongedaan(r.id)}>Ongedaan</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialoog>
  );
}
