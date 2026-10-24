import { useData } from '../../schil/useData.js';
import { Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, aantal } from '../../lib/formaat.js';

// Prijsopbouw (15-10): alle onderdelen van de prijs met hun eenheidsprijs,
// uit de huidige tarieven, printers en materiaalprijzen. Om af te drukken.
const e = (v, n = 2) => (v == null ? '—' : euro(Math.round(v * 10 ** n) / 10 ** n));
const g = v => (v == null ? '—' : aantal(v));

export default function Prijsopbouw() {
  const { data, fout } = useData('/tarieven/prijsopbouw');
  if (fout) return <Fout tekst={fout} />;
  if (!data) return <Laden />;
  const t = Object.fromEntries(data.tarieven.map(x => [x.sleutel, x.waarde]));
  const winst = t.winst_per_printuur || 0, lang = winst * (t.winst_lang_pct ?? 100) / 100;
  const printers = data.printers.filter(p => p.actief);
  const voorbeeld = printers.find(p => p.kost_per_uur != null);
  const arbeidPrint = ((t.voorbereiding_min || 0) + (t.nabewerking_min || 0)) / 60 * (t.arbeid_per_uur || 0);
  const vandaag = new Date().toLocaleDateString('nl-BE');
  return (
    <div className="panel prijsopbouw-blad" style={{ padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Prijsopbouw <span className="sub" style={{ fontWeight: 400 }}>stand van {vandaag}</span></h3>
        <button type="button" className="btn primary geen-afdruk" onClick={() => window.print()}>Afdrukken</button>
      </div>
      <p className="note">Prijs van een printregel = <b>materiaal + stroom + machine + BMCU/AMS + arbeid + {data.nieuw ? 'winst per printuur' : 'getrapte marge'}</b>.
        Daarbovenop eventueel ontwerp of aanpassing (per uur), artikelen of diensten (hun verkoopprijs) en extra kosten. Alle bedragen zijn exclusief btw.</p>

      <h4 className="tussenkop">1. Materiaal (filament)</h4>
      <p className="note">Per gram: prijs per kg ÷ 1000 × gewicht uit de slicer. Prijs per kg = {data.nieuw && t.materiaal_opslag_pct > 0
        ? <>het hoogste van de verkoopprijs per kg en de inkoopprijs × {g(t.materiaal_opslag_pct)} %</> : 'de verkoopprijs per kg van de prijsgroep'}, plus de faalfactor van {g(t.faalfactor_pct)} %.
        Je kost is de inkoopprijs (gemiddelde van de rollen in voorraad).</p>
      <table className="mini">
        <thead><tr><th>Prijsgroep</th><th className="r">Verkoopprijs/kg</th><th className="r">Inkoop/kg</th>{data.nieuw && t.materiaal_opslag_pct > 0 && <th className="r">Inkoop × opslag</th>}<th className="r">Klant betaalt/kg</th><th className="r">Per 100 g</th></tr></thead>
        <tbody>{data.groepen.map(x => (
          <tr key={x.naam}><td>{x.naam}</td><td className="r num">{e(x.verkoopprijs_per_kg)}</td><td className="r num">{e(x.inkoop_per_kg)}</td>
            {data.nieuw && t.materiaal_opslag_pct > 0 && <td className="r num">{e(x.inkoop_opslag_per_kg)}</td>}
            <td className="r num"><b>{e(x.prijs_per_kg)}</b>{x.bron === 'inkoop × opslag' && <span className="sub"> (opslag)</span>}</td>
            <td className="r num">{e(x.prijs_per_kg == null ? null : x.prijs_per_kg / 10)}</td></tr>))}</tbody>
      </table>

      <h4 className="tussenkop">2. Printuren: stroom, machine{data.nieuw ? ' en winst' : ''}</h4>
      <p className="note">Stroom = verbruik (watt) ÷ 1000 × {e(t.kwh_prijs, 4)} per kWh. Machine = afschrijving en onderhoud per uur van die printer.
        {data.nieuw && <> Winst per printuur: {e(winst)} per uur tot {g(t.winst_lang_grens_uur)} u printtijd, daarboven {e(lang)} per uur ({g(t.winst_lang_pct)} %).</>}</p>
      <table className="mini">
        <thead><tr><th>Printer</th><th className="r">Verbruik</th><th className="r">Stroom/u</th><th className="r">Machine/u</th><th className="r">Kost/u</th>{data.nieuw && <th className="r">Prijs/u (+ winst)</th>}</tr></thead>
        <tbody>{printers.map(p => (
          <tr key={p.id}><td>{p.naam}</td><td className="r num">{p.verbruik_watt == null ? '—' : `${g(p.verbruik_watt)} W`}</td><td className="r num">{e(p.stroom_per_uur, 3)}</td>
            <td className="r num">{e(p.machine_per_uur)}</td><td className="r num">{e(p.kost_per_uur, 3)}</td>
            {data.nieuw && <td className="r num"><b>{e(p.kost_per_uur == null ? null : p.kost_per_uur + winst, 3)}</b></td>}</tr>))}</tbody>
      </table>

      <h4 className="tussenkop">3. Per print (per plaat)</h4>
      <table className="mini">
        <tbody>
          <tr><td>BMCU/AMS-slijtage</td><td className="r num">{e(t.bmcu_per_job)}</td><td className="sub">per plaat</td></tr>
          <tr><td>Voorbereiding</td><td className="r num">{g(t.voorbereiding_min)} min</td><td className="sub">per plaat, aan {e(t.arbeid_per_uur)}/u (als het veld op de regel leeg is)</td></tr>
          <tr><td>Nabewerking</td><td className="r num">{g(t.nabewerking_min)} min</td><td className="sub">per regel, aan {e(t.arbeid_per_uur)}/u (als het veld op de regel leeg is)</td></tr>
          <tr><td><b>Samen voor 1 plaat</b></td><td className="r num"><b>{e((t.bmcu_per_job || 0) + arbeidPrint)}</b></td><td className="sub">BMCU + arbeid</td></tr>
        </tbody>
      </table>

      <h4 className="tussenkop">4. Werk per uur (regie)</h4>
      <table className="mini">
        <tbody>
          <tr><td>Ontwerp op maat</td><td className="r num">{e(t.ontwerp_tarief)}</td><td className="sub">per uur</td></tr>
          <tr><td>Aanpassing / uitgebreide nabewerking</td><td className="r num">{e(t.nabewerking_tarief)}</td><td className="sub">per uur</td></tr>
          <tr><td>Arbeid (voorbereiding, nabewerking per print)</td><td className="r num">{e(t.arbeid_per_uur)}</td><td className="sub">per uur</td></tr>
        </tbody>
      </table>

      <h4 className="tussenkop">5. Overige regels</h4>
      <p className="note">Artikelen en diensten: hun verkoopprijs, zonder opslag. Een doorgerekende kost (bv. verzending) telt niet mee in de btw-grondslag.
        Extra kosten: het ingevulde bedrag{data.nieuw ? '' : ', met de marge'}. Een handmatig eindbedrag op een regel gaat altijd voor.</p>

      <h4 className="tussenkop">{data.nieuw ? '6. Oude berekening (ter vergelijking)' : '6. Getrapte marge'}</h4>
      <p className="note">{data.nieuw ? 'Niet meer gebruikt, enkel ter vergelijking: ' : ''}marge van {g(t.marge_klein_pct)} % als de totale printtijd korter is dan {g(t.marge_grens_uur)} u, anders {g(t.marge_groot_pct)} %,
        op stroom, machine, arbeid, BMCU, regie en extra kosten. Materiaal tegen de verkoopprijs per kg, zonder opslag.</p>

      {voorbeeld && data.groepen.some(x => x.prijs_per_kg != null) && (() => {
        const p = voorbeeld, m = data.groepen.find(x => x.prijs_per_kg != null), u = 3, gr = 100;
        const delen = [[`Materiaal ${gr} g ${m.naam}`, gr / 1000 * m.prijs_per_kg], [`Stroom ${u} u`, u * (p.stroom_per_uur || 0)], [`Machine ${u} u`, u * (p.machine_per_uur || 0)],
          ['BMCU/AMS', t.bmcu_per_job || 0], ['Arbeid', arbeidPrint], ...(data.nieuw ? [[`Winst ${u} u`, u * winst]] : [])];
        const som = delen.reduce((s, [, v]) => s + v, 0);
        return <>
          <h4 className="tussenkop">Voorbeeld: {gr} g, {u} u op de {p.naam}, 1 plaat</h4>
          <table className="mini"><tbody>
            {delen.map(([l, v]) => <tr key={l}><td>{l}</td><td className="r num">{e(v)}</td></tr>)}
            <tr><td><b>Prijs{data.nieuw ? '' : ' (vóór marge op stroom, machine, arbeid en BMCU)'}</b></td><td className="r num"><b>{e(som)}</b></td></tr>
          </tbody></table>
        </>;
      })()}
    </div>
  );
}
