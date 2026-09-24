import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, datum } from '../../lib/formaat.js';
import { FaseBadge } from '../dossiers/dossier.jsx';

// Financiën → Opvolging (stap 7): facturen die nog niet betaald zijn (hoe
// lang al) en klantopdrachten die klaar of geleverd zijn maar nog niet
// afgerekend in Accountable. Betaald zetten gebeurt in het dossier, of in
// één keer via de Accountable-export.
export default function Opvolging() {
  const { navigeer } = useOmgeving();
  const { data: o, fout, laden } = useData('/financien/opvolging');
  const open = d => navigeer(`/dossiers/${d.id}`);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Opvolging' }]} />
      {fout ? <Fout tekst={fout} /> : !o && laden ? <Laden /> : o && (
        <div className="fin">
          <div className="kpis">
            <div className="kpi"><div className="l">Onbetaalde facturen</div><div className="w">{euro(o.onbetaald_totaal)}</div><div className="s">{o.onbetaald.length} factu{o.onbetaald.length === 1 ? 'ur' : 'ren'}</div></div>
            <div className="kpi"><div className="l">Nog af te rekenen</div><div className="w">{euro(o.te_afrekenen_totaal)}</div><div className="s">{o.te_afrekenen.length} klaar of geleverd</div></div>
          </div>
          <div className="panel"><h3>Onbetaalde facturen</h3>
            <Lijst sleutel={d => d.id} onOpen={open} groepen={[{ titel: null, rijen: o.onbetaald }]}
              kolommen={[
                { kop: 'Factuur', cel: d => <span className="mono">{d.afgerekend_nummer}</span> },
                { kop: 'Dossier', cel: d => <><span className="mono">{d.nummer}</span> · {d.titel}</> },
                { kop: 'Klant', cel: d => d.klant || '—' },
                { kop: 'Datum', cel: d => <span className="num">{datum(d.afgerekend_op)}</span> },
                { kop: 'Open', klasse: 'r', cel: d => <span className={`badge ${d.dagen_open > 30 ? 'b-crit' : d.dagen_open > 14 ? 'b-warn' : 'b-neutral'}`}>{d.dagen_open} d</span> },
                { kop: 'Bedrag', klasse: 'r', cel: d => <span className="num">{euro(d.afgerekend_bedrag)}</span> },
              ]}
              kaart={d => ({ titel: d.afgerekend_nummer, rechts: <b className="num">{euro(d.afgerekend_bedrag)}</b>, regel: `${d.nummer} · ${d.klant || d.titel}`, onder: `${datum(d.afgerekend_op)} · ${d.dagen_open} dagen open` })}
              leeg={<><b>Alles betaald.</b>Geen openstaande facturen.</>} />
          </div>
          <div className="panel"><h3>Klaar, nog af te rekenen</h3>
            <Lijst sleutel={d => d.id} onOpen={open} groepen={[{ titel: null, rijen: o.te_afrekenen }]}
              kolommen={[
                { kop: 'Dossier', cel: d => <><span className="mono">{d.nummer}</span> · {d.titel}</> },
                { kop: 'Klant', cel: d => d.klant || '—' },
                { kop: 'Fase', cel: d => <FaseBadge fase={d.fase} /> },
                { kop: 'Totaal', klasse: 'r', cel: d => (d.volledig ? <span className="num">{euro(d.totaal)}</span> : <span className="badge b-warn">onvolledig</span>) },
              ]}
              kaart={d => ({ titel: d.titel, rechts: <FaseBadge fase={d.fase} />, regel: `${d.nummer} · ${d.klant || ''}`, onder: d.volledig ? euro(d.totaal) : 'onvolledig' })}
              leeg={<><b>Niets af te rekenen.</b>Klare of geleverde klantopdrachten verschijnen hier tot ze afgerekend zijn.</>} />
          </div>
          <p className="note" style={{ margin: 0 }}>Een factuur als betaald markeren doe je in het dossier (knop Betaald), of voor veel facturen tegelijk via Financiën → Accountable-import.</p>
        </div>
      )}
    </>
  );
}
