import { euro, aantal as fmtAantal } from '../lib/formaat.js';

// Kostenopbouw (15-10): wat al het printwerk samen kost, uitgesplitst zoals
// per regel — filament (gram, per soort), stroom (kWh), machine, BMCU,
// arbeid. Kolommen: de schatting van de regels en, zodra er opdrachten
// voltooid zijn, de schatting van precies die opdrachten naast de meting,
// met het verschil. Intern: komt niet op offerte of werkbon.
// kolommen: [{ titel, o (opbouw van telOpbouw) }]
const e = v => (v == null ? '—' : euro(Math.round(v * 100) / 100 || 0));   // || 0: geen "€ -0,00"
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

// Prijsberekening (15-10): het hele dossier per post — hoeveelheid, wat de
// klant betaalt, wat het jou kost en wat je eraan overhoudt. Arbeid telt als
// kost (je eigen tijd), zoals "winst na arbeid".
export function Prijsopbouw({ p, k, totaal, open = true }) {
  if (!p) return null;
  const o = k?.opbouw || {};
  const rij = (l, hoeveel, prijs, kost, toon = true) => (toon ? { l, hoeveel, prijs, kost } : null);
  const rijen = [
    rij('Filament', `${g(p.gram)} g`, p.materiaal, o.filament, p.gram > 0 || p.materiaal > 0),
    rij('Onderdelen (bij het product)', '', p.onderdelen, o.onderdelen ?? p.onderdelen, (p.onderdelen || 0) > 0),
    rij('Stroom', `${g(p.kwh, 2)} kWh`, p.energie, o.energie, p.uren > 0),
    rij('Machine (printuren)', uren(p.uren), p.machine, o.machine, p.uren > 0),
    rij('BMCU / AMS', `${g(p.platen, 0)} platen`, p.bmcu, o.bmcu, p.platen > 0),
    rij('Arbeid (voorbereiding + nabewerking)', `${g(p.arbeid_min, 0)} min`, p.arbeid, o.arbeid ?? p.arbeid, p.platen > 0),
    rij('Winst per printuur', uren(p.uren), p.winst, 0, p.winst > 0),
    rij('Marge (getrapt)', '', p.marge, 0, Math.abs(p.marge) >= 0.005),
    rij('Ontwerp', `${g(p.ontwerp_min, 0)} min`, p.ontwerp, 0, p.ontwerp > 0),
    rij('Aanpassing', `${g(p.aanpassing_min, 0)} min`, p.aanpassing, 0, p.aanpassing > 0),
    rij('Artikelen / diensten', '', p.artikelen, null, Math.abs(p.artikelen) >= 0.005),
    rij('Extra kosten', '', p.extra, 0, Math.abs(p.extra) >= 0.005),
    rij('Prijsafspraak klant', '', p.afspraak, 0, Math.abs(p.afspraak || 0) >= 0.005),
    rij('Handmatig aangepast', '', p.handmatig, 0, Math.abs(p.handmatig) >= 0.005),
    rij('Korting filament', '', p.korting_materiaal, 0, Math.abs(p.korting_materiaal || 0) >= 0.005),
    rij('Korting printuren', '', p.korting_printuren, 0, Math.abs(p.korting_printuren || 0) >= 0.005),
    rij('Korting op regels', '', p.korting_regels, 0, Math.abs(p.korting_regels || 0) >= 0.005),
    rij('Korting op het totaal', '', p.korting_totaal, 0, Math.abs(p.korting_totaal || 0) >= 0.005),
    rij('Afronding', '', p.afronding, 0, Math.abs(p.afronding) >= 0.005),
  ].filter(Boolean);
  const kost = rijen.reduce((s, r) => s + (r.kost || 0), 0);
  const w = (prijs, kst) => { if (kst == null) return '—'; const v = Math.round((prijs - kst) * 100) / 100 || 0; return <span style={{ color: v < 0 ? 'var(--crit)' : undefined }}>{e(v)}</span>; };
  return (
    <details className="kostenopbouw" open={open} style={{ marginTop: 10 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Berekening: prijs, kost en winst <span className="sub" style={{ fontWeight: 400 }}>intern, alle regels samen</span></summary>
      <div className="tabelvak" style={{ marginTop: 6, overflowX: 'auto' }}>
        <table className="mini">
          <thead><tr><th /><th className="r">Hoeveelheid</th><th className="r">Prijs (klant)</th><th className="r">Kost (jij)</th><th className="r">Winst</th></tr></thead>
          <tbody>
            {rijen.map(r => (
              <tr key={r.l}><td>{r.l}</td><td className="r sub">{r.hoeveel}</td><td className="r num">{e(r.prijs)}</td><td className="r num">{r.kost == null ? '—' : e(r.kost)}</td><td className="r num">{w(r.prijs, r.kost)}</td></tr>
            ))}
            <tr style={{ fontWeight: 600 }}><td>Totaal</td><td /><td className="r num">{e(totaal)}</td><td className="r num">{e(kost)}</td><td className="r num">{w(totaal, kost)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="note" style={{ fontSize: 12, margin: '4px 0 0' }}>Filament: prijs = het hoogste van de verkoopprijs per kg en inkoop × opslag, plus de faalfactor; kost = inkoopprijs. Arbeid telt als kost: het is je eigen tijd. Artikelen: hun kost staat niet in de schatting (zie Marges na het afrekenen).</p>
    </details>
  );
}
