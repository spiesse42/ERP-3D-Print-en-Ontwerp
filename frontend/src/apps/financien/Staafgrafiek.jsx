import { useState } from 'react';

// Eenvoudige staafgrafiek per maand (stap 7): één reeks, één kleur (--grafiek),
// staven ≤ 24 px met afgeronde top, één as, hover-tooltip, en de hoogste
// waarde als label. De cijfers staan ook in de tabel eronder (tabelweergave).
const MAAND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export const maandNaam = m => MAAND[Number(String(m).slice(5, 7)) - 1] || m;

export default function Staafgrafiek({ titel, rijen, waarde, opmaak = v => String(v), hoogte = 150 }) {
  const [aan, setAan] = useState(null);
  const B = 360, H = hoogte, onder = 18, boven = 16;
  const waarden = rijen.map(r => Math.max(0, Number(waarde(r)) || 0));
  const max = Math.max(...waarden, 0);
  const slot = B / rijen.length;
  const breed = Math.min(24, slot - 2);
  const y = v => (max > 0 ? H - onder - (v / max) * (H - onder - boven) : H - onder);
  const top = waarden.indexOf(max);
  return (
    <div className="grafiek" role="figure" aria-label={titel}>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{titel}</div>
      <svg viewBox={`0 0 ${B} ${H}`} onMouseLeave={() => setAan(null)}>
        <line className="as" x1="0" x2={B} y1={H - onder} y2={H - onder} />
        {rijen.map((r, i) => {
          const v = waarden[i];
          const x = i * slot + (slot - breed) / 2;
          const yt = y(v);
          const h = H - onder - yt;
          const rr = Math.min(4, h);
          const pad = h > 0 ? `M${x},${H - onder} V${yt + rr} Q${x},${yt} ${x + rr},${yt} H${x + breed - rr} Q${x + breed},${yt} ${x + breed},${yt + rr} V${H - onder} Z` : '';
          return (
            <g key={i} onMouseEnter={() => setAan(i)} onFocus={() => setAan(i)} tabIndex={0} aria-label={`${maandNaam(r.maand)}: ${opmaak(v)}`}>
              <rect x={i * slot} y={boven} width={slot} height={H - onder - boven} fill="transparent" />
              {pad && <path className={`staaf${aan === i ? ' aan' : ''}`} d={pad} />}
              <text x={i * slot + slot / 2} y={H - 4} textAnchor="middle">{maandNaam(r.maand)}</text>
            </g>
          );
        })}
        {max > 0 && <text x={top * slot + slot / 2} y={y(max) - 4} textAnchor="middle">{opmaak(max)}</text>}
      </svg>
      {aan != null && (
        <div className="tip" style={{ left: `${((aan + 0.5) * slot / B) * 100}%`, top: `${(y(waarden[aan]) / H) * 100}%` }}>
          {maandNaam(rijen[aan].maand)}: {opmaak(waarden[aan])}
        </div>
      )}
      {max === 0 && <p className="sub" style={{ margin: '4px 0 0' }}>Nog niets dit jaar.</p>}
    </div>
  );
}
