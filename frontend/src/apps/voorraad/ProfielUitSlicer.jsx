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

export default function ProfielUitSlicer({ naam, onOvernemen, onSluit }) {
  const { melding } = useOmgeving();
  const [bezig, setBezig] = useState(false);
  const [d, setD] = useState(null);
  const [plaat, setPlaat] = useState(0);
  const [stuks, setStuks] = useState('1');
  const [bestand, setBestand] = useState(null);
  const [bewaren, setBewaren] = useState(true);

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
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  const p = d?.platen[plaat];
  const n = Number(String(stuks).replace(',', '.')) || 0;
  function overnemen() {
    onOvernemen({
      printer_id: d.printer_id ? String(d.printer_id) : '',
      tijd_min: Math.round(p.tijd_min / n * 100) / 100,
      per_plaat: String(n),
      materialen: p.filamenten.length ? p.filamenten.map(f => ({ keuze: f.keuze || '', gram: naarInvoer(Math.round(f.gram / n * 100) / 100) })) : [{ keuze: '', gram: '' }],
      bestand: bewaren ? bestand : null, plaat: p.nummer,
    });
  }

  return (
    <Dialoog titel="Printprofiel uit slicerbestand" onSluit={onSluit}
      voet={p && <>
        <button type="button" className="btn" onClick={onSluit}>Terug</button>
        <button type="button" className="btn primary" disabled={n <= 0} onClick={overnemen}>Overnemen</button>
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
        <label className="vinkje" style={{ marginTop: 8 }}><input type="checkbox" checked={bewaren} onChange={e => setBewaren(e.target.checked)} /> Slicerbestand bewaren bij dit artikel (downloaden vanuit het printprofiel)</label>
        <p className="note">Staan er ook andere producten op deze plaat, dan krijgt elk stuk een gelijk deel van tijd en gram. Slice voor een juiste kost liefst een plaat met enkel dit product. Filament dat niet herkend wordt, kies je daarna zelf in het profiel.</p>
      </>}
    </Dialoog>
  );
}
