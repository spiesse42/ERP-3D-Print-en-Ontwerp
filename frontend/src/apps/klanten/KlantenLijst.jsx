import { useMemo, useState } from 'react';
import { useData, onthoud, bewaar } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Kaarten, Laden, Fout, initialen, avatarKleur } from '../../schil/Weergaven.jsx';
import { klantNaam } from './klant.js';

const GROEPERING = { geen: null, type: 'Type', gemeente: 'Gemeente' };

export default function KlantenLijst() {
  const { navigeer } = useOmgeving();
  const [zoek, setZoek] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);        // 'zakelijk' | 'particulier' | null
  const [archief, setArchief] = useState(false);
  const [groep, setGroep] = useState('geen');
  const [weergave, setWeergaveState] = useState(() => onthoud('klanten.weergave', 'lijst'));
  const [sortering, setSortering] = useState({ kolom: 0, op: true });
  const { data, fout, laden } = useData(archief ? '/klanten?archief=1' : '/klanten');

  function setWeergave(w) { setWeergaveState(w); bewaar('klanten.weergave', w); }

  const kolommen = [
    { kop: 'Naam', cel: k => <><b>{klantNaam(k)}</b>{k.type === 'zakelijk' && k.bedrijfsnaam && (k.voornaam || k.naam) && <div className="sub">{[k.voornaam, k.naam].filter(Boolean).join(' ')}</div>}</>, sorteer: k => klantNaam(k).toLowerCase() },
    { kop: 'Type', cel: k => k.type === 'zakelijk' ? 'Zakelijk' : 'Particulier', sorteer: k => k.type },
    { kop: 'Gemeente', cel: k => k.gemeente || <span className="sub">—</span>, sorteer: k => (k.gemeente || '').toLowerCase() },
    { kop: 'E-mail', cel: k => k.email || <span className="sub">—</span> },
    { kop: 'Telefoon', cel: k => k.gsm || k.telefoon || <span className="sub">—</span> },
    { kop: 'Peppol', cel: k => k.peppol_id ? <span className="badge b-info">Ja</span> : <span className="sub">—</span> },
  ];

  const groepen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    let rijen = data.filter(k => (!typeFilter || k.type === typeFilter) &&
      (!q || [klantNaam(k), k.naam, k.voornaam, k.bedrijfsnaam, k.gemeente, k.email, k.btw_nummer].some(v => String(v || '').toLowerCase().includes(q))));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) rijen = [...rijen].sort((a, b) => { const x = s(a), y = s(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortering.op ? 1 : -1); });
    if (groep === 'geen') return [{ titel: null, rijen }];
    const sleutel = groep === 'type' ? (k => k.type === 'zakelijk' ? 'Zakelijk' : 'Particulier') : (k => k.gemeente || 'Geen gemeente');
    const m = new Map();
    rijen.forEach(k => { const g = sleutel(k); if (!m.has(g)) m.set(g, []); m.get(g).push(k); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'nl')).map(([titel, rijen]) => ({ titel, rijen }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, typeFilter, groep, sortering]);

  const aantal = groepen.reduce((s, g) => s + g.rijen.length, 0);
  const facetten = [];
  if (typeFilter) facetten.push({ label: typeFilter === 'zakelijk' ? 'Zakelijk' : 'Particulier', onWeg: () => setTypeFilter(null) });
  if (archief) facetten.push({ label: 'Gearchiveerd', onWeg: () => setArchief(false) });
  if (groep !== 'geen') facetten.push({ label: GROEPERING[groep], icoon: 'lagen', onWeg: () => setGroep('geen') });

  const open = k => navigeer(`/klanten/${k.id}`);
  const leeg = archief
    ? <><b>Geen gearchiveerde klanten.</b></>
    : (data && data.length === 0
      ? <><b>Nog geen klanten.</b>Maak je eerste klant aan met de knop Nieuw.</>
      : <><b>Geen klanten gevonden.</b>Pas je zoekopdracht of filters aan.</>);

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Klanten' }]}
        zoek={zoek} onZoek={setZoek} facetten={facetten}
        acties={<button type="button" className="btn primary" onClick={() => navigeer('/klanten/nieuw')}>Nieuw</button>}
        filters={<>
          <Chip aan={typeFilter === 'zakelijk'} onClick={() => setTypeFilter(t => t === 'zakelijk' ? null : 'zakelijk')}>Zakelijk</Chip>
          <Chip aan={typeFilter === 'particulier'} onClick={() => setTypeFilter(t => t === 'particulier' ? null : 'particulier')}>Particulier</Chip>
          <Chip aan={archief} onClick={() => setArchief(a => !a)}>Gearchiveerd</Chip>
          <Chip aan={groep === 'type'} onClick={() => setGroep(g => g === 'type' ? 'geen' : 'type')}>Groeperen op type</Chip>
          <Chip aan={groep === 'gemeente'} onClick={() => setGroep(g => g === 'gemeente' ? 'geen' : 'gemeente')}>Groeperen op gemeente</Chip>
        </>}
        teller={data ? `${aantal} / ${data.length}` : null}
        weergave={weergave} onWeergave={setWeergave}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : weergave === 'lijst' ? (
        <Lijst kolommen={kolommen} groepen={groepen} sleutel={k => k.id} onOpen={open}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={k => ({ titel: klantNaam(k), rechts: k.peppol_id ? <span className="badge b-info">Peppol</span> : null,
            regel: [k.gemeente, k.email].filter(Boolean).join(' · '), onder: k.type === 'zakelijk' ? 'Zakelijk' : 'Particulier' })}
          leeg={leeg} />
      ) : (
        <Kaarten rijen={groepen.flatMap(g => g.rijen)} sleutel={k => k.id} onOpen={open} leeg={leeg}
          kaart={k => ({ titel: klantNaam(k), initialen: initialen(klantNaam(k)), kleur: avatarKleur(klantNaam(k)),
            regel: [k.type === 'zakelijk' ? 'Zakelijk' : 'Particulier', k.gemeente].filter(Boolean).join(' · '),
            badges: k.peppol_id ? <span className="badge b-info">Peppol</span> : null })} />
      )}
    </>
  );
}
