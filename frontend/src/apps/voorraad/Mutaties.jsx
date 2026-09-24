import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, aantal, datumTijd } from '../../lib/formaat.js';
import { ArtikelNaam } from './ArtikelenLijst.jsx';

export const REDEN_LABEL = { ontvangst: 'Ontvangst', productie: 'Productie', gebruik: 'Gebruik', levering: 'Levering', correctie: 'Correctie' };

// Logboek van elke voorraadbeweging (nieuwste eerst). ?artikel=ID filtert op één artikel.
export default function Mutaties() {
  const { navigeer } = useOmgeving();
  const [params, setParams] = useSearchParams();
  const artikelId = params.get('artikel');
  const [zoek, setZoek] = useState('');
  const [reden, setReden] = useState(null);
  const { data, fout, laden } = useData(`/voorraad/mutaties?limiet=1000${artikelId ? `&artikel_id=${encodeURIComponent(artikelId)}` : ''}`);

  const rijen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    return data.filter(m => (!reden || m.reden === reden) && (!q || [m.weergave, m.notitie].some(v => String(v || '').toLowerCase().includes(q))));
  }, [data, zoek, reden]);

  const kolommen = [
    { kop: 'Tijdstip', cel: m => <span className="num">{datumTijd(m.tijdstip)}</span> },
    { kop: 'Artikel', cel: m => <ArtikelNaam a={m} /> },
    { kop: 'Reden', cel: m => REDEN_LABEL[m.reden] || m.reden },
    { kop: 'Aantal', klasse: 'r num', cel: m => <b className={m.aantal > 0 ? 'plus' : 'min'}>{m.aantal > 0 ? '+' : '−'}{aantal(Math.abs(m.aantal))}</b> },
    { kop: 'Prijs/eenheid', klasse: 'r num', cel: m => euro(m.prijs_per_eenheid) },
    { kop: 'Notitie', cel: m => m.notitie || <span className="sub">—</span> },
  ];
  const facetten = [];
  if (artikelId && data?.[0]) facetten.push({ label: data[0].weergave, onWeg: () => setParams({}) });
  else if (artikelId) facetten.push({ label: `Artikel ${artikelId}`, onWeg: () => setParams({}) });
  if (reden) facetten.push({ label: REDEN_LABEL[reden], onWeg: () => setReden(null) });

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Mutaties' }]}
        zoek={zoek} onZoek={setZoek} facetten={facetten}
        filters={Object.entries(REDEN_LABEL).map(([r, l]) => <Chip key={r} aan={reden === r} onClick={() => setReden(x => (x === r ? null : r))}>{l}</Chip>)}
        teller={data ? `${rijen.length} / ${data.length}` : null}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : (
        <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={m => m.id} onOpen={m => navigeer(`/voorraad/artikelen/${m.artikel_id}`)}
          kaart={m => ({
            titel: <ArtikelNaam a={m} />,
            rechts: <b className={`num ${m.aantal > 0 ? 'plus' : 'min'}`}>{m.aantal > 0 ? '+' : '−'}{aantal(Math.abs(m.aantal))}</b>,
            regel: m.notitie, onder: `${REDEN_LABEL[m.reden]} · ${datumTijd(m.tijdstip)}`, badge: null,
          })}
          leeg={data.length === 0 ? <><b>Nog geen voorraadbewegingen.</b>Boek voorraad in via een artikel (tabblad Voorraad).</> : <><b>Niets gevonden.</b>Pas je zoekopdracht of filter aan.</>} />
      )}
    </>
  );
}
