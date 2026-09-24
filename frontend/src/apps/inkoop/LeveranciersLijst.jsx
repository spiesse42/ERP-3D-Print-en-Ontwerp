import { useMemo, useState } from 'react';
import { useData, onthoud, bewaar } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Kaarten, Laden, Fout, initialen, avatarKleur } from '../../schil/Weergaven.jsx';

export default function LeveranciersLijst() {
  const { navigeer } = useOmgeving();
  const [zoek, setZoek] = useState('');
  const [archief, setArchief] = useState(false);
  const [weergave, setWeergaveState] = useState(() => onthoud('leveranciers.weergave', 'lijst'));
  const [sortering, setSortering] = useState({ kolom: 0, op: true });
  const { data, fout, laden } = useData(archief ? '/leveranciers?archief=1' : '/leveranciers');
  const setWeergave = w => { setWeergaveState(w); bewaar('leveranciers.weergave', w); };

  const kolommen = [
    { kop: 'Naam', cel: l => <b>{l.naam}</b>, sorteer: l => l.naam.toLowerCase() },
    { kop: 'E-mail', cel: l => l.email || <span className="sub">—</span> },
    { kop: 'Website', cel: l => l.website || <span className="sub">—</span> },
    { kop: 'Ons klantnr.', cel: l => l.klantnummer || <span className="sub">—</span> },
    { kop: 'Artikelen', klasse: 'r num', cel: l => l.artikelen || <span className="sub">—</span>, sorteer: l => l.artikelen },
    { kop: 'Aankopen', klasse: 'r num', cel: l => l.aankopen || <span className="sub">—</span>, sorteer: l => l.aankopen },
  ];
  const rijen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    let r = data.filter(l => !q || [l.naam, l.email, l.website, l.klantnummer, l.btw_nummer].some(v => String(v || '').toLowerCase().includes(q)));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) r = [...r].sort((x, y) => { const p = s(x), q2 = s(y); return (p < q2 ? -1 : p > q2 ? 1 : 0) * (sortering.op ? 1 : -1); });
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, sortering]);
  const open = l => navigeer(`/inkoop/leveranciers/${l.id}`);
  const leeg = archief ? <b>Geen gearchiveerde leveranciers.</b>
    : data && data.length === 0 ? <><b>Nog geen leveranciers.</b>Maak er een aan met Nieuw, of rechtstreeks vanuit een aankoop of een artikel.</>
      : <><b>Geen leveranciers gevonden.</b>Pas je zoekopdracht aan.</>;

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Leveranciers' }]}
        zoek={zoek} onZoek={setZoek} facetten={archief ? [{ label: 'Gearchiveerd', onWeg: () => setArchief(false) }] : []}
        acties={<button type="button" className="btn primary" onClick={() => navigeer('/inkoop/leveranciers/nieuw')}>Nieuw</button>}
        filters={<Chip aan={archief} onClick={() => setArchief(a => !a)}>Gearchiveerd</Chip>}
        teller={data ? `${rijen.length} / ${data.length}` : null}
        weergave={weergave} onWeergave={setWeergave}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : weergave === 'lijst' ? (
        <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={l => l.id} onOpen={open}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={l => ({ titel: l.naam, rechts: <span className="sub">{l.aankopen} aankopen</span>, regel: [l.email, l.website].filter(Boolean).join(' · '), onder: `${l.artikelen} artikelen`, badge: null })}
          leeg={leeg} />
      ) : (
        <Kaarten rijen={rijen} sleutel={l => l.id} onOpen={open} leeg={leeg}
          kaart={l => ({ titel: l.naam, initialen: initialen(l.naam), kleur: avatarKleur(l.naam), regel: l.email || l.website || '', badges: <span className="badge b-neutral">{l.aankopen} aankopen</span> })} />
      )}
    </>
  );
}
