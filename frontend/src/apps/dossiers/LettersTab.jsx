import { aantal as fmtAantal } from '../../lib/formaat.js';

// Letters (29-10): de letterbestelling(en) van dit dossier.
// - Per kleur: welke letters, hoeveel, met welk filament en hoeveel er al
//   goed geprint zijn (uit de bevestigde printopdrachten) — om te printen.
// - Per naam: welke letter in welke kleur — om in te pakken.
// Afdrukken opent een eenvoudige pagina met beide lijsten (afvinkvakjes).
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function overzicht(d) {
  const goed = new Map();   // omschrijving → goed geprint (alle regels met die omschrijving)
  for (const r of d.productie?.regels || []) goed.set(r.omschrijving, (goed.get(r.omschrijving) || 0) + (r.goed || 0));
  const kleuren = new Map();
  for (const b of d.letters || []) {
    for (const i of b.items) {
      const k = kleuren.get(i.kleur) || { kleur: i.kleur, filament: b.kleuren?.[i.kleur]?.filament || '', letters: new Map() };
      const l = k.letters.get(i.letter) || { letter: i.letter, aantal: 0, omschrijving: i.omschrijving };
      l.aantal += i.aantal;
      k.letters.set(i.letter, l);
      kleuren.set(i.kleur, k);
    }
  }
  return [...kleuren.values()].map(k => {
    const letters = [...k.letters.values()].sort((a, b) => a.letter.localeCompare(b.letter, 'nl')).map(l => ({ ...l, goed: Math.min(l.aantal, goed.get(l.omschrijving) || 0) }));
    return { ...k, letters, aantal: letters.reduce((t, l) => t + l.aantal, 0), goed: letters.reduce((t, l) => t + l.goed, 0) };
  }).sort((a, b) => a.kleur.localeCompare(b.kleur, 'nl'));
}

function drukAf(d, kleuren, namen) {
  const w = window.open('', '_blank');
  if (!w) return;
  const vak = '<span style="display:inline-block;width:11px;height:11px;border:1px solid #333;margin-right:3px;vertical-align:-1px"></span>';
  w.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>Letters ${esc(d.nummer)}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px}
    table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#555}
    .l{font-family:monospace;font-size:14px;letter-spacing:1px}.r{text-align:right}.naam{font-weight:bold;font-size:14px}.sub{color:#666;font-size:11px}
    @media print{h2{page-break-after:avoid}tr{page-break-inside:avoid}}</style></head><body>
    <h1>Letters — ${esc(d.nummer)} ${esc(d.titel || '')}</h1><div class="sub">${esc(d.klant || '')} · ${kleuren.reduce((t, k) => t + k.aantal, 0)} letters</div>
    <h2>Per kleur (printen)</h2><table><thead><tr><th>Kleur</th><th>Filament</th><th>Letters</th><th class="r">Aantal</th></tr></thead><tbody>
    ${kleuren.map(k => `<tr><td><b>${esc(k.kleur)}</b></td><td class="sub">${esc(k.filament)}</td><td class="l">${k.letters.map(l => Array.from({ length: l.aantal }, (_, n) => `${n < l.goed ? '☑' : vak}${esc(l.letter)}`).join(' ')).join(' &nbsp; ')}</td><td class="r">${k.goed}/${k.aantal}</td></tr>`).join('')}
    </tbody></table>
    ${namen.length ? `<h2>Per naam (inpakken)</h2><table><tbody>${namen.map(n => `<tr><td>${vak}</td><td class="naam">${esc(n.naam)}</td><td>${n.letters.map(x => `<b>${esc(x.letter)}</b> ${esc(x.kleur)}`).join(' · ')}</td></tr>`).join('')}</tbody></table>` : ''}
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export default function LettersTab({ d }) {
  const kleuren = overzicht(d);
  const namen = (d.letters || []).flatMap(b => b.namen || []);
  const totaal = kleuren.reduce((t, k) => t + k.aantal, 0), goed = kleuren.reduce((t, k) => t + k.goed, 0);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0 }}><b>{fmtAantal(totaal)} letters</b> · {fmtAantal(goed)} goed geprint · {kleuren.length} kleuren{namen.length ? ` · ${namen.length} namen` : ''}</p>
        <button type="button" className="btn" onClick={() => drukAf(d, kleuren, namen)}>Afdrukken</button>
      </div>
      <h4 className="tussenkop">Per kleur (printen)</h4>
      <div className="tabelvak">
        <table className="mini">
          <thead><tr><th>Kleur</th><th>Letters</th><th className="r">Geprint</th></tr></thead>
          <tbody>{kleuren.map(k => (
            <tr key={k.kleur}>
              <td><b>{k.kleur}</b>{k.filament && <div className="sub">{k.filament}</div>}</td>
              <td className="mono">{k.letters.map(l => (
                <span key={l.letter} title={`${l.goed} van ${l.aantal} goed geprint`} style={{ marginRight: 8, color: l.goed >= l.aantal ? 'var(--pos)' : undefined, fontWeight: l.goed >= l.aantal ? 400 : 700 }}>
                  {l.letter}{l.aantal > 1 ? `×${l.aantal}` : ''}{l.goed > 0 && l.goed < l.aantal ? ` (${l.goed})` : ''}{l.goed >= l.aantal ? ' ✓' : ''}
                </span>))}</td>
              <td className="r num">{k.goed}/{k.aantal}{k.goed >= k.aantal && ' ✓'}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {namen.length > 0 ? <>
        <h4 className="tussenkop">Per naam (inpakken)</h4>
        <div className="tabelvak">
          <table className="mini"><tbody>{namen.map((n, i) => (
            <tr key={i}><td style={{ width: 160 }}><b>{n.naam}</b></td><td>{n.letters.map((x, j) => <span key={j} style={{ marginRight: 10 }}><b className="mono">{x.letter}</b> <span className="sub">{x.kleur}</span></span>)}</td></tr>
          ))}</tbody></table>
        </div>
      </> : <p className="note">De lijst werd per kleur ingegeven: er is geen inpaklijst per naam.</p>}
      <p className="note" style={{ marginBottom: 0 }}>"Geprint" telt de goede stuks van de bevestigde printopdrachten. Groen = die letter is klaar. Afdrukken geeft een lijst met afvinkvakjes.</p>
    </div>
  );
}
