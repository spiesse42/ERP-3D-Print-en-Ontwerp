import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData, onthoud, bewaar } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Chip, Lijst, Kanban, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, datum } from '../../lib/formaat.js';
import { FASE, FASE_VOLGORDE, SOORT, FaseBadge, VOOR_AFREKENING } from './dossier.jsx';

// Dossiers (stap 5a): lijst en kanban per fase. De fase komt uit de backend.
export default function DossiersLijst() {
  const { navigeer } = useOmgeving();
  const [params, setParams] = useSearchParams();
  const klantFilter = params.get('klant');
  const [zoek, setZoek] = useState('');
  const [soort, setSoort] = useState(null);
  const [afTeRekenen, setAfTeRekenen] = useState(false);
  const [archief, setArchief] = useState(false);
  const [weergave, setWeergaveState] = useState(() => onthoud('dossiers.weergave', 'kaarten'));
  const [sortering, setSortering] = useState({ kolom: 0, op: false });
  const pad = `/dossiers?archief=${archief ? 1 : 0}${klantFilter ? `&klant=${klantFilter}` : ''}`;
  const { data, fout, laden } = useData(pad);

  function setWeergave(w) { setWeergaveState(w); bewaar('dossiers.weergave', w); }

  const kolommen = [
    { kop: 'Nummer', cel: d => <span className="mono">{d.nummer}</span>, sorteer: d => d.nummer },
    { kop: 'Titel', cel: d => <b>{d.titel}</b>, sorteer: d => d.titel.toLowerCase() },
    { kop: 'Klant', cel: d => d.klant || <span className="sub">{d.soort === 'klant' ? '—' : SOORT[d.soort]}</span>, sorteer: d => (d.klant || '').toLowerCase() },
    { kop: 'Aangemaakt', cel: d => <span className="num">{datum(d.aangemaakt_op)}</span>, sorteer: d => d.aangemaakt_op },
    { kop: 'Fase', cel: d => <FaseBadge fase={d.fase} />, sorteer: d => FASE_VOLGORDE.indexOf(d.fase) },
    { kop: 'Totaal', klasse: 'r', cel: d => d.volledig ? <span className="num">{euro(d.totaal)}</span> : <span className="badge b-warn">onvolledig</span>, sorteer: d => d.totaal ?? -1 },
  ];

  const rijen = useMemo(() => {
    if (!data) return [];
    const q = zoek.trim().toLowerCase();
    let l = data.filter(d => (!soort || d.soort === soort)
      && (!afTeRekenen || (d.soort === 'klant' && VOOR_AFREKENING.includes(d.fase)))
      && (!q || [d.nummer, d.titel, d.klant, d.afgerekend_nummer].some(v => String(v || '').toLowerCase().includes(q))));
    const s = kolommen[sortering.kolom]?.sorteer;
    if (s) l = [...l].sort((a, b) => { const x = s(a), y = s(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortering.op ? 1 : -1); });
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zoek, soort, afTeRekenen, sortering]);

  const klantNaam = data?.find(d => String(d.klant_id) === klantFilter)?.klant;
  const facetten = [];
  if (klantFilter) facetten.push({ label: `Klant: ${klantNaam || klantFilter}`, onWeg: () => setParams({}) });
  if (soort) facetten.push({ label: SOORT[soort], onWeg: () => setSoort(null) });
  if (afTeRekenen) facetten.push({ label: 'Nog af te rekenen', onWeg: () => setAfTeRekenen(false) });
  if (archief) facetten.push({ label: 'Gearchiveerd', onWeg: () => setArchief(false) });

  const open = d => navigeer(`/dossiers/${d.id}`);
  const leeg = data && data.length === 0 && !archief && !klantFilter
    ? <><b>Nog geen dossiers.</b>Maak je eerste dossier aan met de knop Nieuw.</>
    : <><b>Geen dossiers gevonden.</b>Pas je zoekopdracht of filters aan.</>;
  const kaart = d => ({
    titel: d.titel,
    rechts: <span className="num">{d.volledig ? euro(d.totaal) : '—'}</span>,
    regel: [d.nummer, d.klant || SOORT[d.soort]].filter(Boolean).join(' · '),
    badges: <>{!d.volledig && <span className="badge b-warn">onvolledig</span>}{['afgerekend', 'betaald', 'gratis'].includes(d.fase) && (d.lever_status === 'geen' || d.lever_status === 'deels') && <span className="badge b-warn">nog te leveren</span>}{['afgerekend', 'betaald', 'gratis'].includes(d.fase) && (d.prod_status === 'geen' || d.prod_status === 'productie') && <span className="badge b-info">nog te printen</span>}{d.afgerekend_nummer && <span className="badge b-neutral">{d.afgerekend_soort} {d.afgerekend_nummer}</span>}</>,
  });

  return (
    <>
      <ControlePaneel
        kruimels={[{ label: 'Dossiers' }]}
        zoek={zoek} onZoek={setZoek} facetten={facetten}
        acties={<button type="button" className="btn primary" onClick={() => navigeer(`/dossiers/nieuw${klantFilter ? `?klant=${klantFilter}` : ''}`)}>Nieuw</button>}
        filters={<>
          <Chip aan={afTeRekenen} onClick={() => setAfTeRekenen(a => !a)}>Nog af te rekenen</Chip>
          {Object.entries(SOORT).map(([w, l]) => <Chip key={w} aan={soort === w} onClick={() => setSoort(s => (s === w ? null : w))}>{l}</Chip>)}
          <Chip aan={archief} onClick={() => setArchief(a => !a)}>Gearchiveerd</Chip>
        </>}
        teller={data ? `${rijen.length} / ${data.length}` : null}
        weergave={weergave} onWeergave={setWeergave}
      />
      {fout ? <Fout tekst={fout} /> : !data && laden ? <Laden /> : weergave === 'lijst' ? (
        <Lijst kolommen={kolommen} groepen={[{ titel: null, rijen }]} sleutel={d => d.id} onOpen={open}
          sortering={sortering} onSorteer={i => setSortering(s => ({ kolom: i, op: s.kolom === i ? !s.op : true }))}
          kaart={d => ({ ...kaart(d), rechts: <FaseBadge fase={d.fase} />, onder: d.volledig ? euro(d.totaal) : 'onvolledig' })}
          leeg={leeg} />
      ) : (
        <Kanban sleutel={d => d.id} onOpen={open} kaart={kaart} leeg={leeg}
          kolommen={FASE_VOLGORDE.filter(f => f !== 'geannuleerd' || rijen.some(d => d.fase === f))
            .map(f => ({ id: f, titel: FASE[f][1], rijen: rijen.filter(d => d.fase === f) }))} />
      )}
    </>
  );
}
