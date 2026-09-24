import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData, onthoud, bewaar } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Kaarten, Laden, Fout, initialen, avatarKleur } from '../../schil/Weergaven.jsx';
import { euro, aantal } from '../../lib/formaat.js';
import { TYPE_LABEL, STATUS, vinkjesTekst, eenheid } from './artikel.js';

const TYPES = [['filament', 'Filament'], ['artikel', 'Artikelen'], ['dienst', 'Diensten']];
const GROEPERING = { geen: null, categorie: 'Categorie', type: 'Type' };

export function Kleurstaal({ hex }) {
  return <span className="staal" style={{ background: hex }} aria-hidden="true" />;
}
export function StatusBadge({ status }) {
  if (!status || !STATUS[status]) return <span className="sub">—</span>;
  const [klasse, label] = STATUS[status];
  return <span className={`badge ${klasse}`}>{label}</span>;
}
export function ArtikelNaam({ a }) {
  return <span className="artnaam">{a.type === 'filament' && <Kleurstaal hex={a.kleur_hex} />}<b>{a.weergave}</b></span>;
}
const minMax = a => (a.min_eff == null && a.max_eff == null ? '—' : `${a.min_eff == null ? '…' : aantal(a.min_eff)} – ${a.max_eff == null ? '…' : aantal(a.max_eff)}`);
const prijs = a => (a.type === 'filament' ? `${euro(a.verkoopprijs_per_kg)}/kg` : a.wordt_verkocht ? euro(a.verkoopprijs) : '—');

export default function ArtikelenLijst() {
  const { navigeer } = useOmgeving();
  const [params] = useSearchParams();
  const [zoek, setZoek] = useState('');
  const [type, setType] = useState(params.get('type'));
  const [onderMin, setOnderMin] = useState(params.get('filter') === 'onder-minimum');
  const [archief, setArchief] = useState(false);
  const [groep, setGroep] = useState(() => onthoud('artikelen.groep', 'geen'));
  const [weergave, setWeergaveState] = useState(() => onthoud('artikelen.weergave', 'lijst'));
  const [sortering, setSortering] = useState({ kolom: 0, op: true });
  const { data, fout, laden } = useData(archief ? '/voorraad/artikelen?archief=1' : '/voorraad/artikelen');

  const setWeergave = w => { setWeergaveState(w); bewaar('artikelen.weergave', w); };
  const kiesGroep = g => { setGroep(g); bewaar('artikelen.groep', g); };

  const kolommen = [
    { kop: 'Naam', cel: a => <ArtikelNaam a={a} />, sorteer: a => a.weergave.toLowerCase() },
    { kop: 'Categorie', cel: a => a.categorie || <span className="sub">—</span>, sorteer: a => (a.categorie || '').toLowerCase() },
    { kop: 'Type', cel: a => <>{TYPE_LABEL[a.type]}<div className="sub">{vinkjesTekst(a)}</div></>, sorteer: a => a.type },
    { kop: 'Voorraad', klasse: 'r num', cel: a => (a.type === 'dienst' ? <span className="sub">—</span> : <>{aantal(a.voorraad)} <span className="sub">{eenheid(a.voorraad, a.eenheid)}</span>{a.besteld > 0 && <div className="sub">+{aantal(a.besteld)} besteld</div>}{a.in_productie > 0 && <div className="sub">+{aantal(a.in_productie)} in productie</div>}</>), sorteer: a => (a.type === 'dienst' ? -1 : a.voorraad) },
    { kop: 'Min – max', klasse: 'r num', cel: a => (a.type === 'dienst' ? <span className="sub">—</span> : minMax(a)) },
    { kop: 'Status', cel: a => <StatusBadge status={a.status} />, sorteer: a => ['bestellen', 'besteld', 'in_productie', 'ok', 'geen'].indexOf(a.status ?? 'geen') },
    { kop: 'Verkoopprijs', klasse: 'r num', cel: prijs, sorteer: a => (a.type === 'filament' ? a.verkoopprijs_per_kg : a.verkoopprijs) ?? -1 },
  ];

  const groepen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    let rijen = data.filter(a => (!type || a.type === type)
      && (!onderMin || a.status === 'bestellen')
      && (!q || [a.weergave, a.categorie, a.locatie, a.notities].some(v => String(v || '').toLowerCase().includes(q))));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) rijen = [...rijen].sort((x, y) => { const p = s(x), q2 = s(y); return (p < q2 ? -1 : p > q2 ? 1 : 0) * (sortering.op ? 1 : -1); });
    if (groep === 'geen') return [{ titel: null, rijen }];
    const sleutel = groep === 'type' ? (a => TYPE_LABEL[a.type]) : (a => a.categorie || 'Geen categorie');
    const m = new Map();
    rijen.forEach(a => { const g = sleutel(a); if (!m.has(g)) m.set(g, []); m.get(g).push(a); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'nl')).map(([titel, rijen]) => ({ titel, rijen }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, type, onderMin, groep, sortering]);

  const aantalRijen = groepen.reduce((s, g) => s + g.rijen.length, 0);
  const facetten = [];
  if (type) facetten.push({ label: TYPES.find(t => t[0] === type)?.[1], onWeg: () => setType(null) });
  if (onderMin) facetten.push({ label: 'Onder minimum', onWeg: () => setOnderMin(false) });
  if (archief) facetten.push({ label: 'Gearchiveerd', onWeg: () => setArchief(false) });
  if (groep !== 'geen') facetten.push({ label: GROEPERING[groep], icoon: 'lagen', onWeg: () => kiesGroep('geen') });

  const open = a => navigeer(`/voorraad/artikelen/${a.id}`);
  const leeg = archief ? <b>Geen gearchiveerde artikelen.</b>
    : data && data.length === 0 ? <><b>Nog geen artikelen.</b>Maak je eerste artikel, filament of dienst aan met de knop Nieuw.</>
      : <><b>Geen artikelen gevonden.</b>Pas je zoekopdracht of filters aan.</>;

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Artikelen' }]}
        zoek={zoek} onZoek={setZoek} facetten={facetten}
        acties={<button type="button" className="btn primary" onClick={() => navigeer(`/voorraad/artikelen/nieuw${type ? `?type=${type}` : ''}`)}>Nieuw</button>}
        filters={<>
          {TYPES.map(([t, label]) => <Chip key={t} aan={type === t} onClick={() => setType(x => (x === t ? null : t))}>{label}</Chip>)}
          <Chip aan={onderMin} onClick={() => setOnderMin(x => !x)}>Onder minimum</Chip>
          <Chip aan={archief} onClick={() => setArchief(x => !x)}>Gearchiveerd</Chip>
          <Chip aan={groep === 'categorie'} onClick={() => kiesGroep(groep === 'categorie' ? 'geen' : 'categorie')}>Groeperen op categorie</Chip>
          <Chip aan={groep === 'type'} onClick={() => kiesGroep(groep === 'type' ? 'geen' : 'type')}>Groeperen op type</Chip>
        </>}
        teller={data ? `${aantalRijen} / ${data.length}` : null}
        weergave={weergave} onWeergave={setWeergave}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : weergave === 'lijst' ? (
        <Lijst kolommen={kolommen} groepen={groepen} sleutel={a => a.id} onOpen={open}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={a => ({
            titel: <ArtikelNaam a={a} />,
            rechts: a.type === 'dienst' ? prijs(a) : <span className="num">{aantal(a.voorraad)} {eenheid(a.voorraad, a.eenheid)}</span>,
            regel: [a.categorie, vinkjesTekst(a)].filter(Boolean).join(' · '),
            onder: TYPE_LABEL[a.type], badge: a.type === 'dienst' ? null : <StatusBadge status={a.status} />,
          })}
          leeg={leeg} />
      ) : (
        <Kaarten rijen={groepen.flatMap(g => g.rijen)} sleutel={a => a.id} onOpen={open} leeg={leeg}
          kaart={a => ({
            titel: a.weergave,
            initialen: a.type === 'filament' ? '' : initialen(a.weergave),
            kleur: a.type === 'filament' ? a.kleur_hex : avatarKleur(a.weergave),
            regel: [a.categorie || TYPE_LABEL[a.type], a.type === 'dienst' ? prijs(a) : `${aantal(a.voorraad)} ${eenheid(a.voorraad, a.eenheid)}`].join(' · '),
            badges: a.type === 'dienst' ? null : <StatusBadge status={a.status} />,
          })} />
      )}
    </>
  );
}
