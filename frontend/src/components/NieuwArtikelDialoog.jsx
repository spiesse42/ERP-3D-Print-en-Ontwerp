import { useState } from 'react';
import { api } from '../lib/api.js';
import { useData } from '../schil/useData.js';
import { useOmgeving, Dialoog } from '../schil/Omgeving.jsx';
import KeuzeMetToevoegen from './KeuzeMetToevoegen.jsx';

// Snel een verkoopbaar artikel of dienst aanmaken vanuit een regel (stap 4b).
// Gaat via dezelfde route als het artikelformulier (zelfde controles) en
// komt dus meteen in Voorraad → Artikelen. Aanvullen (leverancier, min/max,
// productcode …) gebeurt later daar.
const SOORTEN = [
  ['dienst', 'Dienst', 'bv. verzending, montage'],
  ['gekocht', 'Gekocht artikel', 'bv. sleutelring, magneet'],
  ['zelf', 'Zelf geprint product', 'eigen product met vaste prijs'],
];

export default function NieuwArtikelDialoog({ herkomst, onSluit, onGemaakt }) {
  const { melding } = useOmgeving();
  const { data: categorieen, herlaad } = useData('/voorraad/categorieen');
  const [f, setF] = useState({ naam: '', soort: 'dienst', verkoopprijs: '', vaste_prijs: false, categorie_id: '' });
  const [bezig, setBezig] = useState(false);
  const zet = (k, w) => setF(x => ({ ...x, [k]: w }));

  async function opslaan() {
    setBezig(true);
    try {
      const { id } = await api.post('/voorraad/artikelen', {
        type: f.soort === 'dienst' ? 'dienst' : 'artikel',
        naam: f.naam, wordt_verkocht: true,
        wordt_gekocht: f.soort === 'gekocht', zelf_geprint: f.soort === 'zelf',
        verkoopprijs: f.verkoopprijs, vaste_prijs: f.vaste_prijs,
        categorie_id: f.categorie_id || null, herkomst,
      });
      melding(`${f.naam.trim()} toegevoegd aan de artikelen.`);
      await onGemaakt(id);
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  async function nieuweCategorie(naam) { const c = await api.post('/voorraad/categorieen', { naam }); await herlaad(); return c; }

  return (
    <Dialoog titel="Nieuw artikel of dienst" onSluit={onSluit}
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !f.naam.trim() || String(f.verkoopprijs).trim() === ''} onClick={opslaan}>Opslaan en kiezen</button>
      </>}>
      <div className="fgrid">
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="na-naam">Naam</label><input id="na-naam" className="inp" value={f.naam} onChange={e => zet('naam', e.target.value)} placeholder="bv. Verzending bpost" autoFocus /></div>
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="na-soort">Soort</label>
          <select id="na-soort" className="inp" value={f.soort} onChange={e => zet('soort', e.target.value)}>
            {SOORTEN.map(([w, l, v]) => <option key={w} value={w}>{l} ({v})</option>)}
          </select></div>
        <div><label htmlFor="na-prijs">Verkoopprijs</label><div className="unit"><input id="na-prijs" className="inp num" inputMode="decimal" value={f.verkoopprijs} onChange={e => zet('verkoopprijs', e.target.value)} placeholder="bv. 4,50" /><span>€</span></div></div>
        <div><label htmlFor="na-cat">Categorie (optioneel)</label>
          <KeuzeMetToevoegen id="na-cat" ariaLabel="Categorie" waarde={f.categorie_id} leegLabel="Geen categorie"
            opties={(categorieen || []).map(c => ({ id: c.id, naam: c.pad }))} onKies={w => zet('categorie_id', w)} onNieuw={nieuweCategorie} watLabel="categorie" /></div>
        <div className="vinkjes" style={{ gridColumn: '1/-1', marginTop: 0 }}><label className="vinkje"><input type="checkbox" checked={f.vaste_prijs} onChange={e => zet('vaste_prijs', e.target.checked)} /> Vaste prijs: geen marge, buiten de btw-grondslag (bv. verzending)</label></div>
      </div>
      <p className="note" style={{ marginBottom: 0 }}>Leverancier, productcode, voorraad en dergelijke vul je later aan in Voorraad → Artikelen.</p>
    </Dialoog>
  );
}
