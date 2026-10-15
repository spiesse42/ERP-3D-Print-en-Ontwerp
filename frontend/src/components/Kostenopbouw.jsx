import { euro, aantal as fmtAantal } from '../lib/formaat.js';

// Kostenopbouw (15-10): wat al het printwerk samen kost, uitgesplitst zoals
// per regel — filament (gram, per soort), stroom (kWh), machine, BMCU,
// arbeid. Kolommen: de schatting van de regels en, zodra er opdrachten
// voltooid zijn, de schatting van precies die opdrachten naast de meting,
// met het verschil. Intern: komt niet op offerte of werkbon.
// kolommen: [{ titel, o (opbouw van telOpbouw) }]
const e = v => (v == null ? '—' : euro(Math.round(v * 100) / 100));
const g = (v, n = 1) => fmtAantal(Math.round((v || 0) * 10 ** n) / 10 ** n);
const uren = v => { const u = Math.floor(v || 0), m = Math.round(((v || 0) - u) * 60); return `${u} u ${String(m).padStart(2, '0')}`; };

const RIJEN = [
  ['Printtijd', o => uren(o.uren), null],
  ['Platen / runs', o => `${g(o.runs, 0)}${o.mislukt ? ` (${g(o.mislukt, 0)} mislukt)` : ''}`, null],
  ['Filament', o => `${g(o.gram)} g`, 'filament'],
  ['Stroom', o => (o.kwh == null ? '' : `${g(o.kwh, 2)} kWh`), 'energie'],
  ['Machine', null, 'machine'],
  ['BMCU / AMS', null, 'bmcu'],
];

export default function Kostenopbouw({ kolommen, verschil = false, titel = 'Kostenopbouw printwerk', open = true }) {
  const k = kolommen.filter(x => x?.o);
  if (!k.length) return null;
  const toonVerschil = verschil && k.length >= 2;
  const a = k[k.length - 2]?.o, b = k[k.length - 1]?.o;
  const d = (veld) => {
    if (!toonVerschil) return null;
    const v = Math.round(((b[veld] || 0) - (a[veld] || 0)) * 100) / 100;
    return <td className="r num" style={{ color: Math.abs(v) < 0.01 ? undefined : v > 0 ? 'var(--crit)' : 'var(--pos)' }}>{Math.abs(v) < 0.01 ? '—' : `${v > 0 ? '+' : ''}${e(v)}`}</td>;
  };
  const namen = [...new Set(k.flatMap(x => (x.o.filamenten || []).map(f => f.naam)))];
  const filamentRijen = namen.length < 2 ? [] : namen.map(n => (
    <tr key={`f-${n}`} className="sub">
      <td style={{ paddingLeft: 18 }}>{n}</td>
      {k.map(x => { const f = (x.o.filamenten || []).find(y => y.naam === n); return [<td key={`${x.titel}h`} className="r">{f ? `${g(f.gram)} g` : ''}</td>, <td key={`${x.titel}e`} className="r num">{f ? e(f.kost) : ''}</td>]; })}
      {toonVerschil && <td />}
    </tr>));
  return (
    <details className="kostenopbouw intern" open={open} style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{titel} <span className="sub" style={{ fontWeight: 400 }}>intern</span></summary>
      <div className="tabelvak" style={{ marginTop: 6, overflowX: 'auto' }}>
        <table className="mini">
          <thead><tr><th />{k.map(x => <th key={x.titel} className="r" colSpan={2}>{x.titel}</th>)}{toonVerschil && <th className="r">Verschil</th>}</tr></thead>
          <tbody>
            {RIJEN.map(([l, hoeveel, veld]) => [
              <tr key={l}>
                <td>{l}</td>
                {k.map(x => [<td key={`${x.titel}h`} className="r sub">{hoeveel ? hoeveel(x.o) : ''}</td>, <td key={`${x.titel}e`} className="r num">{veld ? e(x.o[veld]) : ''}</td>])}
                {toonVerschil && (veld ? d(veld) : <td />)}
              </tr>,
              ...(veld === 'filament' ? filamentRijen : []),
            ])}
            <tr style={{ fontWeight: 600 }}>
              <td>Productiekost</td>
              {k.map(x => [<td key={`${x.titel}h`} />, <td key={`${x.titel}e`} className="r num">{e(x.o.kost)}</td>])}
              {toonVerschil && d('kost')}
            </tr>
            <tr>
              <td>Arbeid</td>
              {k.map(x => [<td key={`${x.titel}h`} className="r sub">{`${g(x.o.arbeid_min, 0)} min`}</td>, <td key={`${x.titel}e`} className="r num">{e(x.o.arbeid)}</td>])}
              {toonVerschil && d('arbeid')}
            </tr>
            <tr style={{ fontWeight: 600 }}>
              <td>Kost incl. arbeid</td>
              {k.map(x => [<td key={`${x.titel}h`} />, <td key={`${x.titel}e`} className="r num">{e((x.o.kost || 0) + (x.o.arbeid || 0))}</td>])}
              {toonVerschil && <td className="r num">{(() => { const v = Math.round(((b.kost + b.arbeid) - (a.kost + a.arbeid)) * 100) / 100; return Math.abs(v) < 0.01 ? '—' : `${v > 0 ? '+' : ''}${e(v)}`; })()}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
