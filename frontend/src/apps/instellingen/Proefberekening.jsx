import { useMemo, useState } from 'react';
import { useData } from '../../schil/useData.js';
import { Fout } from '../../schil/Weergaven.jsx';
import Icoon from '../../schil/Icoon.jsx';
import RegelEditor, { Totalen, nieuweRegel, useBerekening, TYPES } from '../../components/RegelEditor.jsx';

// Proefberekening (stap 4): de rekenmotor uitproberen zonder iets te bewaren,
// bv. om een offerte uit het oude pakket na te rekenen. In stap 5 wordt
// dezelfde regeleditor gebruikt in de dossiers.
export default function Proefberekening() {
  const [regels, setRegels] = useState(() => [nieuweRegel('printen')]);
  const { data: printers } = useData('/printers?actief=1');
  const { data: artikelen, herlaad: herlaadArtikelen } = useData('/voorraad/artikelen');
  const { data: prijsgroepen } = useData('/filament/types');
  const { data: tarievenLijst } = useData('/tarieven');
  const tarieven = useMemo(() => Object.fromEntries((tarievenLijst || []).map(t => [t.sleutel, t.waarde])), [tarievenLijst]);
  const { uitkomst, fout } = useBerekening(regels);

  return (
    <div className="panel">
      <h3>Proefberekening <span className="sub" style={{ fontWeight: 400 }}>niets wordt bewaard</span></h3>
      <div className="pbody">
        <RegelEditor regels={regels} onWijzig={setRegels} uitkomst={uitkomst} tarieven={tarieven} printers={printers}
          filamenten={(artikelen || []).filter(a => a.type === 'filament')} prijsgroepen={prijsgroepen}
          artikelen={(artikelen || []).filter(a => a.type !== 'filament' && a.wordt_verkocht)}
          herkomst="proefberekening" onArtikelGemaakt={herlaadArtikelen} />
        <div className="toevoegen">
          {TYPES.map(([w, l]) => <button key={w} type="button" className="btn" onClick={() => setRegels(r => [...r, nieuweRegel(w)])}><Icoon naam="plus" maat={14} /> {l}</button>)}
        </div>
        {fout && <Fout tekst={fout} />}
        <Totalen uitkomst={uitkomst} />
        <p className="note" style={{ marginBottom: 0 }}>Tijd en gewicht zijn die van de hele print (zoals de slicer ze toont), ook als er meerdere stuks op de plaat staan. Het aantal stuks dient enkel voor de prijs per stuk.</p>
      </div>
    </div>
  );
}
