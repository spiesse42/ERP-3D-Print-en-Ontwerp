import { useSearchParams } from 'react-router-dom';
import { BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { ControlePaneel, Chip, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import { euro, aantal, datum } from '../../lib/formaat.js';
import Staafgrafiek, { maandNaam } from './Staafgrafiek.jsx';

// Financiën → Overzicht (stap 7): omzet, ontvangen, aankopen, saldo per
// maand en de drempels bijberoep. RICHTWAARDEN uit wat het ERP kent;
// Accountable blijft de boekhouding.
export const csvUrl = pad => new URL(`${BASE}${pad}`, document.baseURI).href;

export function useJaar() {
  const [params, setParams] = useSearchParams();
  const jaar = Number(params.get('jaar')) || new Date().getFullYear();
  const zet = j => { const p = new URLSearchParams(params); p.set('jaar', String(j)); setParams(p, { replace: true }); };
  return [jaar, zet];
}
export function Jaarkeuze({ jaren, jaar, onKies }) {
  const lijst = [...new Set([...(jaren || []), jaar])].sort((a, b) => b - a);
  return <div className="jaarkeuze">{lijst.map(j => <Chip key={j} aan={j === jaar} onClick={() => onKies(j)}>{j}</Chip>)}</div>;
}

function Drempel({ label, lijn, uitleg }) {
  const pct = lijn.pct ?? 0;
  const klasse = pct > 110 ? 'crit' : pct >= 80 ? 'warn' : '';
  return (
    <div className={`drempel ${klasse}`}>
      <div className="kop"><span><b>{label}</b></span><span className="num">{euro(lijn.bedrag)} / {euro(lijn.drempel)} ({aantal(pct)} %)</span></div>
      <div className="balk" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
      <div className="sub">{uitleg}</div>
    </div>
  );
}

export default function Overzicht() {
  const [jaar, zetJaar] = useJaar();
  const { data: o, fout, laden } = useData(`/financien/overzicht?jaar=${jaar}`);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Overzicht' }]} filters={<Jaarkeuze jaren={o?.jaren} jaar={jaar} onKies={zetJaar} />}
        acties={<a className="btn" href={csvUrl(`/financien/csv/overzicht?jaar=${jaar}`)} download>CSV</a>} />
      {fout ? <Fout tekst={fout} /> : !o && laden ? <Laden /> : o && (
        <div className="fin">
          <div className="kpis">
            <div className="kpi"><div className="l">Omzet (afgerekend)</div><div className="w">{euro(o.totaal.omzet)}</div><div className="s">{aantal(o.totaal.facturen)} factu{o.totaal.facturen === 1 ? 'ur' : 'ren'} · {aantal(o.totaal.bonnetjes)} bonnetje{o.totaal.bonnetjes === 1 ? '' : 's'}</div></div>
            <div className="kpi"><div className="l">Ontvangen</div><div className="w">{euro(o.totaal.ontvangen)}</div><div className="s">op de betaaldatum</div></div>
            <div className="kpi"><div className="l">Aankopen</div><div className="w">{euro(o.totaal.aankopen)}</div><div className="s">incl. btw, bestelde/ontvangen aankopen</div></div>
            <div className="kpi"><div className="l">Winst (richtwaarde)</div><div className="w">{euro(o.totaal.winst)}</div><div className="s">omzet − aankopen</div></div>
            {o.gratis?.aantal > 0 && (
              <div className="kpi"><div className="l">Gratis geleverd</div><div className="w">{euro(o.gratis.kost)}</div>
                <div className="s">kost{o.gratis.onvolledig ? ' (onvolledig)' : ''} · {aantal(o.gratis.aantal)} dossier{o.gratis.aantal === 1 ? '' : 's'} · waarde {euro(o.gratis.waarde)} · <Link naar="/financien/marges">details</Link></div></div>
            )}
          </div>
          <div className="panel"><h3>Drempels bijberoep {o.jaar}</h3>
            <div className="pbody" style={{ display: 'grid', gap: 14 }}>
              <Drempel label="Omzet — btw-vrijstelling kleine onderneming" lijn={o.drempels.omzet}
                uitleg={`Jaardrempel ${euro(o.drempels.omzet.drempel_vol)}${o.drempels.pro_rata ? `, pro rata voor ${o.drempels.dagen} van ${o.drempels.dagen_in_jaar} dagen (start ${datum(o.drempels.startdatum)})` : ''}. Tot 10 % erboven mag je het jaar uitdoen; daarboven meteen btw-plichtig.`} />
              <Drempel label="Winst — geen sociale bijdragen in bijberoep" lijn={o.drempels.winst}
                uitleg={`Jaardrempel ${euro(o.drempels.winst.drempel_vol)} netto belastbaar inkomen${o.drempels.pro_rata ? ', pro rata' : ''}. De winst hier is omzet min aankopen: kosten die enkel in Accountable staan, tellen niet mee.`} />
              <p className="note" style={{ margin: 0 }}>Enkel een richtwaarde, geen officiële berekening. Kijk de bedragen van dit jaar na bij je boekhouder of sociaal verzekeringsfonds en pas ze aan in <Link naar="/instellingen/bedrijf">Instellingen → Bedrijfsgegevens</Link>{!o.drempels.startdatum && ' (daar vul je ook de startdatum in voor de pro-rataberekening)'}.</p>
            </div>
          </div>
          <div className="grafieken">
            <div className="panel"><div className="pbody"><Staafgrafiek titel="Omzet per maand" rijen={o.maanden} waarde={m => m.omzet} opmaak={euro} /></div></div>
            <div className="panel"><div className="pbody"><Staafgrafiek titel="Aankopen per maand" rijen={o.maanden} waarde={m => m.aankopen} opmaak={euro} /></div></div>
          </div>
          <div className="panel"><h3>Per maand</h3>
            <div className="pbody scroll-x">
              <table className="mini">
                <thead><tr><th>Maand</th><th className="r">Omzet</th><th className="r">Facturen</th><th className="r">Bonnetjes</th><th className="r">Ontvangen</th><th className="r">Aankopen</th><th className="r">Saldo</th></tr></thead>
                <tbody>
                  {o.maanden.map(m => (
                    <tr key={m.maand}><td>{maandNaam(m.maand)}</td><td className="r num">{euro(m.omzet)}</td><td className="r num">{m.facturen || ''}</td><td className="r num">{m.bonnetjes || ''}</td>
                      <td className="r num">{euro(m.ontvangen)}</td><td className="r num">{euro(m.aankopen)}</td><td className={`r num${m.saldo < 0 ? ' neg' : ''}`}>{euro(m.saldo)}</td></tr>
                  ))}
                  <tr><td><b>Totaal</b></td><td className="r num"><b>{euro(o.totaal.omzet)}</b></td><td className="r num">{o.totaal.facturen}</td><td className="r num">{o.totaal.bonnetjes}</td>
                    <td className="r num"><b>{euro(o.totaal.ontvangen)}</b></td><td className="r num"><b>{euro(o.totaal.aankopen)}</b></td><td className="r num"><b>{euro(o.totaal.saldo)}</b></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
