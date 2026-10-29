import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { naarInvoer } from '../../lib/formaat.js';

// Printprofiel uit een slicerbestand (07-10): kies de plaat waarop dit
// product staat en hoeveel stuks erop staan → tijd en gram per stuk, stuks
// per plaat, printer en filament worden in het profiel ingevuld (nog niet
// bewaard: dat doe je met "Profiel bewaren").
const uurMin = min => `${Math.floor(min / 60)} u ${String(Math.round(min % 60)).padStart(2, '0')}`;
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// stuks van dit product op de plaat: objecten met (ongeveer) dezelfde naam, anders alle objecten
function stuksOp(p, naam) {
  const n = norm(naam);
  const zelfde = n ? p.objecten.filter(o => { const x = norm(o); return x && (x.includes(n) || n.includes(x)); }).length : 0;
  return String(zelfde || p.objecten.length || 1);
}

// 29-10: letter uit de naam van een plaat of object ("A", "Letter A",
// "bubble_É.stl", "&") — het laatste stukje van 1 à 2 tekens; anders leeg
export function letterUit(naam) {
  const t = String(naam ?? '').normalize('NFC').replace(/\.(stl|3mf|obj|step|stp)$/i, '').trim();
  if (!t) return '';
  if (Array.from(t).length <= 2) return t.toLocaleUpperCase('nl-BE');
  const stukken = t.split(/[\s_\-.()]+/).filter(Boolean);
  const laatste = stukken.at(-1) || '';
  return Array.from(laatste).length <= 2 ? laatste.toLocaleUpperCase('nl-BE') : '';
}

export default function ProfielUitSlicer({ naam, onOvernemen, onSluit }) {
  const { melding } = useOmgeving();
  const [bezig, setBezig] = useState(false);
  const [d, setD] = useState(null);
  const [plaat, setPlaat] = useState(0);
  const [stuks, setStuks] = useState('1');
  const [bestand, setBestand] = useState(null);
  const [bewaren, setBewaren] = useState(true);
  // 21-10: artikel uit meerdere platen → de aangevinkte platen worden elk een plaat in het profiel (1 stuk per plaat)
  const [meer, setMeer] = useState(false);
  // 29-10: elke plaat is één letter (bubble letters): letterprofiel
  const [letters, setLetters] = useState(false);
  const [gekozen, setGekozen] = useState({});

  async function leesIn(bestand) {
    if (!bestand) return;
    setBezig(true);
    try {
      const fd = new FormData();
      fd.append('bestand', bestand);
      const r = await api.upload('/slicer', fd);
      // voorkeur: de plaat met een object met de naam van dit product
      const i = Math.max(0, r.platen.findIndex(p => p.objecten.some(o => norm(o).includes(norm(naam)) || norm(naam).includes(norm(o)))));
      setD(r); setBestand(bestand); setPlaat(i); setStuks(stuksOp(r.platen[i], naam));
      setGekozen(Object.fromEntries(r.platen.map(x => [x.nummer, true])));
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  const p = d?.platen[plaat];
  const n = Number(String(stuks).replace(',', '.')) || 0;
  const mat = (q, deel) => (q.filamenten.length ? q.filamenten.map(f => ({ keuze: f.keuze || '', gram: naarInvoer(Math.round(f.gram / deel * 100) / 100) })) : [{ keuze: '', gram: '' }]);
  const printer = d?.printer_id ? String(d.printer_id) : '';
  const lijst = meer || letters ? (d?.platen || []).filter(x => gekozen[x.nummer]) : [];
  function overnemen() {
    if (letters) {
      onOvernemen({ letters: true, platen: lijst.map(q => ({ printer_id: printer, tijd_min: q.tijd_min, per_plaat: '1', materialen: mat(q, 1), plaat: q.nummer, naam: q.naam || q.objecten[0] || '', letter: letterUit(q.naam || q.objecten[0]) })), bestand: bewaren ? bestand : null });
      return;
    }
    const platen = meer
      ? lijst.map(q => ({ printer_id: printer, tijd_min: q.tijd_min, per_plaat: '1', materialen: mat(q, 1), plaat: q.nummer, naam: q.naam || '' }))
      : [{ printer_id: printer, tijd_min: Math.round(p.tijd_min / n * 100) / 100, per_plaat: String(n), materialen: mat(p, n), plaat: p.nummer }];
    onOvernemen({ platen, bestand: bewaren ? bestand : null });
  }

  return (
    <Dialoog titel="Printprofiel uit slicerbestand" onSluit={onSluit}
      voet={p && <>
        <button type="button" className="btn" onClick={onSluit}>Terug</button>
        <button type="button" className="btn primary" disabled={meer || letters ? !lijst.length : n <= 0} onClick={overnemen}>Overnemen{letters ? ` (${lijst.length} letters)` : meer ? ` (${lijst.length} platen)` : ''}</button>
      </>}>
      {!d ? <>
        <label htmlFor="pp-slicer" className={`dropzone${bezig ? ' bezig' : ''}`}
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); leesIn(e.dataTransfer.files?.[0]); }}>
          {bezig ? <b>Bestand lezen…</b> : <>
            <Icoon naam="plus" maat={28} />
            <b>Sleep een geslicet 3mf- of gcode-bestand hierheen</b>
            <span className="sub">of klik om het te kiezen (.gcode.3mf of .gcode)</span>
          </>}
        </label>
        <input id="pp-slicer" type="file" className="sr-only" accept=".3mf,.gcode,.gco" disabled={bezig} onChange={e => { leesIn(e.target.files?.[0]); e.target.value = ''; }} />
        <p className="note">In Bambu Studio: <b>Slice all</b> en daarna Bestand → Exporteren → <i>Export all sliced file</i>. Enkel geslicete platen staan in het bestand.</p>
      </> : <>
        {d.platen.length > 1 && <label className="vinkje"><input type="checkbox" checked={meer} onChange={e => { setMeer(e.target.checked); if (e.target.checked) setLetters(false); }} /> Dit artikel bestaat uit meerdere platen (samen één stuk)</label>}
        {d.platen.length > 1 && <label className="vinkje"><input type="checkbox" checked={letters} onChange={e => { setLetters(e.target.checked); if (e.target.checked) setMeer(false); }} /> Elke plaat is een letter of teken (bv. bubble letters): een stuk = één letter</label>}
        {letters ? <>
          <p className="sub">Elke aangevinkte plaat wordt een letter in het profiel. De letter wordt uit de naam van de plaat gehaald; na het overnemen kun je ze nog aanpassen. De kleur kies je per bestelling.</p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {d.platen.map(x => { const l = letterUit(x.naam || x.objecten[0]); return (
              <label key={x.nummer} className="vinkje" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!gekozen[x.nummer]} onChange={e => setGekozen(g => ({ ...g, [x.nummer]: e.target.checked }))} />
                <b style={{ width: 28 }}>{l || '?'}</b> Plaat {x.nummer}{x.naam ? ` · ${x.naam}` : ''} ({uurMin(x.tijd_min)}, {naarInvoer(x.gram)} g)
              </label>
            ); })}
          </div>
          {d.platen.some(x => !letterUit(x.naam || x.objecten[0])) && <p className="sub">Bij "?" is de letter niet uit de naam te halen: vul ze na het overnemen zelf in (of geef de platen in Bambu Studio een naam: A, B, É…).</p>}
        </> : meer ? <>
          <p className="sub">Vink de platen aan die samen één stuk vormen. Elke plaat wordt een plaat in het printprofiel, met de tijd en het gram van de hele plaat.</p>
          {d.platen.map(x => (
            <label key={x.nummer} className="vinkje" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={!!gekozen[x.nummer]} onChange={e => setGekozen(g => ({ ...g, [x.nummer]: e.target.checked }))} />
              {x.afbeelding && <img src={x.afbeelding} alt="" style={{ width: 48, borderRadius: 4 }} />}
              Plaat {x.nummer}{x.naam ? ` · ${x.naam}` : ''} ({uurMin(x.tijd_min)}, {naarInvoer(x.gram)} g)
            </label>
          ))}
          {lijst.length > 0 && <p className="sub">Samen: {uurMin(lijst.reduce((t, x) => t + x.tijd_min, 0))} · {naarInvoer(Math.round(lijst.reduce((t, x) => t + x.gram, 0) * 10) / 10)} g per stuk</p>}
        </> : <>
        {d.platen.length > 1 && <label className="lbl">Plaat met dit product
          <select className="inp" value={plaat} onChange={e => { const i = Number(e.target.value); setPlaat(i); setStuks(stuksOp(d.platen[i], naam)); }}>
            {d.platen.map((x, i) => <option key={x.nummer} value={i}>Plaat {x.nummer}{x.naam ? ` · ${x.naam}` : ''} ({uurMin(x.tijd_min)}, {naarInvoer(x.gram)} g)</option>)}
          </select></label>}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 10 }}>
          {p.afbeelding && <img src={p.afbeelding} alt={`Plaat ${p.nummer}`} style={{ width: 120, borderRadius: 6 }} />}
          <div>
            <p className="sub" style={{ marginTop: 0 }}>Plaat {p.nummer}: {uurMin(p.tijd_min)} · {naarInvoer(p.gram)} g{p.objecten.length ? ` · objecten: ${p.objecten.join(', ')}` : ''}</p>
            <label className="lbl">Stuks van dit product op de plaat
              <input className="inp num" inputMode="numeric" value={stuks} onChange={e => setStuks(e.target.value)} /></label>
            {n > 0 && <p className="sub">Per stuk: {uurMin(p.tijd_min / n)} · {naarInvoer(Math.round(p.gram / n * 100) / 100)} g</p>}
          </div>
        </div>
        </>}
        <label className="vinkje" style={{ marginTop: 8 }}><input type="checkbox" checked={bewaren} onChange={e => setBewaren(e.target.checked)} /> Slicerbestand bewaren bij dit artikel (downloaden vanuit het printprofiel)</label>
        <p className="note">Staan er ook andere producten op deze plaat, dan krijgt elk stuk een gelijk deel van tijd en gram. Slice voor een juiste kost liefst een plaat met enkel dit product. Filament dat niet herkend wordt, kies je daarna zelf in het profiel.</p>
      </>}
    </Dialoog>
  );
}
