import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { Dialoog } from '../../schil/Omgeving.jsx';
import { euro } from '../../lib/formaat.js';

// Meerdere artikels in één keer naar de webshop (11-10), bv. een hele
// categorie. Wat per artikel nog leeg is, krijgt de categorie en de
// standaardbeschrijving hieronder; nieuwe producten komen verborgen online.
// Geen foto: die kies je per artikel (tab Webshop) of zet je later in Sanity.
export default function WebshopBulk({ artikelen, onSluit, onKlaar }) {
  const { data: k } = useData('/producten/webshop/keuzes');
  const kandidaten = artikelen.filter(a => a.type === 'artikel' && a.wordt_verkocht && !a.webshop_variant);
  const [mee, setMee] = useState(() => Object.fromEntries(kandidaten.map(a => [a.id, !a.webshop_slug])));
  const [cat, setCat] = useState('');
  const [tekst, setTekst] = useState('');
  const [uitslag, setUitslag] = useState({});
  const [bezig, setBezig] = useState(false);
  const gekozen = kandidaten.filter(a => mee[a.id]);

  async function start() {
    setBezig(true);
    for (const a of gekozen) {
      setUitslag(u => ({ ...u, [a.id]: 'bezig…' }));
      try {
        const w = await api.get(`/producten/${a.id}/webshop`);
        if (w.bron !== 'erp' || !w.data.category_id || !w.data.description) {
          await api.put(`/producten/${a.id}/webshop`, { ...w.data, category_id: w.data.category_id || cat, description: w.data.description || tekst });
        }
        const r = await api.post(`/producten/${a.id}/webshop/push`, {});
        setUitslag(u => ({ ...u, [a.id]: `${r.nieuw ? 'aangemaakt' : 'bijgewerkt'}${r.verborgen ? ' (verborgen)' : ''}` }));
      } catch (e) { setUitslag(u => ({ ...u, [a.id]: `fout: ${e.message}` })); }
    }
    setBezig(false);
    onKlaar?.();
  }

  return (
    <Dialoog titel="Naar de webshop" breed onSluit={bezig ? () => {} : onSluit}
      voet={<>
        <button type="button" className="btn" disabled={bezig} onClick={onSluit}>Sluiten</button>
        <button type="button" className="btn primary" disabled={bezig || !gekozen.length} onClick={start}>{bezig ? 'Bezig…' : `${gekozen.length} naar de webshop`}</button>
      </>}>
      <p className="note" style={{ marginTop: 0 }}>De artikels uit de huidige lijst (filter/zoekterm) die verkocht worden. Naam en prijs komen van het artikel. Nieuwe producten komen <b>verborgen</b> online: kijk ze na, voeg je eigen foto toe (tab Webshop) en zet "Verborgen" uit. Wat al in de webshop staat, wordt bijgewerkt.</p>
      {k && !k.token && <p className="regelfout">Er is nog geen Sanity-token ingesteld (add-on-instellingen): pushen lukt nog niet.</p>}
      <div className="fgrid">
        <div><label htmlFor="wb-cat">Categorie, voor wie er nog geen heeft</label>
          <select id="wb-cat" className="inp" value={cat} onChange={e => setCat(e.target.value)}>
            <option value="">Kies…</option>
            {(k?.categorieen || []).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select></div>
      </div>
      <label htmlFor="wb-tekst" style={{ display: 'block', marginTop: 8 }}>Standaardbeschrijving, voor wie er nog geen heeft</label>
      <textarea id="wb-tekst" className="inp" rows={3} value={tekst} onChange={e => setTekst(e.target.value)} placeholder="bv. 3D-geprint in PLA, met een led-theelichtje. Ontwerp: Layer And Leaf." />
      <div className="tabelvak" style={{ maxHeight: 340, overflow: 'auto', marginTop: 10 }}>
        <table className="mini">
          <thead><tr><th /><th>Artikel</th><th className="r">Prijs</th><th>Webshop</th><th>Resultaat</th></tr></thead>
          <tbody>{kandidaten.map(a => (
            <tr key={a.id}>
              <td><input type="checkbox" aria-label={`${a.weergave} meenemen`} disabled={bezig} checked={!!mee[a.id]} onChange={e => setMee(m => ({ ...m, [a.id]: e.target.checked }))} /></td>
              <td>{a.weergave}</td>
              <td className="r num">{a.verkoopprijs != null ? euro(a.verkoopprijs) : <span className="regelfout" style={{ display: 'inline' }}>geen</span>}</td>
              <td>{a.webshop_slug ? 'gekoppeld' : <span className="sub">nieuw</span>}</td>
              <td className="sub">{uitslag[a.id] || ''}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </Dialoog>
  );
}
