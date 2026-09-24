import { useData } from '../../schil/useData.js';
import { ControlePaneel, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import { euro, aantal, naarInvoer } from '../../lib/formaat.js';
import Staafgrafiek from './Staafgrafiek.jsx';
import { Jaarkeuze, useJaar } from './Overzicht.jsx';

// Financiën → Statistieken (stap 7): opdrachten, omzet, printen en energie
// per maand; per printer; filament (rollen leeggemeld); eigen producten;
// beste klanten. Enkel wat het ERP zelf gemeten of geregistreerd heeft.
const u = v => `${naarInvoer(Math.round(v * 10) / 10)} u`;
const kwh = v => `${naarInvoer(Math.round(v * 100) / 100)} kWh`;
export default function Statistieken() {
  const [jaar, zetJaar] = useJaar();
  const { data: s, fout, laden } = useData(`/financien/statistieken?jaar=${jaar}`);
  const { data: o } = useData(`/financien/overzicht?jaar=${jaar}`);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Statistieken' }]} filters={<Jaarkeuze jaren={o?.jaren} jaar={jaar} onKies={zetJaar} />} />
      {fout ? <Fout tekst={fout} /> : !s && laden ? <Laden /> : s && (
        <div className="fin">
          <div className="kpis">
            <div className="kpi"><div className="l">Dossiers</div><div className="w">{aantal(s.totaal.dossiers)}</div><div className="s">{aantal(s.totaal.afgerekend)} afgerekend · {euro(s.totaal.omzet)}</div></div>
            <div className="kpi"><div className="l">Prints</div><div className="w">{aantal(s.totaal.runs)}</div><div className="s">{aantal(s.totaal.geslaagd)} geslaagd · {aantal(s.totaal.mislukt)} mislukt</div></div>
            <div className="kpi"><div className="l">Printtijd</div><div className="w">{u(s.totaal.uren)}</div></div>
            <div className="kpi"><div className="l">Energie</div><div className="w">{kwh(s.totaal.kwh)}</div><div className="s">{euro(s.totaal.energiekost)} aan {euro(s.kwh_prijs)}/kWh</div></div>
            <div className="kpi"><div className="l">Filament</div><div className="w">{aantal(s.totaal.rollen)} rollen</div><div className="s">leeggemeld</div></div>
          </div>
          <div className="grafieken">
            <div className="panel"><div className="pbody"><Staafgrafiek titel="Omzet per maand" rijen={s.maanden} waarde={m => m.omzet} opmaak={euro} /></div></div>
            <div className="panel"><div className="pbody"><Staafgrafiek titel="Printtijd per maand" rijen={s.maanden} waarde={m => m.uren} opmaak={u} /></div></div>
            <div className="panel"><div className="pbody"><Staafgrafiek titel="Energie per maand" rijen={s.maanden} waarde={m => m.kwh} opmaak={kwh} /></div></div>
            <div className="panel"><div className="pbody"><Staafgrafiek titel="Nieuwe dossiers per maand" rijen={s.maanden} waarde={m => m.dossiers} opmaak={v => aantal(v)} /></div></div>
          </div>
          <div className="panel"><h3>Per printer</h3>
            <div className="pbody scroll-x">
              <table className="mini">
                <thead><tr><th>Printer</th><th className="r">Prints</th><th className="r">Geslaagd</th><th className="r">Mislukt</th><th className="r">Slaagkans</th><th className="r">Printtijd</th><th className="r">Energie</th><th className="r">Kost energie</th></tr></thead>
                <tbody>{s.printers.map(p => (
                  <tr key={p.id}><td>{p.naam}</td><td className="r num">{p.runs}</td><td className="r num">{p.geslaagd}</td><td className="r num">{p.mislukt}</td>
                    <td className="r num">{p.slaagpct == null ? '—' : `${aantal(p.slaagpct)} %`}</td><td className="r num">{u(p.uren)}</td><td className="r num">{kwh(p.kwh)}</td><td className="r num">{euro(p.energiekost)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <div className="grafieken">
            <div className="panel"><h3>Filament (rollen leeggemeld)</h3>
              <div className="pbody">{s.filament.length ? (
                <table className="mini"><tbody>{s.filament.map(f => (
                  <tr key={f.id}><td><Link naar={`/voorraad/artikelen/${f.id}`}>{f.naam}</Link></td><td className="r num">{aantal(f.rollen)}</td></tr>
                ))}</tbody></table>) : <p className="sub" style={{ margin: 0 }}>Nog geen rollen leeggemeld in {jaar}.</p>}</div>
            </div>
            <div className="panel"><h3>Eigen producten (geproduceerd)</h3>
              <div className="pbody">{s.producten.length ? (
                <table className="mini"><thead><tr><th>Artikel</th><th className="r">Stuks</th><th className="r">Kost/stuk</th><th className="r">Verkoopprijs</th></tr></thead>
                  <tbody>{s.producten.map(p => (
                    <tr key={p.id}><td><Link naar={`/voorraad/artikelen/${p.id}`}>{p.naam}</Link></td><td className="r num">{aantal(p.stuks)}</td><td className="r num">{euro(p.kost_stuk)}</td><td className="r num">{euro(p.verkoopprijs)}</td></tr>
                  ))}</tbody></table>) : <p className="sub" style={{ margin: 0 }}>Nog geen eigen producten in voorraad gebracht in {jaar}.</p>}</div>
            </div>
            <div className="panel"><h3>Klanten (omzet)</h3>
              <div className="pbody">{s.klanten.length ? (
                <table className="mini"><tbody>{s.klanten.map(k => (
                  <tr key={k.id}><td><Link naar={`/klanten/${k.id}`}>{k.naam}</Link></td><td className="r num">{k.dossiers}</td><td className="r num">{euro(k.omzet)}</td></tr>
                ))}</tbody></table>) : <p className="sub" style={{ margin: 0 }}>Nog niets afgerekend in {jaar}.</p>}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
