import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { aantal as fmtAantal } from '../../lib/formaat.js';

// Letterbestelling (29-10), bv. bubble letters: plak de lijst zoals je ze
// krijgt (per naam of per kleur). Eerst lezen → controle (letters per
// kleur, filament per kleur), daarna toevoegen: per letter × kleur een
// printregel uit het letterprofiel van het product.
const VOORBEELD = `JULIETTE
J – Perzikkleur
U – Lichtroze
…

of per kleur:
Cherry TTEGLLSLKB 10
Oat: A N S`;

export default function LettersDialoog({ dossierId, producten, filamenten, vuil, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const [artikel, setArtikel] = useState(producten[0] ? String(producten[0].id) : '');
  const [tekst, setTekst] = useState('');
  const [v, setV] = useState(null);
  const [kleuren, setKleuren] = useState({});
  const [bezig, setBezig] = useState(false);
  async function lees() {
    setBezig(true);
    try {
      const r = await api.post('/dossiers/letters/voorbeeld', { tekst, artikel_id: artikel });
      setV(r);
      setKleuren(Object.fromEntries(r.kleuren.map(k => [k.label, k.filament_id ? String(k.filament_id) : ''])));
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function voegToe() {
    setBezig(true);
    try {
      const r = await api.post(`/dossiers/${dossierId}/letters`, { tekst, artikel_id: artikel, kleuren });
      melding(`${r.letters} letters toegevoegd (${r.regels} printregels).`);
      await onKlaar();
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  const perKleur = v ? [...new Set(v.items.map(i => i.kleur))].map(k => ({ kleur: k, items: v.items.filter(i => i.kleur === k) })) : [];
  const kan = v && v.items.length && !v.zonder_plaat.length && v.kleuren.every(k => kleuren[k.label]);
  return (
    <Dialoog titel="Letters toevoegen" breed onSluit={onSluit}
      voet={<>
        <button type="button" className="btn" onClick={v ? () => setV(null) : onSluit}>{v ? 'Lijst aanpassen' : 'Annuleren'}</button>
        {v ? <button type="button" className="btn primary" disabled={bezig || !kan || vuil} title={vuil ? 'Bewaar eerst het dossier' : undefined} onClick={voegToe}>{v.totaal} letters toevoegen</button>
          : <button type="button" className="btn primary" disabled={bezig || !tekst.trim() || !artikel} onClick={lees}>Lijst lezen</button>}
      </>}>
      {vuil && <p className="regelfout" style={{ marginTop: 0 }}>Het dossier heeft niet-bewaarde wijzigingen. Bewaar eerst, dan kun je de letters toevoegen.</p>}
      {!v ? <>
        {producten.length > 1 && <label className="lbl">Product
          <select className="inp" value={artikel} onChange={e => setArtikel(e.target.value)}>
            {producten.map(a => <option key={a.id} value={a.id}>{a.naam} ({a.letters.length} letters)</option>)}
          </select></label>}
        <label className="lbl" htmlFor="lt-tekst">Plak de lijst zoals je ze kreeg: per naam (naam, dan "letter – kleur", of "NAAM: kleur") of per kleur ("Kleur LETTERS aantal").</label>
        <textarea id="lt-tekst" className="inp mono" rows={14} placeholder={VOORBEELD} value={tekst} onChange={e => setTekst(e.target.value)} />
        <p className="note" style={{ marginBottom: 0 }}>Afvinktekens (v, ✓, ok) mogen blijven staan. Accenten (É, Ë…) blijven behouden: daarvoor moet er een plaat in het letterprofiel zijn.</p>
      </> : <>
        <p style={{ marginTop: 0 }}><b>{v.totaal} letters</b> · {v.bron === 'naam' ? `${v.namen?.length ?? 0} namen` : 'per kleur'} · {v.kleuren.length} kleuren · product {v.product}</p>
        {v.waarschuwingen.map((w, i) => <p key={i} className="regelfout" style={{ margin: '0 0 4px' }}>{w}</p>)}
        {v.zonder_plaat.length > 0 && <p className="regelfout">Geen plaat in het letterprofiel voor: <b>{v.zonder_plaat.join(' ')}</b>. Vul het profiel aan (artikel → Printprofiel) of pas de lijst aan.</p>}
        <div className="tabelvak" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table className="mini">
            <thead><tr><th>Kleur</th><th>Letters</th><th className="r">Aantal</th><th>Filament</th></tr></thead>
            <tbody>{perKleur.map(({ kleur, items }) => {
              const k = v.kleuren.find(x => x.label === kleur);
              return (
                <tr key={kleur}>
                  <td><b>{kleur}</b></td>
                  <td className="mono">{items.map(i => <span key={i.letter} style={i.plaat ? undefined : { color: 'var(--crit)' }}>{i.letter}{i.aantal > 1 ? `×${i.aantal}` : ''} </span>)}</td>
                  <td className="r num">{fmtAantal(items.reduce((t, i) => t + i.aantal, 0))}</td>
                  <td>
                    <select className={`inp${kleuren[kleur] ? '' : ' let-op'}`} aria-label={`Filament voor ${kleur}`} value={kleuren[kleur] || ''} onChange={e => setKleuren(x => ({ ...x, [kleur]: e.target.value }))}>
                      <option value="">— kies het filament —</option>
                      {filamenten.map(a => <option key={a.id} value={a.id}>{a.weergave}</option>)}
                    </select>
                    {k?.bron && kleuren[kleur] === String(k.filament_id) && <div className="sub">{k.bron === 'webshop' ? 'uit het kleurenpalet van de webshop' : 'zoals de vorige keer'}</div>}
                    {!k?.filament_id && k?.webshop && <div className="sub">webshop: {k.webshop} (niet gevonden in Voorraad)</div>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>Per letter × kleur komt er een printregel met de eigen plaat van die letter. Wil je meerdere letters van dezelfde kleur samen op één plaat printen: na het starten in het tabblad Productie aanvinken → "Op één plaat zetten". Je keuze van filament per kleur wordt onthouden.</p>
      </>}
    </Dialoog>
  );
}
