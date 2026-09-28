import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { nieuweRegel } from '../../components/RegelEditor.jsx';
import { naarInvoer } from '../../lib/formaat.js';

// Slicerbestand inlezen (28-09): een geslicet 3mf uit Bambu Studio → één
// printregel per aangevinkte plaat, met printtijd en gram per kleur. Enkel
// geslicete platen staan in het bestand ("Slice plate" = die ene plaat).
// Niets wordt bewaard tot je het dossier opslaat.
const uurMin = min => `${Math.floor(min / 60)} u ${String(min % 60).padStart(2, '0')}`;

export default function SlicerDialoog({ printers, filamenten, prijsgroepen, onToevoegen, onSluit }) {
  const { melding } = useOmgeving();
  const [bezig, setBezig] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [printerId, setPrinterId] = useState('');
  const [platen, setPlaten] = useState(null);

  async function leesIn(bestand) {
    if (!bestand) return;
    setBezig(true);
    try {
      const fd = new FormData();
      fd.append('bestand', bestand);
      const d = await api.upload('/slicer', fd);
      setPrinterId(d.printer_id ? String(d.printer_id) : '');
      setPlaten(d.platen.map(p => ({ ...p, mee: true, omschrijving: p.naam || `Plaat ${p.nummer}`, aantal: '1',
        filamenten: p.filamenten.map(f => ({ ...f, keuze: f.keuze || '' })) })));
    } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  const zet = (i, w) => setPlaten(ps => ps.map((p, j) => (j === i ? { ...p, ...w } : p)));
  const zetFil = (i, k, keuze) => setPlaten(ps => ps.map((p, j) => (j === i ? { ...p, filamenten: p.filamenten.map((f, l) => (l === k ? { ...f, keuze, zeker: true } : f)) } : p)));

  const gekozen = (platen || []).filter(p => p.mee);
  const zonderFilament = gekozen.some(p => p.filamenten.some(f => !f.keuze));
  function toevoegen() {
    onToevoegen(gekozen.map(p => ({
      ...nieuweRegel('printen'), omschrijving: p.omschrijving, printer_id: printerId, aantal: p.aantal || '1',
      tijd_u: String(Math.floor(p.tijd_min / 60)), tijd_m: String(p.tijd_min % 60),
      materialen: p.filamenten.length ? p.filamenten.map(f => ({ keuze: f.keuze, gram: naarInvoer(f.gram) })) : [{ keuze: '', gram: '' }],
    })));
  }

  return (
    <Dialoog titel="Uit slicerbestand" breed onSluit={onSluit}
      voet={platen && <>
        <button type="button" className="btn" onClick={onSluit}>Terug</button>
        <button type="button" className="btn primary" disabled={!gekozen.length} onClick={toevoegen}>
          {gekozen.length === 1 ? '1 printregel toevoegen' : `${gekozen.length} printregels toevoegen`}
        </button>
      </>}>
      {!platen ? <>
        <label htmlFor="slicerbestand" className={`dropzone${sleep ? ' over' : ''}${bezig ? ' bezig' : ''}`}
          onDragOver={e => { e.preventDefault(); setSleep(true); }} onDragLeave={() => setSleep(false)}
          onDrop={e => { e.preventDefault(); setSleep(false); leesIn(e.dataTransfer.files?.[0]); }}>
          {bezig ? <b>Bestand lezen…</b> : <>
            <Icoon naam="plus" maat={28} />
            <b>Sleep een geslicet 3mf-bestand hierheen</b>
            <span className="sub">of klik om het te kiezen (.gcode.3mf uit Bambu Studio of OrcaSlicer)</span>
          </>}
        </label>
        <input id="slicerbestand" type="file" className="sr-only" accept=".3mf" disabled={bezig} onChange={e => { leesIn(e.target.files?.[0]); e.target.value = ''; }} />
        <p className="note">In Bambu Studio: <b>Slice plate</b> (enkel de plaat die je nodig hebt) of <b>Slice all</b>, daarna Bestand → Exporteren → <i>Export plate sliced file</i> of <i>Export all sliced file</i>. Enkel geslicete platen staan in het bestand.</p>
      </> : <>
        <label className="lbl">Printer
          <select className="inp" value={printerId} onChange={e => setPrinterId(e.target.value)}>
            <option value="">Kies…</option>
            {printers.map(p => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select>
        </label>
        <p className="sub" style={{ margin: '8px 0 12px' }}>Vink de platen aan die echt geprint worden. Elke plaat wordt een eigen printregel.</p>
        <div className="slicer-platen">
          {platen.map((p, i) => (
            <div key={p.nummer} className={`slicer-plaat${p.mee ? '' : ' uit'}`}>
              <label className="vinkje"><input type="checkbox" checked={p.mee} aria-label={`Plaat ${p.nummer} meenemen`} onChange={e => zet(i, { mee: e.target.checked })} /></label>
              {p.afbeelding ? <img src={p.afbeelding} alt={`Plaat ${p.nummer}`} /> : <span className="geen-afb" />}
              <div className="gegevens">
                <div className="rij">
                  <b className="mono">Plaat {p.nummer}</b>
                  <span className="sub">{uurMin(p.tijd_min)} · {naarInvoer(p.gram)} g{p.objecten.length > 1 ? ` · ${p.objecten.length} objecten` : ''}</span>
                </div>
                <div className="rij">
                  <input className="inp" aria-label={`Omschrijving plaat ${p.nummer}`} value={p.omschrijving} disabled={!p.mee} onChange={e => zet(i, { omschrijving: e.target.value })} />
                  <label className="klein">Stuks<input className="inp num" inputMode="numeric" aria-label={`Stuks op plaat ${p.nummer}`} value={p.aantal} disabled={!p.mee} onChange={e => zet(i, { aantal: e.target.value })} /></label>
                </div>
                {p.filamenten.map((f, k) => (
                  <div className="rij" key={k}>
                    <span className="kleurstip" style={{ background: f.kleur || 'transparent' }} title={f.kleur || ''} />
                    <select className={`inp${!f.keuze || !f.zeker ? ' let-op' : ''}`} aria-label={`Filament ${k + 1} van plaat ${p.nummer}`} value={f.keuze} disabled={!p.mee} onChange={e => zetFil(i, k, e.target.value)}>
                      <option value="">{f.profiel || `${f.merk || ''} ${f.type || ''}`.trim() || 'Filament'}: kies…</option>
                      <optgroup label="Filament (merk · type · kleur)">{filamenten.map(a => <option key={`a${a.id}`} value={`a:${a.id}`}>{a.weergave}</option>)}</optgroup>
                      <optgroup label="Enkel prijsgroep (merk · type)">{(prijsgroepen || []).map(g => <option key={`p${g.id}`} value={`p:${g.id}`}>{g.merk} {g.materiaal}</option>)}</optgroup>
                    </select>
                    <span className="num">{naarInvoer(f.gram)} g</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {zonderFilament && <p className="note">Niet elk filament is herkend: kies het zelf, of voeg het toe in Voorraad (merk + type als prijsgroep). Zonder keuze telt dat filament niet mee in de prijs.</p>}
      </>}
    </Dialoog>
  );
}
