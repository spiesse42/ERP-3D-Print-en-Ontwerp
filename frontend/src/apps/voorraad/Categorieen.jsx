import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Laden, Fout } from '../../schil/Weergaven.jsx';

// Vrije categorieën (boom), enkel om te ordenen en te filteren.
// Het gedrag van een artikel hangt af van het type en de vinkjes, niet van de categorie.
export default function Categorieen() {
  const { data, fout, laden, herlaad } = useData('/voorraad/categorieen');
  const { melding, bevestig } = useOmgeving();
  const [open, setOpen] = useState(null);          // null | 'nieuw' | categorie
  const [form, setForm] = useState({ naam: '', ouder_id: '' });
  const [bezig, setBezig] = useState(false);

  function openen(c) {
    setOpen(c);
    setForm(c === 'nieuw' ? { naam: '', ouder_id: '' } : { naam: c.naam, ouder_id: c.ouder_id == null ? '' : String(c.ouder_id) });
  }
  async function opslaan() {
    setBezig(true);
    try {
      if (open === 'nieuw') await api.post('/voorraad/categorieen', form);
      else await api.put(`/voorraad/categorieen/${open.id}`, form);
      await herlaad(); setOpen(null); melding('Categorie opgeslagen.');
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }
  async function verwijder() {
    if (!await bevestig({ titel: 'Categorie verwijderen', tekst: `"${open.pad}" verwijderen?`, bevestigLabel: 'Verwijderen', gevaarlijk: true })) return;
    try { await api.delete(`/voorraad/categorieen/${open.id}`); await herlaad(); setOpen(null); melding('Categorie verwijderd.'); }
    catch (e) { melding(e.message, 'fout'); }
  }

  // Een categorie kan niet onder zichzelf of een eigen subcategorie komen.
  const mogelijkeOuders = (data || []).filter(c => open === 'nieuw' || !open || (c.id !== open.id && !c.pad.startsWith(`${open.pad} / `)));

  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Categorieën' }]} rechts={<button type="button" className="btn primary" onClick={() => openen('nieuw')}>Nieuw</button>} />
      <div className="page">
        {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
          <div className="panel">
            <div className="pbody">
              {data.length === 0 ? <div className="leeg"><b>Nog geen categorieën.</b></div> : (
                <div className="tabelvak">
                  <table className="mini">
                    <thead><tr><th>Categorie</th><th className="r">Artikelen</th></tr></thead>
                    <tbody>
                      {data.map(c => (
                        <tr key={c.id} className="clk" tabIndex={0} onClick={() => openen(c)} onKeyDown={e => { if (e.key === 'Enter') openen(c); }}>
                          <td>{c.pad.split(' / ').map((d, i, a) => <span key={i} className={i < a.length - 1 ? 'sub' : ''}>{d}{i < a.length - 1 ? ' / ' : ''}</span>)}</td>
                          <td className="r num">{c.artikelen || <span className="sub">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="note" style={{ marginBottom: 0 }}>Categorieën dienen om te ordenen, te groeperen en te filteren. Wat een artikel doet (voorraad, kopen, verkopen, zelf printen), hangt af van het type en de vinkjes op het artikel.</p>
            </div>
          </div>
        )}
      </div>
      {open && (
        <Dialoog titel={open === 'nieuw' ? 'Nieuwe categorie' : open.pad} onSluit={() => setOpen(null)}
          voet={<>
            {open !== 'nieuw' && <button type="button" className="btn ghost" style={{ marginRight: 'auto' }} onClick={verwijder}>Verwijderen</button>}
            <button type="button" className="btn" onClick={() => setOpen(null)}>Annuleren</button>
            <button type="button" className="btn primary" disabled={bezig || !form.naam.trim()} onClick={opslaan}>Opslaan</button>
          </>}>
          <div className="fgrid">
            <div><label htmlFor="c-naam">Naam</label><input id="c-naam" className="inp" autoFocus value={form.naam} onChange={e => setForm(f => ({ ...f, naam: e.target.value }))} /></div>
            <div>
              <label htmlFor="c-ouder">Valt onder</label>
              <select id="c-ouder" className="inp" value={form.ouder_id} onChange={e => setForm(f => ({ ...f, ouder_id: e.target.value }))}>
                <option value="">— (hoofdcategorie)</option>
                {mogelijkeOuders.map(c => <option key={c.id} value={c.id}>{c.pad}</option>)}
              </select>
            </div>
          </div>
        </Dialoog>
      )}
    </>
  );
}
