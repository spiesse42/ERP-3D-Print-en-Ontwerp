import { useState } from 'react';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { Link } from '../../schil/Schil.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { aantal, euro, naarInvoer } from '../../lib/formaat.js';
import { OpdrachtBadge, OpdrachtDialoog, BevestigDialoog } from '../productie/opdracht.jsx';

// Productie van een dossier (stap 6b): per printregel de printopdrachten,
// hoeveel stuks er goed zijn en wat er nog gepland staat. Klaar = elke
// printregel heeft genoeg goede stuks. Mislukte pogingen tellen niet op de
// werkbon (optie A) maar worden hier getoond als kost voor jou.
const uren = u => (u == null ? '—' : `${naarInvoer(Math.round(u * 100) / 100)} u`);

export default function ProductieTab({ d, vuil, herlaad }) {
  const { melding } = useOmgeving();
  const [dialoog, setDialoog] = useState(null);   // { soort: 'nieuw', regel } | { soort: 'open' | 'bevestig', o }
  const kan = d.acties.printopdracht;
  const klaar = async () => { setDialoog(null); await herlaad(); };
  function plan(x) {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return; }
    const rest = x.besteld - x.goed - x.gepland;
    setDialoog({ soort: 'nieuw', regel: { dossier_regel_id: x.regel_id, naam: x.omschrijving || `Printwerk ${d.nummer}`, label: x.omschrijving || 'Printwerk',
      aantal: rest > 0 ? rest : x.besteld, printer_id: x.printer_id } });
  }
  const gemeten = Object.fromEntries(d.regels.filter(r => r.type === 'printen').map(r => [r.id, r.gemeten]));
  return (
    <>
      {d.productie.regels.map(x => {
        const g = gemeten[x.regel_id];
        const tekort = Math.max(0, x.besteld - x.goed);
        return (
          <section key={x.regel_id} className="prod-regel" aria-label={x.omschrijving || 'Printwerk'}>
            <div className="kop">
              <b>{x.omschrijving || 'Printwerk'}{x.eindproduct && <span className="sub" style={{ fontWeight: 400 }}> → voorraad: <Link naar={`/voorraad/artikelen/${x.eindproduct.id}`}>{x.eindproduct.naam}</Link></span>}</b>
              <span className="tel num">besteld {aantal(x.besteld)} · goed {aantal(x.goed)}{x.gepland ? ` · gepland ${aantal(x.gepland)}` : ''}
                {' '}{tekort === 0 ? <span className="badge b-pos">klaar</span> : x.opdrachten.length ? <span className="badge b-info">nog {aantal(tekort)}</span> : null}</span>
              {kan && <button type="button" className="btn klein" onClick={() => plan(x)}><Icoon naam="plus" maat={12} /> Printopdracht</button>}
            </div>
            {x.opdrachten.length > 0 && (
              <div className="tabelvak" style={{ marginTop: 8 }}>
                <table className="mini">
                  <thead><tr><th>Opdracht</th><th>Printer</th><th className="r">Stuks</th><th className="r">Runs</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {x.opdrachten.map(o => (
                      <tr key={o.id} className="row" tabIndex={0} onClick={() => setDialoog({ soort: 'open', o })} onKeyDown={e => { if (e.key === 'Enter') setDialoog({ soort: 'open', o }); }}>
                        <td>{o.naam}</td>
                        <td>{o.printer}</td>
                        <td className="r num">{o.status === 'voltooid' ? `${aantal(o.aantal_goed)} / ${aantal(o.aantal)}` : aantal(o.aantal)}</td>
                        <td className="r num">{o.runs.length || ''}</td>
                        <td><OpdrachtBadge status={o.status} /></td>
                        <td className="r">{o.status === 'te_bevestigen' && <button type="button" className="btn klein primary" onClick={e => { e.stopPropagation(); setDialoog({ soort: 'bevestig', o }); }}>Bevestigen</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {g && (
              <p className="sub" style={{ marginBottom: 0 }}>
                Gemeten (geslaagd): {g.geslaagd.runs} run{g.geslaagd.runs === 1 ? '' : 's'} · {uren(g.geslaagd.uren)} · {g.geslaagd.kwh_onbekend ? '? ' : naarInvoer(g.geslaagd.kwh)} kWh
                {g.mislukt.runs > 0 && <> · <span style={{ color: 'var(--crit)' }}>mislukte pogingen: {g.mislukt.runs} ({uren(g.mislukt.uren)}, {naarInvoer(g.mislukt.kwh)} kWh, kost {euro(g.mislukt.kost)}{g.mislukt.kost_onvolledig ? '*' : ''})</span></>}
              </p>
            )}
          </section>
        );
      })}
      <p className="note">Plan een printopdracht per printregel; ze komt in de wachtrij van de printer (<Link naar="/productie/opdrachten">Productie → Printopdrachten</Link>). Start je de print, koppel dan de run op de printerkaart. Tijd en verbruik van de <b>geslaagde</b> runs komen op de werkbon; mislukte pogingen zijn een kost voor jou (elektriciteit + machinetarief; verloren filament niet meegerekend).</p>
      {dialoog?.soort === 'nieuw' && <OpdrachtDialoog vast={dialoog.regel} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'open' && <OpdrachtDialoog opdracht={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog?.soort === 'bevestig' && <BevestigDialoog o={dialoog.o} onSluit={() => setDialoog(null)} onKlaar={klaar} />}
    </>
  );
}
