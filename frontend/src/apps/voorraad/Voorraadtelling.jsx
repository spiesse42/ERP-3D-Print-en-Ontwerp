import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Laden, Fout } from '../../schil/Weergaven.jsx';
import { aantal, uitInvoer } from '../../lib/formaat.js';
import { ArtikelNaam } from './ArtikelenLijst.jsx';
import { eenheid } from './artikel.js';

// Voorraadtelling (Odoo: "Physical Inventory"): tel wat er ligt, vul het
// getelde aantal in, en boek alle verschillen in één keer als correctie.
// Leeg laten = niet geteld = niets veranderen.
export default function Voorraadtelling() {
  const { melding, bevestig, zetVuil } = useOmgeving();
  const { data, fout, laden, herlaad } = useData('/voorraad/artikelen');
  const [geteld, setGeteld] = useState({});      // artikel_id → tekst
  const [zoek, setZoek] = useState('');
  const [type, setType] = useState(null);
  const [enkelVerschil, setEnkelVerschil] = useState(false);
  const [bezig, setBezig] = useState(false);

  const artikelen = useMemo(() => (data || []).filter(a => a.type !== 'dienst'), [data]);
  const verschil = a => { const g = uitInvoer(geteld[a.id]); return g === null || Number.isNaN(g) ? null : Math.round((g - a.voorraad) * 1e4) / 1e4; };
  const ongeldig = artikelen.filter(a => { const g = uitInvoer(geteld[a.id]); return Number.isNaN(g) || (g !== null && g < 0); });
  const teBoeken = artikelen.filter(a => { const v = verschil(a); return v !== null && v !== 0 && !ongeldig.includes(a); });
  const ingevuld = Object.values(geteld).some(v => String(v).trim() !== '');
  useEffect(() => { zetVuil(ingevuld); return () => zetVuil(false); }, [ingevuld, zetVuil]);

  const zichtbaar = artikelen.filter(a => {
    const q = zoek.trim().toLowerCase();
    return (!type || a.type === type) && (!enkelVerschil || teBoeken.includes(a))
      && (!q || [a.weergave, a.categorie, a.locatie].some(v => String(v || '').toLowerCase().includes(q)));
  });

  async function verwerk() {
    if (ongeldig.length) { melding('Vul geldige aantallen in (getal ≥ 0) of laat het veld leeg.', 'fout'); return; }
    if (!await bevestig({
      titel: 'Telling verwerken',
      tekst: `${teBoeken.length} artikel(en) krijgen een correctie naar het getelde aantal. Dit komt in de mutaties en in de historiek van elk artikel.`,
      bevestigLabel: 'Verwerken',
    })) return;
    setBezig(true);
    try {
      const r = await api.post('/voorraad/telling', { regels: teBoeken.map(a => ({ artikel_id: a.id, geteld: uitInvoer(geteld[a.id]) })) });
      setGeteld({}); zetVuil(false);
      await herlaad();
      melding(`Telling verwerkt: ${r.aangepast.length} artikel(en) aangepast.`);
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  const facetten = [];
  if (type) facetten.push({ label: type === 'filament' ? 'Filament' : 'Artikelen', onWeg: () => setType(null) });
  if (enkelVerschil) facetten.push({ label: 'Met verschil', onWeg: () => setEnkelVerschil(false) });

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Voorraadtelling' }]}
        zoek={zoek} onZoek={setZoek} facetten={facetten}
        acties={<>
          <button type="button" className="btn primary" disabled={bezig || !teBoeken.length} onClick={verwerk}>Telling verwerken{teBoeken.length ? ` (${teBoeken.length})` : ''}</button>
          {ingevuld && <button type="button" className="btn" disabled={bezig} onClick={() => setGeteld({})}>Wissen</button>}
        </>}
        filters={<>
          <Chip aan={type === 'filament'} onClick={() => setType(x => (x === 'filament' ? null : 'filament'))}>Filament</Chip>
          <Chip aan={type === 'artikel'} onClick={() => setType(x => (x === 'artikel' ? null : 'artikel'))}>Artikelen</Chip>
          <Chip aan={enkelVerschil} onClick={() => setEnkelVerschil(x => !x)}>Met verschil</Chip>
        </>}
        teller={data ? `${zichtbaar.length} / ${artikelen.length}` : null}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : artikelen.length === 0 ? (
        <div className="leeg"><b>Nog geen artikelen met voorraad.</b>Maak eerst artikelen aan onder Artikelen.</div>
      ) : (
        <div className="page">
          <div className="panel telling">
            <div className="trij kop" aria-hidden="true"><span>Artikel</span><span className="r">Systeem</span><span className="r">Geteld</span><span className="r">Verschil</span></div>
            {zichtbaar.map(a => {
              const v = verschil(a);
              const fout2 = ongeldig.includes(a);
              return (
                <div className="trij" key={a.id}>
                  <span className="art"><ArtikelNaam a={a} /><span className="sub">{[a.categorie, a.locatie].filter(Boolean).join(' · ') || ' '}</span></span>
                  <span className="r num sys">{aantal(a.voorraad)} <span className="sub">{eenheid(a.voorraad, a.eenheid)}</span></span>
                  <span className="r">
                    <label className="sr-only" htmlFor={`t-${a.id}`}>Geteld: {a.weergave}</label>
                    <input id={`t-${a.id}`} className={`inp num${fout2 ? ' fout' : ''}`} inputMode="decimal" placeholder="—"
                      value={geteld[a.id] ?? ''} onChange={e => setGeteld(g => ({ ...g, [a.id]: e.target.value }))} />
                  </span>
                  <span className={`r num vs ${v > 0 ? 'plus' : v < 0 ? 'min' : ''}`}>{v === null || fout2 ? '' : v === 0 ? '✓' : `${v > 0 ? '+' : '−'}${aantal(Math.abs(v))}`}</span>
                </div>
              );
            })}
            {zichtbaar.length === 0 && <div className="leeg">Niets gevonden.</div>}
          </div>
          <p className="note" style={{ margin: 0 }}>Leeg laten = niet geteld, er verandert niets. Meer dan het systeem: er komt een partij bij aan de laatst gekende prijs. Minder: er gaat af van de oudste partij (FIFO).</p>
        </div>
      )}
    </>
  );
}
