import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Lijst, Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, datum, aantal } from '../../lib/formaat.js';
import { Jaarkeuze, useJaar, csvUrl } from './Overzicht.jsx';

// Financiën → Marges (stap 7): per afgerekende klantopdracht het bedrag
// tegenover de ECHTE kost die het ERP gemeten heeft (printwerk aan
// productiekost, geleverde artikelen aan inkoopprijs), en na arbeid.
const pct = v => (v == null ? '—' : `${aantal(v)} %`);
export default function Marges() {
  const [jaar, zetJaar] = useJaar();
  const { navigeer } = useOmgeving();
  const { data: m, fout, laden } = useData(`/financien/marges?jaar=${jaar}`);
  const { data: o } = useData(`/financien/overzicht?jaar=${jaar}`);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Marges' }]} filters={<Jaarkeuze jaren={o?.jaren} jaar={jaar} onKies={zetJaar} />}
        acties={<a className="btn" href={csvUrl(`/financien/csv/marges?jaar=${jaar}`)} download>CSV</a>} />
      {fout ? <Fout tekst={fout} /> : !m && laden ? <Laden /> : m && (
        <div className="fin">
          <div className="kpis">
            <div className="kpi"><div className="l">Afgerekend</div><div className="w">{euro(m.totaal.bedrag)}</div><div className="s">{m.rijen.length} dossiers</div></div>
            <div className="kpi"><div className="l">Gemeten kost</div><div className="w">{euro(m.totaal.kost)}</div><div className="s">+ arbeid {euro(m.totaal.arbeid)}</div></div>
            <div className="kpi"><div className="l">Marge</div><div className="w">{euro(m.totaal.marge)}</div><div className="s">{m.totaal.bedrag ? pct(Math.round(m.totaal.marge / m.totaal.bedrag * 1000) / 10) : ''}</div></div>
            <div className="kpi"><div className="l">Marge na arbeid</div><div className="w">{euro(m.totaal.marge_met_arbeid)}</div></div>
          </div>
          <div className="panel">
            <Lijst sleutel={d => d.id} onOpen={d => navigeer(`/dossiers/${d.id}`)} groepen={[{ titel: null, rijen: m.rijen }]}
              kolommen={[
                { kop: 'Dossier', cel: d => <><span className="mono">{d.nummer}</span> · {d.titel}{d.onvolledig && <span className="badge b-warn" style={{ marginLeft: 6 }} title={d.redenen.join(', ')}>onvolledig</span>}</> },
                { kop: 'Klant', cel: d => d.klant || '—' },
                { kop: 'Afgerekend', cel: d => <span className="num">{datum(d.afgerekend_op)}</span> },
                { kop: 'Bedrag', klasse: 'r', cel: d => <span className="num">{euro(d.afgerekend_bedrag)}</span> },
                { kop: 'Kost', klasse: 'r', cel: d => <span className="num">{euro(d.kost)}</span> },
                { kop: 'Arbeid', klasse: 'r', cel: d => <span className="num">{euro(d.arbeid)}</span> },
                { kop: 'Marge', klasse: 'r', cel: d => <span className={`num${d.marge < 0 ? ' neg' : ''}`}>{euro(d.marge)} <span className="sub">{pct(d.marge_pct)}</span></span> },
                { kop: 'Na arbeid', klasse: 'r', cel: d => <span className={`num${d.marge_met_arbeid < 0 ? ' neg' : ''}`}>{euro(d.marge_met_arbeid)}</span> },
              ]}
              kaart={d => ({ titel: d.titel, rechts: <b className="num">{euro(d.marge)}</b>, regel: `${d.nummer} · ${d.klant || ''}`, onder: `${euro(d.afgerekend_bedrag)} − kost ${euro(d.kost)}`, badge: d.onvolledig ? <span className="badge b-warn">onvolledig</span> : null })}
              leeg={<><b>Nog niets afgerekend in {jaar}.</b>Afgerekende klantopdrachten verschijnen hier met hun marge.</>} />
          </div>
          <p className="note" style={{ margin: 0 }}>Kost = printwerk aan productiekost (filament aan inkoopprijs, gemeten elektriciteit, machinetarief, BMCU, mislukte pogingen; vastgelegd bij het bevestigen van de printopdracht) + geleverde artikelen uit voorraad aan hun inkoopprijs. Diensten (ontwerp, verzending) hebben geen kost. "Onvolledig": printwerk zonder bevestigde printopdracht, of een artikel zonder inkoopprijs.</p>
        </div>
      )}
    </>
  );
}
